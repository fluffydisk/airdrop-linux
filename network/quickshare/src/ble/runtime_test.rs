// GPL-3.0-only. Independent private BlueZ D-Bus peer; no controller/RF test.
use super::*;
use dbus::{
    arg::{PropMap, Variant},
    blocking::Connection,
    channel::Sender,
    message::MatchRule,
};
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::atomic::{AtomicBool, AtomicUsize, Ordering},
};
type Objects = HashMap<dbus::Path<'static>, HashMap<String, PropMap>>;
struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
#[derive(Default)]
struct Seen {
    old_ads: AtomicUsize,
    new_ads: AtomicUsize,
    gatt: AtomicUsize,
    premature_scan: AtomicUsize,
    stale: AtomicUsize,
}
fn error(msg: &dbus::Message, name: &str) -> dbus::Message {
    msg.error(
        &dbus::strings::ErrorName::new(name).unwrap(),
        &std::ffi::CString::new("synthetic private failure").unwrap(),
    )
}

#[tokio::test]
async fn private_dbus_adapter_recreation_invalidates_old_handles_and_recovers_advertising() {
    const CHILD: &str = "AIRDROP_RUNTIME_DBUS_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let mut bus = Process(
            Command::new("dbus-daemon")
                .args(["--session", "--nofork", "--print-address=1"])
                .stdout(Stdio::piped())
                .spawn()
                .unwrap(),
        );
        let mut address = String::new();
        BufReader::new(bus.0.stdout.take().unwrap())
            .read_line(&mut address)
            .unwrap();
        let address = address.trim().to_owned();
        let seen = Arc::new(Seen::default());
        let observations = seen.clone();
        let done = Arc::new(AtomicBool::new(false));
        let stopped = done.clone();
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let peer_address = address.clone();
        let peer = std::thread::spawn(move || {
            let conn = Connection::new_address(&peer_address).unwrap();
            conn.request_name("org.bluez", false, true, false).unwrap();
            let generation = Arc::new(AtomicUsize::new(0));
            let current = generation.clone();
            let seen = observations;
            conn.add_match(MatchRule::new_method_call(),move |_:(),conn,msg| {
                let interface=msg.interface().map(|s|s.to_string()).unwrap_or_default();
                let member=msg.member().map(|s|s.to_string()).unwrap_or_default();
                let old=msg.path().is_some_and(|p|p.to_string()=="/org/bluez/hci0");
                let replaced=current.load(Ordering::SeqCst)>0;
                let mut remove=false;
                let reply=match (interface.as_str(),member.as_str()) {
                    ("org.freedesktop.DBus.ObjectManager","GetManagedObjects")=>{
                        let path=dbus::Path::new(if replaced{"/org/bluez/hci1"}else{"/org/bluez/hci0"}).unwrap();
                        let mut objects:Objects=[(path,["org.bluez.Adapter1","org.bluez.GattManager1","org.bluez.LEAdvertisingManager1"].into_iter().map(|s|(s.to_string(),PropMap::new())).collect())].into();
                        if replaced {
                            // The preferred index now belongs to an unrelated controller.
                            objects.insert(dbus::Path::new("/org/bluez/hci0").unwrap(),[("org.bluez.Adapter1".to_string(),PropMap::new())].into());
                        }
                        msg.method_return().append1(objects)
                    }
                    ("org.freedesktop.DBus.Properties","Get")=>{
                        {
                            let (_,property):(String,String)=msg.read2().unwrap();
                            match property.as_str() {
                                "Address"=>msg.method_return().append1(Variant(if old && replaced {"02:00:00:00:00:02"}else{"02:00:00:00:00:01"}.to_string())),
                                "Powered"=>msg.method_return().append1(Variant(true)),
                                "Discovering"=>msg.method_return().append1(Variant(false)),
                                "SupportedInstances"=>msg.method_return().append1(Variant(5u8)),
                                "ActiveInstances"=>msg.method_return().append1(Variant(0u8)),
                                "SupportedSecondaryChannels"=>msg.method_return().append1(Variant(Vec::<String>::new())),
                                "SupportedCapabilities"=>msg.method_return().append1(Variant(HashMap::<String,Variant<u8>>::new())),
                                _=>error(msg,"org.freedesktop.DBus.Error.UnknownProperty"),
                            }
                        }
                    }
                    ("org.bluez.GattManager1","RegisterApplication")=>{seen.gatt.fetch_add(1,Ordering::SeqCst);msg.method_return()}
                    ("org.bluez.GattManager1","UnregisterApplication")=>msg.method_return(),
                    ("org.bluez.LEAdvertisingManager1","RegisterAdvertisement")=>{
                        if old {seen.old_ads.fetch_add(1,Ordering::SeqCst);if replaced {seen.stale.fetch_add(1,Ordering::SeqCst);}msg.method_return()}
                        else {let n=seen.new_ads.fetch_add(1,Ordering::SeqCst)+1;
                            if n<=3 {error(msg,"org.bluez.Error.Failed")} else {msg.method_return()}}
                    }
                    ("org.bluez.LEAdvertisingManager1","UnregisterAdvertisement")=>{
                        if old && replaced {error(msg,"org.bluez.Error.DoesNotExist")}else{msg.method_return()}
                    }
                    ("org.bluez.Adapter1","SetDiscoveryFilter")=>msg.method_return(),
                    ("org.bluez.Adapter1","StartDiscovery")=>{
                        if old && !replaced {remove=true;}
                        else if old {seen.stale.fetch_add(1,Ordering::SeqCst);}
                        else if seen.new_ads.load(Ordering::SeqCst)<4 {seen.premature_scan.fetch_add(1,Ordering::SeqCst);}
                        msg.method_return()
                    }
                    ("org.bluez.Adapter1","StopDiscovery")=>{
                        if old && replaced {error(msg,"org.freedesktop.DBus.Error.UnknownObject")}else{msg.method_return()}
                    }
                    _=>panic!("unexpected method {interface}.{member}; no device disconnection or global writes are allowed"),
                };
                conn.send(reply).unwrap();
                if remove {
                    current.store(1,Ordering::SeqCst);
                    conn.send(dbus::Message::new_signal("/","org.freedesktop.DBus.ObjectManager","InterfacesRemoved").unwrap().append2(dbus::Path::new("/org/bluez/hci0").unwrap(),vec!["org.bluez.Adapter1".to_string()])).unwrap();
                    conn.send(dbus::Message::new_signal("/","org.freedesktop.DBus.ObjectManager","InterfacesAdded").unwrap().append2(dbus::Path::new("/org/bluez/hci1").unwrap(),[("org.bluez.Adapter1".to_string(),PropMap::new())].into_iter().collect::<HashMap<_,_>>())).unwrap();
                }
                true
            }).unwrap();
            ready_tx.send(()).unwrap();
            while !stopped.load(Ordering::Relaxed) {
                conn.process(Duration::from_millis(10)).unwrap();
            }
        });
        ready_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let output=Command::new(std::env::current_exe().unwrap()).args(["--exact","ble::radio::runtime_tests::private_dbus_adapter_recreation_invalidates_old_handles_and_recovers_advertising","--nocapture"]).env(CHILD,"1").env("DBUS_SYSTEM_BUS_ADDRESS",address).output().unwrap();
        done.store(true, Ordering::Relaxed);
        peer.join().unwrap();
        assert!(
            output.status.success(),
            "{} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(seen.old_ads.load(Ordering::SeqCst), 1);
        assert_eq!(seen.new_ads.load(Ordering::SeqCst), 4);
        assert_eq!(seen.gatt.load(Ordering::SeqCst), 2);
        assert_eq!(seen.stale.load(Ordering::SeqCst), 0);
        assert_eq!(seen.premature_scan.load(Ordering::SeqCst), 0);
        return;
    }
    let (sender, _) = broadcast::channel(32);
    let (events, mut rx) = mpsc::channel(64);
    let mut runtime = Runtime::start(*b"TEST", "Fixture".into(), sender, events);
    timeout(Duration::from_secs(40), async {
        while let Some(Event::Bluetooth(state)) = rx.recv().await {
            if state["bleAdvertising"] == true
                && state["diagnostics"]["counters"]["advertisement_registration_success"] == 2
            {
                return;
            }
        }
        panic!("runtime event stream ended");
    })
    .await
    .expect("fresh adapter advertising did not recover");
    runtime.stop().await;
    assert!(runtime.task.is_finished());
    let counts = diag::current().snapshot();
    assert_eq!(counts["counters"]["adapter_index_changed"], 1);
    assert_eq!(counts["counters"]["adapter_handles_invalidated"], 2);
    assert_eq!(counts["counters"]["adapter_generation_started"], 2);
    assert_eq!(counts["counters"]["recovery_scan_suppressed"], 1);
    // No matching identity: leave unrelated controllers untouched, rather than
    // silently falling back to whichever adapter now has the default index.
    let session = bounded(bluer::Session::new()).await.unwrap();
    let mut missing = Some(AdapterIdentity {
        name: "hci9".into(),
        address: "02:00:00:00:00:03".parse().unwrap(),
    });
    assert!(select_adapter(&session, &mut missing).await.is_err());
}

