// GPL-3.0-only. Real private D-Bus exchange, without a controller or RF claim.
use super::*;
use dbus::{blocking::Connection, channel::Sender, message::MatchRule};
use std::{
    io::{BufRead, BufReader},
    process::{Child, Command, Stdio},
    sync::atomic::AtomicUsize,
};

struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
#[derive(Default)]
struct Seen {
    starts: AtomicUsize,
    stops: AtomicUsize,
    raced: AtomicUsize,
    hci1: AtomicBool,
    delayed: AtomicBool,
}

#[tokio::test]
async fn private_dbus_scan_stop_cancel_failure_and_changed_adapter() {
    const CHILD: &str = "AIRDROP_DISCOVERY_DBUS_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let mut bus = Process(
            Command::new("dbus-daemon")
                .args(["--session", "--nofork", "--print-address=1"])
                .stdout(Stdio::piped())
                .spawn()
                .expect("dbus-daemon test dependency"),
        );
        let mut address = String::new();
        BufReader::new(bus.0.stdout.take().unwrap())
            .read_line(&mut address)
            .unwrap();
        let address = address.trim().to_owned();
        let seen = Arc::new(Seen::default());
        let server_seen = seen.clone();
        let done = Arc::new(AtomicBool::new(false));
        let stop = done.clone();
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let server_address = address.clone();
        let server = std::thread::spawn(move || {
            let conn = Connection::new_address(&server_address).unwrap();
            conn.request_name("org.bluez", false, true, false).unwrap();
            let pending = Arc::new(std::sync::Mutex::new(None::<(dbus::Message, Instant)>));
            let replies = pending.clone();
            let seen = server_seen;
            let send_seen = seen.clone();
            conn.add_match(MatchRule::new_method_call(), move |_: (), conn, msg| {
                assert_eq!(msg.interface().unwrap().to_string(), IFACE);
                let reply = match msg.member().unwrap().as_ref() {
                    "SetDiscoveryFilter" => {
                        let (filter,): (PropMap,) = msg.read1().map(|v| (v,)).unwrap();
                        assert_eq!(filter.len(), 3);
                        assert_eq!(filter["Transport"].0.as_str(), Some("le"));
                        assert_eq!(filter["Discoverable"].0.as_i64(), Some(0));
                        msg.method_return()
                    }
                    "StartDiscovery" => {
                        send_seen.starts.fetch_add(1, Ordering::SeqCst);
                        if replies.lock().unwrap().is_some() {
                            send_seen.raced.fetch_add(1, Ordering::SeqCst);
                        }
                        if msg.path().unwrap().to_string() == "/org/bluez/hci1" {
                            send_seen.hci1.store(true, Ordering::SeqCst);
                        }
                        msg.method_return()
                    }
                    "StopDiscovery" => {
                        let n = send_seen.stops.fetch_add(1, Ordering::SeqCst) + 1;
                        if n == 1 || n == 2 {
                            send_seen.delayed.store(true, Ordering::SeqCst);
                            *replies.lock().unwrap() = Some((
                                msg.method_return(),
                                Instant::now() + Duration::from_millis(200),
                            ));
                            return true;
                        }
                        if n == 3 {
                            msg.error(
                                &dbus::strings::ErrorName::new("org.bluez.Error.Failed").unwrap(),
                                &std::ffi::CString::new(
                                    "AA:BB:CC:DD:EE:FF /private/secret account@example.org",
                                )
                                .unwrap(),
                            )
                        } else if n == 4 {
                            return true;
                        }
                        // No reply: bounded timeout.
                        else {
                            msg.method_return()
                        }
                    }
                    _ => panic!("unrelated adapter or device method"),
                };
                conn.send(reply).unwrap();
                true
            })
            .unwrap();
            ready_tx.send(()).unwrap();
            while !stop.load(Ordering::Relaxed) {
                conn.process(Duration::from_millis(10)).unwrap();
                let mut slot = pending.lock().unwrap();
                if slot.as_ref().is_some_and(|(_, at)| Instant::now() >= *at) {
                    let (reply, _) = slot.take().unwrap();
                    conn.send(reply).unwrap();
                }
            }
        });
        ready_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "ble::discovery::tests::private_dbus_scan_stop_cancel_failure_and_changed_adapter",
                "--nocapture",
            ])
            .env(CHILD, "1")
            .env("DBUS_SYSTEM_BUS_ADDRESS", address)
            .output()
            .unwrap();
        done.store(true, Ordering::Relaxed);
        server.join().unwrap();
        assert!(
            output.status.success(),
            "{} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(seen.starts.load(Ordering::SeqCst), 5);
        assert_eq!(seen.stops.load(Ordering::SeqCst), 5);
        assert_eq!(seen.raced.load(Ordering::SeqCst), 0);
        assert!(seen.hci1.load(Ordering::SeqCst));
        assert!(seen.delayed.load(Ordering::SeqCst));
        return;
    }
    let scan = Arc::new(Discovery::default());
    scan.start("hci0").await.unwrap();
    assert!(scan.active());
    inbound_during_scan_then_handshake_cancel(scan.clone()).await;
    scan.start("hci0").await.unwrap();
    let stopping = scan.clone();
    let task = tokio::spawn(async move { stopping.stop().await });
    tokio::time::sleep(Duration::from_millis(80)).await;
    task.abort();
    let _ = task.await; // The stop itself must survive this cancellation.
    scan.start("hci0").await.unwrap();
    assert!(scan.stop().await.is_err());
    assert!(!scan.healthy());
    assert!(!scan.active());
    assert!(scan.start("hci0").await.is_err()); // No retry in an unhealthy generation.
    let replacement = Discovery::default();
    replacement.start("hci1").await.unwrap();
    assert!(replacement.stop().await.is_err());
    assert!(!replacement.healthy());
    let final_generation = Discovery::default();
    final_generation.start("hci1").await.unwrap();
    final_generation.stop().await.unwrap();
    final_generation.stop().await.unwrap(); // Idempotent shutdown, no extra stop.
    let state = diag::current().snapshot();
    assert!(
        state["counters"]["scan_stop_acknowledged"]
            .as_u64()
            .unwrap()
            >= 2
    );
    assert!(!state.to_string().contains("private"));
}

