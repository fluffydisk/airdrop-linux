// GPL-3.0-only. Byte-level socket/backpressure fixtures; no controller claim.
use super::*;
fn observer() -> Observer {
    Observer::new(
        broadcast::channel(256).0,
        "fixture".into(),
        TransferKind::Inbound,
    )
}
async fn packet<S: AsyncRead + Unpin>(s: &mut S) -> Vec<u8> {
    let n = timeout(Duration::from_secs(2), s.read_u32())
        .await
        .unwrap()
        .unwrap();
    assert!(n < 100000);
    let mut data = vec![0; n as usize];
    s.read_exact(&mut data).await.unwrap();
    data
}
#[tokio::test]
async fn independent_ack_excludes_length_prefix_and_fragments_survive() {
    let (socket, mut peer) = tokio::io::duplex(16);
    let (mut core, bridge) = tokio::io::duplex(16);
    let task = tokio::spawn(pump(socket, bridge, true, observer()));
    assert_eq!(packet(&mut peer).await, INTRO);
    let data = [0xfc, 0x9f, 0x5e, 0, 0, 0, 5, 1, 2, 3, 4, 5];
    peer.write_u32(data.len() as u32).await.unwrap();
    for byte in data {
        peer.write_all(&[byte]).await.unwrap();
    }
    assert_eq!(
        packet(&mut peer).await,
        [0, 0, 0, 8, 3, 34, 7, 10, 3, 0xfc, 0x9f, 0x5e, 16, 5]
    );
    let mut got = [0; 9];
    core.read_exact(&mut got).await.unwrap();
    assert_eq!(got, [0, 0, 0, 5, 1, 2, 3, 4, 5]);
    drop(core);
    assert!(task.await.unwrap().is_ok());
}
#[tokio::test]
async fn stalled_writer_does_not_block_incoming_payload_or_credit_progress() {
    let (socket, mut peer) = tokio::io::duplex(32);
    let (core, bridge) = tokio::io::duplex(32);
    let task = tokio::spawn(pump(socket, bridge, true, observer()));
    assert_eq!(packet(&mut peer).await, INTRO);
    let (mut core_read, mut core_write) = tokio::io::split(core);
    let output = tokio::spawn(async move {
        core_write.write_u32(16384).await.unwrap();
        core_write.write_all(&vec![7; 16384]).await.unwrap();
        core_write
    });
    let incoming = async {
        let mut bytes = vec![0xfc, 0x9f, 0x5e, 0, 0, 1, 0];
        bytes.extend([9; 256]);
        write_packet(&mut peer, &bytes).await.unwrap();
        let mut got = vec![0; 260];
        core_read.read_exact(&mut got).await.unwrap();
        assert_eq!(&got[4..], &[9; 256]);
    };
    timeout(Duration::from_secs(2), incoming).await.unwrap();
    let bytes = loop {
        let bytes = packet(&mut peer).await;
        if socket_data(&bytes).unwrap().is_some() {
            break bytes;
        }
    };
    assert_eq!(socket_data(&bytes).unwrap().unwrap().len(), 16388);
    let _core_write = output.await.unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
}
#[tokio::test]
async fn eof_keeps_complete_frames_but_rejects_truncation_and_cancels_cleanly() {
    for partial in [false, true] {
        let (socket, mut peer) = tokio::io::duplex(32);
        let (mut core, bridge) = tokio::io::duplex(32);
        let task = tokio::spawn(pump(socket, bridge, false, observer()));
        peer.write_all(if partial {
            &[0, 0, 0, 2, 1]
        } else {
            &[0, 0, 0, 2, 1, 2]
        })
        .await
        .unwrap();
        peer.shutdown().await.unwrap();
        let mut got = Vec::new();
        core.read_to_end(&mut got).await.unwrap();
        if partial {
            assert!(task.await.unwrap().is_err());
            assert!(got.is_empty());
        } else {
            assert_eq!(got, [0, 0, 0, 2, 1, 2]);
            drop(core);
            assert!(task.await.unwrap().is_ok());
        }
    }
    let (socket, mut peer) = tokio::io::duplex(32);
    let (_core, bridge) = tokio::io::duplex(32);
    let task = tokio::spawn(pump(socket, bridge, false, observer()));
    tokio::task::yield_now().await;
    task.abort();
    let _ = task.await;
    assert_eq!(peer.read(&mut [0; 1]).await.unwrap(), 0);
}
#[tokio::test(start_paused = true)]
async fn read_deadline_is_categorized_without_private_error_text() {
    let (socket, _peer) = tokio::io::duplex(32);
    let (_core, bridge) = tokio::io::duplex(32);
    let mut obs = observer();
    let (tx, mut rx) = broadcast::channel(8);
    obs.sender = tx;
    let task = tokio::spawn(pump(socket, bridge, false, obs));
    tokio::time::advance(IDLE + Duration::from_secs(1)).await;
    assert!(task.await.unwrap().is_err());
    let event = rx.recv().await.unwrap();
    assert!(matches!(
        event.msg,
        Message::Diagnostic {
            stage: "l2cap-socket-read-failed",
            cause: "deadline",
            ..
        }
    ));
}

