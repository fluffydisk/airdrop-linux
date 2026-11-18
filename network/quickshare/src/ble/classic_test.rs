// GPL-3.0-only. Independent private ProfileManager; never contacts the real bus.
use super::*;
use dbus::{arg::PropMap, blocking::Connection, channel::Sender, message::MatchRule};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};
struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
#[tokio::test]
async fn private_bus_publishes_record_and_removes_only_owned_profile() {
    const CHILD: &str = "AIRDROP_CLASSIC_PROFILE_CHILD";
    if std::env::var_os(CHILD).is_some() {
        let session = Session::new().await.unwrap();
        let record = publish_record(&session, 7).await.unwrap();
        drop(record);
        tokio::time::sleep(Duration::from_millis(300)).await;
        return;
    }
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
    let address = address.trim().to_string();
    let registered = Arc::new(AtomicUsize::new(0));
    let unregistered = Arc::new(AtomicUsize::new(0));
    let done = Arc::new(AtomicBool::new(false));
    let stop = done.clone();
    let regs = registered.clone();
    let unregs = unregistered.clone();
    let peer_address = address.clone();
    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
    let peer = std::thread::spawn(move || {
        let c = Connection::new_address(&peer_address).unwrap();
        c.request_name("org.bluez", false, true, false).unwrap();
        c.add_match(MatchRule::new_method_call(),move|_:(),c,msg|{
            let interface=msg.interface().map(|s|s.to_string()).unwrap_or_default();let member=msg.member().map(|s|s.to_string()).unwrap_or_default();
            let reply=match(interface.as_str(),member.as_str()){
                ("org.freedesktop.DBus.ObjectManager","GetManagedObjects")=>msg.method_return().append1(HashMap::<dbus::Path<'static>,HashMap<String,PropMap>>::new()),
                ("org.bluez.ProfileManager1","RegisterProfile")=>{
                    let (_path,uuid,options):(dbus::Path<'static>,String,PropMap)=msg.read3().unwrap();
                    // Literal from the independent Nearby/Java name-UUID oracle.
                    assert_eq!(uuid,"a82efa21-ae5c-3dde-9bbc-f16da7b16c5a");
                    assert_eq!(options["Role"].0.as_str(),Some("server"));
                    assert_eq!(options["AutoConnect"].0.as_u64(),Some(0));
                    assert_eq!(options["RequireAuthentication"].0.as_u64(),Some(0));
                    assert_eq!(options["RequireAuthorization"].0.as_u64(),Some(0));
                    assert!(!options.contains_key("Channel")&&!options.contains_key("PSM"));
                    assert!(options["ServiceRecord"].0.as_str().unwrap().contains("<uint8 value=\"0x07\"/>"));
                    regs.fetch_add(1,Ordering::SeqCst);msg.method_return()
                },
                ("org.bluez.ProfileManager1","UnregisterProfile")=>{unregs.fetch_add(1,Ordering::SeqCst);msg.method_return()},
                _=>panic!("unexpected method {interface}.{member}; no global radio, agent or device operations allowed"),
            };c.send(reply).unwrap();true
        }).unwrap();
        ready_tx.send(()).unwrap();
        while !stop.load(Ordering::SeqCst) {
            c.process(Duration::from_millis(10)).unwrap();
        }
    });
    ready_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    let output=Command::new(std::env::current_exe().unwrap()).args(["--exact","ble::classic::registration_tests::private_bus_publishes_record_and_removes_only_owned_profile","--nocapture"]).env(CHILD,"1").env("DBUS_SYSTEM_BUS_ADDRESS",address).output().unwrap();
    done.store(true, Ordering::SeqCst);
    peer.join().unwrap();
    assert!(
        output.status.success(),
        "{} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(registered.load(Ordering::SeqCst), 1);
    assert_eq!(unregistered.load(Ordering::SeqCst), 1);
}
