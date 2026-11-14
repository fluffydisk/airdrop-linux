// GPL-3.0-only. Small LEAdvertisement1 publisher with explicit D-Bus ownership.
// Uses standard BlueZ 5.87 properties; no raw strings are exported to diagnostics.
use super::*;
use dbus::{
    arg::PropMap,
    channel::MatchingReceiver,
    message::MatchRule,
    nonblock::{Proxy, SyncConnection},
};
use dbus_crossroads::{Crossroads, IfaceBuilder};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
const PATH: &str = "/org/airdroplinux/QuickShare/Advertisement";
const IFACE: &str = "org.bluez.LEAdvertisement1";
const MANAGER: &str = "org.bluez.LEAdvertisingManager1";
struct Owner {
    connection: Arc<SyncConnection>,
    io: tokio::task::JoinHandle<dbus_tokio::connection::IOResourceError>,
}
impl Drop for Owner {
    fn drop(&mut self) {
        self.io.abort();
    }
}
pub struct Handle {
    owner: Option<Owner>,
    adapter_path: String,
    released: Arc<AtomicBool>,
}
impl Handle {
    pub fn is_active(&self) -> bool {
        !self.released.load(Ordering::Relaxed)
            && self
                .owner
                .as_ref()
                .is_some_and(|owner| !owner.io.is_finished())
    }
}
impl Drop for Handle {
    fn drop(&mut self) {
        self.released.store(true, Ordering::Relaxed);
        if let Some(owner) = self.owner.take() {
            let path = self.adapter_path.clone();
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                runtime.spawn(async move {
                    let proxy = Proxy::new(
                        "org.bluez",
                        path,
                        Duration::from_secs(1),
                        owner.connection.clone(),
                    );
                    let _ = timeout(
                        Duration::from_secs(1),
                        proxy.method_call::<(), _, _, _>(
                            MANAGER,
                            "UnregisterAdvertisement",
                            (dbus::Path::new(PATH).unwrap(),),
                        ),
                    )
                    .await;
                    drop(owner);
                });
            }
            // Without an executor the owner drops here: bus disconnect removes
            // this client's advertisement, without changing other clients.
        }
    }
}
pub async fn publish(adapter_name: &str, a: Advertisement, status: &mut Status) -> Result<Handle> {
    ensure!(
        adapter_name.starts_with("hci")
            && adapter_name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_'),
        "adapter path"
    );
    let (resource, connection) =
        tokio::task::spawn_blocking(dbus_tokio::connection::new_system_sync)
            .await?
            .map_err(bluer::Error::from)?;
    let owner = Owner {
        connection: connection.clone(),
        io: tokio::spawn(resource),
    };
    let bus = Proxy::new(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        CALL_LIMIT,
        connection.clone(),
    );
    let (bluez_owner,): (String,) = bus
        .method_call("org.freedesktop.DBus", "GetNameOwner", ("org.bluez",))
        .await
        .map_err(bluer::Error::from)?;
    let released = Arc::new(AtomicBool::new(false));
    let for_release = released.clone();
    let mut cr = Crossroads::new();
    let extended = a.secondary_channel.is_some();
    let token = cr.register(IFACE, |b: &mut IfaceBuilder<Advertisement>| {
        b.property::<String, _>("Type")
            .get(|_, _| Ok("peripheral".into()));
        b.property::<std::collections::HashMap<String, dbus::arg::Variant<Vec<u8>>>, _>(
            "ServiceData",
        )
        .get(|_, a| {
            Ok(a.service_data
                .iter()
                .map(|(uuid, data)| (uuid.to_string(), dbus::arg::Variant(data.clone())))
                .collect())
        });
        b.property::<u16, _>("Timeout").get(|_, _| Ok(120));
        if extended {
            b.property::<String, _>("SecondaryChannel")
                .get(|_, _| Ok("1M".into()));
        }
        b.method("Release", (), (), move |_, _, (): ()| {
            for_release.store(true, Ordering::Relaxed);
            inc("advertisement_daemon_released");
            Ok(())
        });
    });
    cr.insert(PATH, &[token], a);
    let cr = Mutex::new(cr);
    connection.start_receive(
        MatchRule::new_method_call(),
        Box::new(move |msg, c| {
            // D-Bus authenticates the sender. Do not let another local client spoof
            // Release or turn this minimal object into an unrestricted endpoint.
            if msg
                .sender()
                .is_some_and(|sender| sender.as_ref() == bluez_owner)
                && let Ok(mut cr) = cr.lock()
            {
                let _ = cr.handle_message(msg, c);
            }
            true
        }),
    );
    let adapter_path = format!("/org/bluez/{adapter_name}");
    let proxy = Proxy::new("org.bluez", adapter_path.clone(), CALL_LIMIT, connection);
    status.phase = "bluez";
    diag::current().advertising(status.clone());
    inc("advertisement_registration_requested");
    inc(if extended {
        "advertisement_attempt_extended"
    } else {
        "advertisement_attempt_compact"
    });
    proxy
        .method_call::<(), _, _, _>(
            MANAGER,
            "RegisterAdvertisement",
            (dbus::Path::new(PATH).unwrap(), PropMap::new()),
        )
        .await
        .map_err(bluer::Error::from)?;
    Ok(Handle {
        owner: Some(owner),
        adapter_path,
        released,
    })
}
