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
    registered_at: Instant,
}
impl Handle {
    pub fn is_active(&self) -> bool {
        !self.released.load(Ordering::Relaxed)
            && self
                .owner
                .as_ref()
                .is_some_and(|owner| !owner.io.is_finished())
    }
    pub async fn release(mut self, reason: &'static str) -> Result<()> {
        let Some(owner) = self.owner.take() else {
            return Ok(());
        };
        cleanup(
            owner,
            self.adapter_path.clone(),
            self.released.clone(),
            self.registered_at,
            reason,
        )
        .await
    }
}
// A cancellation or error can still drop an owned handle. This safety net is
// bounded, observed, and separate from the awaited normal replacement path.
impl Drop for Handle {
    fn drop(&mut self) {
        if let Some(owner) = self.owner.take() {
            inc("advertisement_cleanup_drop_fallback");
            let (path, released, registered_at) = (
                self.adapter_path.clone(),
                self.released.clone(),
                self.registered_at,
            );
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                runtime.spawn(async move {
                    let _ = cleanup(owner, path, released, registered_at, "drop").await;
                });
            }
        }
    }
}
async fn cleanup(
    mut owner: Owner,
    path: String,
    released: Arc<AtomicBool>,
    registered_at: Instant,
    reason: &'static str,
) -> Result<()> {
    let started = Instant::now();
    let mut status = CleanupStatus {
        reason,
        result: "pending",
        unregister_result: "pending",
        error_name: "none",
        category: "none",
        age_ms: registered_at.elapsed().as_millis().min(1_000_000_000) as u64,
        lease_ms: RECEIVER_TIMEOUT.as_millis() as u64,
        daemon_release_before_cleanup: released.load(Ordering::Relaxed),
        daemon_release_during_cleanup: false,
        io_stopped: false,
        owner_scope_closed: false,
        settle_ms: 0,
        duration_ms: 0,
    };
    inc("advertisement_cleanup_requested");
    diag::current().advertising_cleanup(status.clone());
    let proxy = Proxy::new(
        "org.bluez",
        path,
        Duration::from_secs(1),
        owner.connection.clone(),
    );
    let result = timeout(
        Duration::from_secs(1),
        proxy.method_call::<(), _, _, _>(
            MANAGER,
            "UnregisterAdvertisement",
            (dbus::Path::new(PATH).unwrap(),),
        ),
    )
    .await;
    let unregister_ok = match result {
        Ok(Ok(())) => {
            status.unregister_result = "acknowledged";
            inc("advertisement_cleanup_acknowledged");
            true
        }
        Ok(Err(e)) => {
            let e = bluer::Error::from(e);
            let already_gone = matches!(
                e.kind,
                bluer::ErrorKind::DoesNotExist | bluer::ErrorKind::NotFound
            );
            (status.error_name, status.category) = failure(&e.into());
            status.unregister_result = if already_gone {
                "already-removed"
            } else if status.category == "timeout" {
                "timeout"
            } else {
                "error"
            };
            inc(if already_gone {
                "advertisement_cleanup_already_removed"
            } else if status.category == "timeout" {
                "advertisement_cleanup_timeout"
            } else {
                "advertisement_cleanup_error"
            });
            already_gone
        }
        Err(_) => {
            status.unregister_result = "timeout";
            status.error_name = "timeout";
            status.category = "timeout";
            inc("advertisement_cleanup_timeout");
            false
        }
    };
    drop(proxy);
    // Join the aborted I/O task, then drop the last owned connection reference.
    // This observes scope teardown, not completion of a controller MGMT command.
    owner.io.abort();
    status.io_stopped = timeout(Duration::from_millis(500), &mut owner.io)
        .await
        .is_ok();
    status.daemon_release_during_cleanup =
        !status.daemon_release_before_cleanup && released.load(Ordering::Relaxed);
    drop(owner);
    status.owner_scope_closed = status.io_stopped;
    inc(if status.io_stopped {
        "advertisement_cleanup_owner_closed"
    } else {
        "advertisement_cleanup_owner_timeout"
    });
    // BlueZ 5.87 acknowledges unregister after queuing controller removal. A
    // bounded quiet interval avoids immediate replacement but does not prove RF
    // idle or controller completion. No unrelated advertiser is removed.
    tokio::time::sleep(SETTLE).await;
    status.settle_ms = SETTLE.as_millis() as u64;
    status.duration_ms = started.elapsed().as_millis().min(1_000_000_000) as u64;
    let ok = unregister_ok && status.owner_scope_closed;
    status.result = if ok { "completed" } else { "failed" };
    if !unregister_ok {
        inc(&format!(
            "advertisement_cleanup_error_{}",
            status.category.replace('-', "_")
        ));
    }
    diag::current().advertising_cleanup(status);
    ensure!(ok, "advertisement cleanup incomplete");
    Ok(())
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
        b.property::<u16, _>("Timeout")
            .get(|_, a| Ok(a.timeout.map(|v| v.as_secs() as u16).unwrap_or(0)));
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
        registered_at: Instant::now(),
    })
}