#[tokio::test]
async fn peer_control_close_is_distinct_from_invalid_framing() {
    for valid in [true, false] {
        let (socket, mut peer) = tokio::io::duplex(64);
        let (_core, bridge) = tokio::io::duplex(64);
        let (tx, mut rx) = broadcast::channel(32);
        let obs = Observer::new(tx, "fixture".into(), TransferKind::Inbound);
        let task = tokio::spawn(pump(socket, bridge, true, obs));
        assert_eq!(packet(&mut peer).await, INTRO);
        // DISCONNECTION with correct service hash, or a foreign service.
        let mut bytes = vec![0, 0, 0, 8, 2, 26, 5, 10, 3, 0xfc, 0x9f, 0x5e];
        if !valid {
            bytes[11] = 0;
        }
        write_packet(&mut peer, &bytes).await.unwrap();
        assert!(task.await.unwrap().is_err());
        let first = rx.recv().await.unwrap();
        assert!(
            matches!(first.msg,Message::Diagnostic{stage,cause:"none",..} if stage==if valid{"l2cap-peer-disconnection"}else{"l2cap-message-rejected"})
        );
    }
}
#[test]
fn io_causes_and_per_attempt_event_budget_never_export_error_bodies() {
    let (sender, mut events) = broadcast::channel(32);
    let obs = Observer::new(sender, "fixture".into(), TransferKind::Inbound);
    let error = std::io::Error::new(
        std::io::ErrorKind::ConnectionReset,
        "AA:BB:CC:DD:EE:FF /private/file PIN-0123 token-secret",
    );
    for _ in 0..100 {
        obs.error("l2cap-socket-read-failed", &error);
    }
    let event = events.try_recv().unwrap();
    assert!(matches!(
        event.msg,
        Message::Diagnostic {
            stage: "l2cap-socket-read-failed",
            cause: "connection-reset",
            ..
        }
    ));
    assert!(!format!("{event:?}").contains("0123"));
    assert!(!format!("{event:?}").contains("private"));
    assert!(events.try_recv().is_err());
}

#[tokio::test]
async fn peer_can_wait_for_length_ack_before_releasing_payload_body() {
    let (socket, mut peer) = tokio::io::duplex(32);
    let (mut core, bridge) = tokio::io::duplex(32);
    let task = tokio::spawn(pump(socket, bridge, true, observer()));
    assert_eq!(packet(&mut peer).await, INTRO);
    peer.write_all(&[0, 0, 0, 12, 0xfc, 0x9f, 0x5e, 0, 0, 0, 5])
        .await
        .unwrap();
    assert_eq!(
        packet(&mut peer).await,
        [0, 0, 0, 8, 3, 34, 7, 10, 3, 0xfc, 0x9f, 0x5e, 16, 5]
    );
    peer.write_all(&[1, 2, 3, 4, 5]).await.unwrap();
    let mut got = [0; 9];
    core.read_exact(&mut got).await.unwrap();
    assert_eq!(got, [0, 0, 0, 5, 1, 2, 3, 4, 5]);
    drop(core);
    assert!(task.await.unwrap().is_ok());
}
#[test]
fn early_ack_rejects_mismatched_outer_inner_lengths_and_foreign_service() {
    for wire in [
        vec![0, 0, 0, 13, 0xfc, 0x9f, 0x5e, 0, 0, 0, 5],
        vec![0, 0, 0, 12, 0xfc, 0x9f, 0, 0, 0, 0, 5],
    ] {
        let mut frames = Frames::default();
        frames.push(&wire).unwrap();
        assert!(frames.socket_payload_length().is_err());
    }
}