// Small independent protobuf encoder using the public Nearby/UKEY2 field
// numbers, not the core's generated encoders. Stop at ServerInit: the dummy
// commitment is deliberately never presented as an authenticated session.
fn number(mut n: usize) -> Vec<u8> {
    let mut b = Vec::new();
    while n > 127 {
        b.push((n as u8 & 127) | 128);
        n >>= 7;
    }
    b.push(n as u8);
    b
}
fn bytes(field: u8, b: &[u8]) -> Vec<u8> {
    [vec![(field << 3) | 2], number(b.len()), b.to_vec()].concat()
}
async fn inbound_during_scan_then_handshake_cancel(scan: Arc<Discovery>) {
    use rqs_lib::{
        TransferState,
        channel::{ChannelMessage, Message},
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let (socket, mut peer) = tokio::io::duplex(4096);
    let (sender, mut messages) = tokio::sync::broadcast::channel(32);
    let (events, _) = tokio::sync::mpsc::channel(16);
    let full = super::super::protocol::receiver(*b"TEST", "Fixture", None).unwrap();
    let session = tokio::spawn(async move {
        super::super::radio::serve_l2cap(
            socket,
            &full,
            sender,
            events,
            "fixture-session".into(),
            scan,
            &std::sync::atomic::AtomicBool::new(false),
        )
        .await
    });
    peer.write_all(&[3]).await.unwrap();
    assert!(
        timeout(Duration::from_millis(50), peer.read_u8())
            .await
            .is_err(),
        "bootstrap must wait for StopDiscovery reply"
    );
    assert_eq!(
        timeout(Duration::from_secs(2), peer.read_u8())
            .await
            .unwrap()
            .unwrap(),
        23
    );
    let endpoint = [vec![2], vec![0; 16], vec![1, b'T']].concat();
    let request = [bytes(1, b"TEST"), bytes(2, b"T"), bytes(6, &endpoint)].concat();
    let request = [
        vec![8, 1],
        bytes(2, &[vec![8, 1], bytes(2, &request)].concat()),
    ]
    .concat();
    let init = [
        vec![8, 1],
        bytes(2, &[0; 32]),
        bytes(3, &[vec![8, 100], bytes(2, &[0; 64])].concat()),
        bytes(4, b"AES_256_CBC-HMAC_SHA256"),
    ]
    .concat();
    let init = [vec![8, 2], bytes(2, &init)].concat();
    for frame in [request, init] {
        peer.write_u32(frame.len() as u32).await.unwrap();
        peer.write_all(&frame).await.unwrap();
    }
    let length = timeout(Duration::from_secs(2), peer.read_u32())
        .await
        .unwrap()
        .unwrap();
    assert!(length > 0 && length < 1024);
    let mut server_init = vec![0; length as usize];
    peer.read_exact(&mut server_init).await.unwrap();
    assert_eq!(&server_init[..2], &[8, 3]);
    timeout(Duration::from_secs(2), async {
        loop {
            if matches!(
                messages.recv().await.unwrap(),
                ChannelMessage {
                    msg: Message::Protocol {
                        stage: TransferState::SentUkeyServerInit,
                        ..
                    },
                    ..
                }
            ) {
                break;
            }
        }
    })
    .await
    .unwrap();
    // Same cancellation primitive used by generation teardown. Closing the old
    // transport must report interruption and must never invent consent/success.
    session.abort();
    let _ = session.await;
    assert_eq!(
        timeout(Duration::from_secs(2), peer.read(&mut [0; 1]))
            .await
            .unwrap()
            .unwrap(),
        0
    );
    let mut disconnected = false;
    while let Ok(m) = messages.try_recv() {
        if let Message::Client(c) = m.msg {
            assert!(!matches!(
                c.state,
                Some(TransferState::Finished | TransferState::ReceivingFiles)
            ));
            disconnected |= c.state == Some(TransferState::Disconnected);
        }
    }
    assert!(disconnected);
}
