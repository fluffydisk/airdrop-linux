// GPL-3.0-only. Independent Python/OpenSSL client through production L2CAP
// framing, Engine events and encrypted consent. TCP supplies test bytes only;
// this does not emulate Linux HCI/LE credits or demonstrate Samsung acceptance.
use super::*;
use std::{os::unix::fs::DirBuilderExt, process::Stdio};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
};
#[tokio::test]
async fn independent_l2cap_peer_consent_payload_bwu_rejection_and_integrity() {
    const CHILD: &str = "AIRDROP_L2CAP_TEST_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let result = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "ble::radio::peer_tests::independent_l2cap_peer_consent_payload_bwu_rejection_and_integrity", "--nocapture"])
            .env(CHILD,"1").env_remove("AIRDROP_S24_LAB_SMALL_SDU").kill_on_drop(true).output();
        let output = timeout(Duration::from_secs(90), result)
            .await
            .unwrap()
            .unwrap();
        assert!(
            output.status.success(),
            "Independent BLE fixture failed: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    exercise(&[
        "small",
        "binary",
        "empty",
        "decline",
        "bad-commitment",
        "bad-mac",
        "replay",
    ])
    .await;
}
pub(crate) async fn exercise(cases: &[&str]) {
    exercise_transport(cases, false).await;
}
async fn exercise_transport(cases: &[&str], classic: bool) {
    struct Root(std::path::PathBuf);
    impl Drop for Root {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    let root =
        Root(std::env::temp_dir().join(format!("l2cap-peer-{:032x}", rand::random::<u128>())));
    std::fs::DirBuilder::new()
        .mode(0o700)
        .create(&root.0)
        .unwrap();
    for &case in cases {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (sender, mut messages) = broadcast::channel(256);
        let server_sender = sender.clone();
        let full = receiver(*b"TEST", "Fixture", None).unwrap();
        let server = tokio::spawn(async move {
            let (socket, _) = listener.accept().await?;
            if classic {
                return serve_classic(
                    socket,
                    server_sender,
                    mpsc::channel(16).0,
                    "independent-ble".into(),
                    CancellationToken::new(),
                    *b"TEST",
                )
                .await;
            }
            receive_l2cap(
                socket,
                &full,
                server_sender,
                mpsc::channel(16).0,
                "independent-ble".into(),
                Arc::new(Discovery::default()),
                CancellationToken::new(),
            )
            .await
        });
        let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../tests/quickshare-independent.py");
        let mut peer = Command::new("/usr/bin/python3")
            .arg(script)
            .arg(case)
            .env("AIRDROP_TEST_L2CAP_DRIVER", "1")
            .env(
                "AIRDROP_TEST_CLASSIC_DRIVER",
                if classic { "1" } else { "0" },
            )
            .env("TMPDIR", &root.0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut input = peer.stdin.take().unwrap();
        let mut output = BufReader::new(peer.stdout.take().unwrap()).lines();
        let mut engine = crate::Engine::new();
        engine.protocol_diagnostics = true;
        let mut consent = false;
        let driver = async {
            loop {
                tokio::select! {
                    line=output.next_line()=>{
                        let Some(line)=line? else { break; };
                        ensure!(line.len()<65536,"fixture IPC limit");
                        let req:serde_json::Value=serde_json::from_str(&line)?;
                        let result=match req["method"].as_str(){
                            Some("fixture-stop")=>json!({}),
                            Some("hello")=>json!({"protocol":1}),
                            Some("start")=>{
                                let path=std::path::PathBuf::from(req["params"]["staging"].as_str().unwrap());
                                ensure!(path.starts_with(&root.0),"fixture directory");
                                let _=rqs_lib::RQS::new(rqs_lib::Visibility::Visible,None,Some(path),Some("Fixture".into()));
                                json!({"port":port})
                            },
                            Some("respond")=>{
                                let id=req["params"]["transferId"].as_str().unwrap();
                                ensure!(engine.consent.remove(id).is_some(),"missing consent gate");
                                consent=req["params"]["accept"]==true;
                                sender.send(ChannelMessage{id:id.into(),msg:Message::Lib{action:if consent{rqs_lib::channel::TransferAction::ConsentAccept}else{rqs_lib::channel::TransferAction::ConsentDecline}}})?;
                                json!({"accepted":true})
                            },
                            _=>bail!("unknown fixture command"),
                        };
                        let mut wire=serde_json::to_vec(&json!({"v":1,"id":req["id"],"result":result}))?;wire.push(b'\n');input.write_all(&wire).await?;
                        if req["method"] == "fixture-stop" { input.shutdown().await?; break; }
                    },
                    message=messages.recv()=>{
                        if let Some(event)=engine.protocol(message?) {
                            let mut wire=serde_json::to_vec(&event)?;wire.push(b'\n');input.write_all(&wire).await?;
                        }
                    }
                }
            }
            Ok::<_, anyhow::Error>(())
        };
        timeout(Duration::from_secs(12), driver)
            .await
            .unwrap()
            .unwrap();
        drop(input);
        let status = timeout(Duration::from_secs(3), peer.wait())
            .await
            .unwrap()
            .unwrap();
        if !status.success() {
            let mut stderr = String::new();
            peer.stderr
                .take()
                .unwrap()
                .read_to_string(&mut stderr)
                .await
                .unwrap();
            panic!("Independent BLE {case} failed: {stderr}");
        }
        let _ = timeout(Duration::from_secs(2), server)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(consent, matches!(case, "small" | "binary" | "empty"));
        let end = engine.transfers.get("independent-ble").unwrap();
        if case == "binary" {
            assert_eq!(
                end["initialConnectionMethod"],
                if classic { "bt-rfcomm" } else { "ble-l2cap" }
            );
            assert_eq!(end["connectionMethod"], "lan-tcp");
        }
        assert_eq!(
            end["phase"],
            if matches!(case, "small" | "binary" | "empty") {
                "complete"
            } else if case == "decline" {
                "declined"
            } else {
                "interrupted"
            }
        );
    }
}

#[tokio::test]
async fn independent_encrypted_peer_with_single_hci_sdu_writes() {
    let output = timeout(Duration::from_secs(90),
        Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "ble::radio::peer_tests::independent_l2cap_peer_consent_payload_bwu_rejection_and_integrity", "--nocapture"])
        .env("AIRDROP_L2CAP_TEST_CHILD", "1").env("AIRDROP_S24_LAB_SMALL_SDU", "1")
        .kill_on_drop(true).output()).await.unwrap().unwrap();
    assert!(
        output.status.success(),
        "Small SDU independent fixture failed: {} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[tokio::test]
async fn independent_classic_peer_consent_and_file_integrity() {
    const CHILD: &str = "AIRDROP_CLASSIC_TEST_CHILD";
    if std::env::var_os(CHILD).is_none() {
        let output = timeout(
            Duration::from_secs(90),
            Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "ble::radio::peer_tests::independent_classic_peer_consent_and_file_integrity",
                    "--nocapture",
                ])
                .env(CHILD, "1")
                .kill_on_drop(true)
                .output(),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(
            output.status.success(),
            "Classic independent fixture failed: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        return;
    }
    exercise_transport(
        &[
            "small",
            "binary",
            "empty",
            "decline",
            "bad-commitment",
            "bad-mac",
            "replay",
        ],
        true,
    )
    .await;
}
