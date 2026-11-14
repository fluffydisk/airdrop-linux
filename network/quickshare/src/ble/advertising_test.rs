// GPL-3.0-only. Independent private D-Bus peer, not a controller/RF test.
// Exercises real D-Bus serialization, replies, cancellation and owner cleanup.
use super::*;
use dbus::{
    arg::{PropMap, Variant},
    blocking::Connection,
    channel::Sender,
    message::MatchRule,
};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
struct OwnedProcess(Child);
impl Drop for OwnedProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
#[derive(Default)]
struct Observations {
    calls: usize,
    unregistered: usize,
    prior_owner_still_present: usize,
    properties_checked: usize,
}

fn serve(
    address: String,
    stop: Arc<AtomicBool>,
    seen: Arc<Mutex<Observations>>,
    ready: std::sync::mpsc::SyncSender<()>,
) {
    let c = Connection::new_address(&address).unwrap();
    c.request_name("org.bluez", false, true, false).unwrap();
    let mut previous: Option<String> = None;
    c.add_match(MatchRule::new_method_call(), move |_: (), conn, msg| {
        let interface = msg.interface().map(|v| v.to_string()).unwrap_or_default();
        let member = msg.member().map(|v| v.to_string()).unwrap_or_default();
        let mut release = None;
        let reply = match (interface.as_str(), member.as_str()) {
            ("org.freedesktop.DBus.ObjectManager", "GetManagedObjects") => msg
                .method_return()
                .append1(HashMap::<dbus::Path<'static>, HashMap<String, PropMap>>::new()),
            ("org.freedesktop.DBus.Properties", "Get") => {
                msg.method_return().append1(Variant(true))
            }
            ("org.bluez.LEAdvertisingManager1", "UnregisterAdvertisement") => {
                seen.lock().unwrap().unregistered += 1;
                msg.method_return()
            }
            ("org.bluez.LEAdvertisingManager1", "RegisterAdvertisement") => {
                if let Some(name) = previous.take() {
                    let (alive,): (bool,) = conn
                        .with_proxy(
                            "org.freedesktop.DBus",
                            "/org/freedesktop/DBus",
                            Duration::from_secs(1),
                        )
                        .method_call("org.freedesktop.DBus", "NameHasOwner", (name,))
                        .unwrap();
                    if alive {
                        seen.lock().unwrap().prior_owner_still_present += 1;
                    }
                }
                let (path, _options): (dbus::Path<'static>, PropMap) = msg.read2().unwrap();
                let owner = msg.sender().unwrap().to_string();
                let (props,): (PropMap,) = conn
                    .with_proxy(owner.as_str(), path.clone(), Duration::from_secs(2))
                    .method_call(
                        "org.freedesktop.DBus.Properties",
                        "GetAll",
                        ("org.bluez.LEAdvertisement1",),
                    )
                    .unwrap();
                assert_eq!(props["Type"].0.as_str(), Some("peripheral"));
                assert_eq!(props["Timeout"].0.as_u64(), Some(120));
                assert!(
                    !props.contains_key("SecondaryChannel")
                        && !props.contains_key("Discoverable")
                        && !props.contains_key("LocalName")
                );
                let service: Vec<_> = props["ServiceData"].0.as_iter().unwrap().collect();
                assert_eq!(service.len(), 2);
                assert_eq!(
                    service[0].as_str(),
                    Some("0000fef3-0000-1000-8000-00805f9b34fb")
                );
                let variant = service[1].as_iter().unwrap().next().unwrap();
                assert_eq!(variant.as_iter().unwrap().count(), 17);
                let n = {
                    let mut s = seen.lock().unwrap();
                    s.properties_checked += 1;
                    s.calls += 1;
                    s.calls
                };
                previous = Some(owner.clone());
                if n == 11 {
                    release = Some((owner, path));
                }
                if n == 8 || n == 10 {
                    return true;
                } // No reply, including an outer-cancelled registration.
                let name = match n {
                    1 => Some("org.bluez.Error.InvalidArguments"),
                    2 => Some("org.bluez.Error.InvalidLength"),
                    3 => Some("org.bluez.Error.NotPermitted"),
                    4 => Some("org.bluez.Error.NotSupported"),
                    5 => Some("org.bluez.Error.InProgress"),
                    6 => Some("org.bluez.Error.Failed"),
                    7 => Some("org.freedesktop.DBus.Error.LimitsExceeded"),
                    _ => None,
                };
                if let Some(name) = name {
                    let body = if n == 6 {
                        "Failed to parse advertisement."
                    } else {
                        "AA:BB:CC:DD:EE:FF account@example.com /private/file SESSION-SECRET"
                    };
                    msg.error(
                        &dbus::strings::ErrorName::new(name).unwrap(),
                        &std::ffi::CString::new(body).unwrap(),
                    )
                } else {
                    msg.method_return()
                }
            }
            _ => msg.error(
                &dbus::strings::ErrorName::new("org.freedesktop.DBus.Error.UnknownMethod").unwrap(),
                &std::ffi::CString::new("unsupported test method").unwrap(),
            ),
        };
        conn.send(reply).unwrap();
        if let Some((owner, path)) = release {
            let mut msg = dbus::Message::new_method_call(
                owner,
                path,
                "org.bluez.LEAdvertisement1",
                "Release",
            )
            .unwrap();
            msg.set_no_reply(true);
            conn.send(msg).unwrap();
        }
        true
    })
    .unwrap();
    ready.send(()).unwrap();
    while !stop.load(Ordering::Relaxed) {
        c.process(Duration::from_millis(20)).unwrap();
    }
}

async fn client() {
    // Keep the unrelated GATT/scanning owner alive throughout failures.
    let main = bluer::Session::new().await.unwrap();
    let adapter = main.adapter("hci0").unwrap();
    let full = super::super::protocol::receiver(*b"AB12", "Linux", Some(0x83)).unwrap();
    let make = || Advertisement {
        advertisement_type: Type::Peripheral,
        service_data: [(
            super::super::radio::SERVICE,
            super::super::protocol::header(&full, false, Some(0x83)),
        )]
        .into(),
        timeout: Some(LEASE),
        ..Default::default()
    };
    for category in [
        "invalid-arguments",
        "invalid-length",
        "capacity-or-policy",
        "not-supported",
        "busy",
        "parse-failed",
        "resources",
        "timeout",
    ] {
        assert!(
            register("hci0", make(), "compact-gatt", Context::default())
                .await
                .is_err()
        );
        let state = diag::current().snapshot();
        assert_eq!(state["advertising"]["category"], category);
        assert!(!state.to_string().contains("SESSION-SECRET"));
        assert!(adapter.is_powered().await.unwrap());
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let handle = register("hci0", make(), "compact-gatt", Context::default())
        .await
        .unwrap();
    assert!(handle.is_active());
    assert_eq!(
        diag::current().snapshot()["advertising"]["result"],
        "registered"
    );
    drop(handle);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(
        timeout(
            Duration::from_millis(100),
            register("hci0", make(), "compact-gatt", Context::default())
        )
        .await
        .is_err()
    );
    tokio::time::sleep(Duration::from_millis(100)).await;
    let handle = register("hci0", make(), "compact-gatt", Context::default())
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(
        !handle.is_active(),
        "BlueZ Release must invalidate a retained handle"
    );
    assert_eq!(
        diag::current().snapshot()["counters"]["advertisement_daemon_released"],
        1
    );
    drop(handle);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(adapter.is_powered().await.unwrap());
}

#[tokio::test]
async fn private_dbus_registration_and_cleanup() {
    if std::env::var_os("AIRDROP_TEST_ADV_BUS_CHILD").is_some() {
        client().await;
        return;
    }
    // Environment changes are scoped to a child process; parallel tests never
    // mutate or use the real system-bus address.
    let mut bus = OwnedProcess(
        Command::new("dbus-daemon")
            .args(["--session", "--nofork", "--print-address=1"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("dbus-daemon is a native-test dependency"),
    );
    let mut address = String::new();
    BufReader::new(bus.0.stdout.take().unwrap())
        .read_line(&mut address)
        .unwrap();
    let address = address.trim().to_owned();
    let stop = Arc::new(AtomicBool::new(false));
    let seen = Arc::new(Mutex::new(Observations::default()));
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let (server_stop, server_seen) = (stop.clone(), seen.clone());
    let server_address = address.clone();
    let server = std::thread::spawn(move || serve(server_address, server_stop, server_seen, tx));
    rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let mut child = OwnedProcess(
        Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "ble::advertising::dbus_tests::private_dbus_registration_and_cleanup",
                "--nocapture",
            ])
            .env("AIRDROP_TEST_ADV_BUS_CHILD", "1")
            .env("DBUS_SYSTEM_BUS_ADDRESS", &address)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(20);
    let exit = loop {
        if let Some(status) = child.0.try_wait().unwrap() {
            break Some(status);
        }
        if Instant::now() >= deadline {
            break None;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    };
    let mut stdout = String::new();
    let mut stderr = String::new();
    if exit.is_some() {
        child
            .0
            .stdout
            .take()
            .unwrap()
            .take(65536)
            .read_to_string(&mut stdout)
            .unwrap();
        child
            .0
            .stderr
            .take()
            .unwrap()
            .take(65536)
            .read_to_string(&mut stderr)
            .unwrap();
    }
    drop(child);
    stop.store(true, Ordering::Relaxed);
    server.join().unwrap();
    assert!(
        exit.is_some_and(|s| s.success()),
        "private D-Bus client failed: {stdout} {stderr}"
    );
    let seen = seen.lock().unwrap();
    assert_eq!(seen.calls, 11);
    assert_eq!(seen.properties_checked, 11);
    assert_eq!(seen.unregistered, 2);
    assert_eq!(
        seen.prior_owner_still_present, 0,
        "failed/cancelled/successfully released publisher must disappear before next attempt"
    );
}
