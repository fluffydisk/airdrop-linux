// GPL-3.0-only. Actual native/property/watcher wire contract on a private bus;
// never uses the workstation BlueZ daemon or any physical Bluetooth adapter.
use super::*;
use dbus::{
    arg::{PropMap, RefArg},
    blocking::Connection,
    channel::Sender,
    message::MatchRule,
};
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
#[derive(Clone)]
struct State {
    alias: String,
    connectable: bool,
    discoverable: bool,
    timeout: u32,
    fail_once: bool,
    sets: Vec<String>,
}
fn map(s: &State) -> PropMap {
    let mut m = PropMap::new();
    m.insert(
        "Alias".into(),
        Variant(Box::new(s.alias.clone()) as Box<dyn RefArg>),
    );
    m.insert(
        "Connectable".into(),
        Variant(Box::new(s.connectable) as Box<dyn RefArg>),
    );
    m.insert(
        "Discoverable".into(),
        Variant(Box::new(s.discoverable) as Box<dyn RefArg>),
    );
    m.insert(
        "DiscoverableTimeout".into(),
        Variant(Box::new(s.timeout) as Box<dyn RefArg>),
    );
    m
}
fn serve(
    address: String,
    state: Arc<Mutex<State>>,
    stop: Arc<AtomicBool>,
    ready: std::sync::mpsc::SyncSender<()>,
) {
    let c = Connection::new_address(&address).unwrap();
    c.request_name("org.bluez", false, true, false).unwrap();
    c.add_match(MatchRule::new_method_call(), move |_: (), conn, msg| {
        let mut s = state.lock().unwrap();
        let member = msg.member().map(|x| x.to_string()).unwrap_or_default();
        let reply = match member.as_str() {
            "GetAll" => msg.method_return().append1(map(&s)),
            "Get" => {
                let (_, key): (String, String) = msg.read2().unwrap();
                match key.as_str() {
                    "Alias" => msg.method_return().append1(Variant(s.alias.clone())),
                    "Connectable" => msg.method_return().append1(Variant(s.connectable)),
                    "Discoverable" => msg.method_return().append1(Variant(s.discoverable)),
                    "DiscoverableTimeout" => msg.method_return().append1(Variant(s.timeout)),
                    _ => panic!("unexpected property"),
                }
            }
            "Set" => {
                let (_, key): (String, String) = msg.read2().unwrap();
                s.sets.push(key.clone());
                match key.as_str() {
                    "Alias" => {
                        let (_, _, v): (String, String, Variant<String>) = msg.read3().unwrap();
                        s.alias = v.0;
                    }
                    "Connectable" => {
                        let (_, _, v): (String, String, Variant<bool>) = msg.read3().unwrap();
                        s.connectable = v.0;
                    }
                    "Discoverable" => {
                        let (_, _, v): (String, String, Variant<bool>) = msg.read3().unwrap();
                        s.discoverable = v.0;
                    }
                    "DiscoverableTimeout" => {
                        let (_, _, v): (String, String, Variant<u32>) = msg.read3().unwrap();
                        if s.fail_once && v.0 == 90 {
                            s.fail_once = false;
                            conn.send(msg.error(
                                &dbus::strings::ErrorName::new("org.bluez.Error.Failed").unwrap(),
                                &std::ffi::CString::new("simulated").unwrap(),
                            ))
                            .unwrap();
                            return true;
                        }
                        s.timeout = v.0;
                    }
                    _ => panic!("unexpected property"),
                }
                msg.method_return()
            }
            _ => panic!("unexpected method"),
        };
        conn.send(reply).unwrap();
        true
    })
    .unwrap();
    ready.send(()).unwrap();
    while !stop.load(Ordering::Relaxed) {
        c.process(Duration::from_millis(10)).unwrap();
    }
}
fn wait(child: &mut Child) -> bool {
    let began = std::time::Instant::now();
    while began.elapsed() < Duration::from_secs(15) {
        if let Some(s) = child.try_wait().unwrap() {
            return s.success();
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    false
}

#[test]
fn private_bus_native_setup_and_crash_safe_watcher_rollback() {
    if std::env::var("AIRDROP_CLASSIC_INQUIRY_TEST_CLIENT").as_deref() == Ok("1") {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let full = super::super::protocol::receiver(*b"AB12", "Linux", None).unwrap();
            let result = Lease::start("hci0", &full).await;
            if std::env::var("AIRDROP_CLASSIC_INQUIRY_TEST_FAIL").as_deref() == Ok("1") {
                assert!(result.is_err());
            } else {
                let lease = result.unwrap();
                assert!(lease.active());
                if std::env::var("AIRDROP_CLASSIC_INQUIRY_TEST_HOLD").as_deref() == Ok("1") {
                    tokio::time::sleep(Duration::from_secs(30)).await;
                }
                drop(lease);
            }
        });
        return;
    }
    let mut daemon = Process(
        Command::new("dbus-daemon")
            .args(["--session", "--nofork", "--print-address=1"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let mut address = String::new();
    BufReader::new(daemon.0.stdout.take().unwrap())
        .read_line(&mut address)
        .unwrap();
    let address = address.trim().to_owned();
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    for (fail, crash) in [(false, false), (true, false), (false, true)] {
        let dir = std::env::temp_dir().join(format!(
            "airdrop-inquiry-{}-{}",
            std::process::id(),
            rand::random::<u64>()
        ));
        fs::create_dir(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
        let file = dir.join("classic-lease.json");
        let state = Arc::new(Mutex::new(State {
            alias: "PRIVATE-ORIGINAL".into(),
            connectable: false,
            discoverable: false,
            timeout: 180,
            fail_once: fail,
            sets: vec![],
        }));
        let stop = Arc::new(AtomicBool::new(false));
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let (s, z, a) = (state.clone(), stop.clone(), address.clone());
        let server = std::thread::spawn(move || serve(a, s, z, tx));
        rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let code = "const{watch,adapterIo}=require('./scripts/quickshare-lab/classic-radio-watch.cjs');watch(process.argv[1],{ioFactory:a=>adapterIo(a,{address:process.argv[2]})}).then(x=>process.exitCode=x.fullyRestored?0:1,()=>process.exitCode=1);";
        let mut watcher = Process(
            Command::new("node")
                .args(["-e", code])
                .arg(&file)
                .arg(&address)
                .current_dir(&root)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        );
        let mut client=Process(Command::new(std::env::current_exe().unwrap()).args(["--exact","ble::classic_inquiry::tests::private_bus_native_setup_and_crash_safe_watcher_rollback"]).env("AIRDROP_CLASSIC_INQUIRY_TEST_CLIENT","1").env("AIRDROP_CLASSIC_INQUIRY_TEST_FAIL",if fail{"1"}else{"0"}).env("AIRDROP_CLASSIC_INQUIRY_TEST_HOLD",if crash{"1"}else{"0"}).env("DBUS_SYSTEM_BUS_ADDRESS",&address).env("AIRDROP_S24_LAB_CLASSIC","1").env("AIRDROP_S24_LAB_CLASSIC_LEASE",&file).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap());
        if crash {
            let began = std::time::Instant::now();
            while !state.lock().unwrap().discoverable && began.elapsed() < Duration::from_secs(5) {
                std::thread::sleep(Duration::from_millis(5));
            }
            assert!(state.lock().unwrap().discoverable);
            client.0.kill().unwrap(); // only this in-memory owned test process
            // Leave the dead child unreaped: a zombie must not retain the lease.
            assert!(wait(&mut watcher.0), "crash rollback watcher failed");
            let report: serde_json::Value =
                serde_json::from_slice(&fs::read(file.with_extension("result")).unwrap()).unwrap();
            assert_eq!(report["reason"], "owner-exited");
            let _ = client.0.wait();
        } else {
            assert!(wait(&mut client.0), "private native lease client failed");
            assert!(wait(&mut watcher.0), "private rollback watcher failed");
        }
        let s = state.lock().unwrap();
        assert_eq!(s.alias, "PRIVATE-ORIGINAL");
        assert!(!s.connectable && !s.discoverable);
        assert_eq!(s.timeout, 180);
        assert_eq!(s.sets.first().unwrap(), "Alias");
        assert_eq!(s.sets.last().unwrap(), "Alias");
        drop(s);
        stop.store(true, Ordering::Relaxed);
        server.join().unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
}