#[tokio::test]
async fn private_dbus_receiver_only_registers_gatt_and_advertises_without_discovery() {
    const CHILD: &str = "AIRDROP_RECEIVER_ONLY_DBUS_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let mut bus = Process(
            Command::new("dbus-daemon")
                .args(["--session", "--nofork", "--print-address=1"])
                .stdout(Stdio::piped())
                .spawn()
                .unwrap(),
        );
        let mut address = String::new();
        BufReader::new(bus.0.stdout.take().unwrap())
            .read_line(&mut address)
            .unwrap();
        let address = address.trim().to_owned();
        let done = Arc::new(AtomicBool::new(false));
        let stop = done.clone();
        let ads = Arc::new(AtomicUsize::new(0));
        let observed_ads = ads.clone();
        let gatt = Arc::new(AtomicUsize::new(0));
        let observed_gatt = gatt.clone();
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let peer_address = address.clone();
        let peer = std::thread::spawn(move || {
            let conn = Connection::new_address(&peer_address).unwrap();
            conn.request_name("org.bluez", false, true, false).unwrap();
            conn.add_match(MatchRule::new_method_call(), move |_: (), conn, msg| {
                let interface = msg.interface().map(|s| s.to_string()).unwrap_or_default();
                let member = msg.member().map(|s| s.to_string()).unwrap_or_default();
                let reply = match (interface.as_str(), member.as_str()) {
                    ("org.freedesktop.DBus.ObjectManager", "GetManagedObjects") => {
                        let objects: Objects = [(dbus::Path::new("/org/bluez/hci0").unwrap(), ["org.bluez.Adapter1", "org.bluez.GattManager1", "org.bluez.LEAdvertisingManager1"].into_iter().map(|s| (s.to_string(), PropMap::new())).collect())].into();
                        msg.method_return().append1(objects)
                    }
                    ("org.freedesktop.DBus.Properties", "Get") => {
                        let (_, property): (String, String) = msg.read2().unwrap();
                        match property.as_str() {
                            "Address" => msg.method_return().append1(Variant("02:00:00:00:00:01".to_string())),
                            "Powered" => msg.method_return().append1(Variant(true)),
                            "Discovering" => msg.method_return().append1(Variant(false)),
                            "SupportedInstances" => msg.method_return().append1(Variant(5u8)),
                            "ActiveInstances" => msg.method_return().append1(Variant(0u8)),
                            "SupportedSecondaryChannels" => msg.method_return().append1(Variant(Vec::<String>::new())),
                            "SupportedCapabilities" => msg.method_return().append1(Variant(HashMap::<String,Variant<u8>>::new())),
                            _ => error(msg, "org.freedesktop.DBus.Error.UnknownProperty"),
                        }
                    }
                    ("org.bluez.GattManager1", "RegisterApplication") => { observed_gatt.fetch_add(1, Ordering::SeqCst); msg.method_return() }
                    ("org.bluez.LEAdvertisingManager1", "RegisterAdvertisement") => { observed_ads.fetch_add(1, Ordering::SeqCst); msg.method_return() }
                    ("org.bluez.GattManager1", "UnregisterApplication") | ("org.bluez.LEAdvertisingManager1", "UnregisterAdvertisement") => msg.method_return(),
                    _ => panic!("receiver-only must not scan, connect, disconnect or write global settings: {interface}.{member}"),
                };
                conn.send(reply).unwrap();
                true
            }).unwrap();
            ready_tx.send(()).unwrap();
            while !stop.load(Ordering::SeqCst) {
                conn.process(Duration::from_millis(20)).unwrap();
            }
        });
        ready_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let output = Command::new(std::env::current_exe().unwrap()).args(["--exact", "ble::radio::runtime_tests::private_dbus_receiver_only_registers_gatt_and_advertises_without_discovery", "--nocapture"]).env(CHILD, "1").env("DBUS_SYSTEM_BUS_ADDRESS", address).output().unwrap();
        done.store(true, Ordering::SeqCst);
        peer.join().unwrap();
        assert!(
            output.status.success(),
            "{} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(ads.load(Ordering::SeqCst), 2);
        assert_eq!(gatt.load(Ordering::SeqCst), 1);
        return;
    }
    let (sender, _) = broadcast::channel(32);
    let (events, mut rx) = mpsc::channel(64);
    let mut runtime =
        Runtime::start_with_visibility(*b"TEST", "Fixture".into(), sender, events, false, true);
    timeout(Duration::from_secs(5), async {
        while let Some(Event::Bluetooth(state)) = rx.recv().await {
            if state["bleAdvertising"] == true {
                break;
            }
        }
    })
    .await
    .unwrap();
    // Exercise the actual runtime beyond the old 90s renewal and 120s lease.
    // Real time avoids auto-advancing D-Bus deadlines ahead of the independent
    // peer thread. The private bus rejects scans, ACL calls and global writes.
    tokio::time::sleep(Duration::from_secs(131)).await;
    let snapshot = diag::current().snapshot();
    assert_eq!(
        snapshot["counters"]["advertisement_registration_requested"],
        1
    );
    assert_eq!(
        snapshot["counters"]["advertisement_registration_success"],
        1
    );
    assert!(snapshot["counters"]["advertisement_cleanup_requested"].is_null());
    assert_eq!(snapshot["advertising"]["timeoutSeconds"], 0);
    runtime.visibility(false);
    timeout(Duration::from_secs(5), async {
        while let Some(Event::Bluetooth(state)) = rx.recv().await {
            if state["bleAdvertising"] == false {
                return;
            }
        }
        panic!("visibility cleanup event missing");
    })
    .await
    .unwrap();
    runtime.visibility(true);
    timeout(Duration::from_secs(5), async {
        while let Some(Event::Bluetooth(state)) = rx.recv().await {
            if state["bleAdvertising"] == true {
                return;
            }
        }
        panic!("receiver visibility did not recover");
    })
    .await
    .unwrap();
    runtime.stop().await;
}
