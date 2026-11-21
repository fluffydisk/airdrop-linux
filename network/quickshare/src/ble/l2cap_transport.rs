// GPL-3.0-only. Bounded full-duplex Nearby BLE socket bridge. LE CoC credits
// and MTU segmentation remain owned by Linux/bluer; no application credit fiction.
use super::{diagnostics::inc, protocol::*};
use anyhow::{Result, ensure};
use rqs_lib::channel::{ChannelMessage, Message, TransferKind};
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, DuplexStream},
    sync::{broadcast, mpsc},
    time::timeout,
};
const IDLE: Duration = Duration::from_secs(60);
const CONTROL: Duration = Duration::from_secs(5);
#[derive(Clone)]
pub(super) struct Observer {
    pub sender: broadcast::Sender<ChannelMessage>,
    pub id: String,
    pub kind: TransferKind,
    seen: Arc<Mutex<HashSet<(&'static str, &'static str)>>>,
}
impl Observer {
    pub fn new(sender: broadcast::Sender<ChannelMessage>, id: String, kind: TransferKind) -> Self {
        Self {
            sender,
            id,
            kind,
            seen: Default::default(),
        }
    }
    pub fn event(&self, stage: &'static str, cause: &'static str) {
        inc(&stage.replace('-', "_"));
        // Per-frame counters remain bounded; the timeline records each closed
        // stage/cause pair once per session instead of flooding the event bus.
        if !self.seen.lock().unwrap().insert((stage, cause)) {
            return;
        }
        let _ = self.sender.send(ChannelMessage {
            id: self.id.clone(),
            msg: Message::Diagnostic {
                kind: self.kind.clone(),
                stage,
                cause,
            },
        });
    }
    fn error(&self, stage: &'static str, e: &std::io::Error) {
        inc("l2cap_transport_io_error");
        use std::io::ErrorKind as E;
        self.event(
            stage,
            match e.kind() {
                E::ConnectionReset => "connection-reset",
                E::ConnectionAborted => "connection-aborted",
                E::BrokenPipe => "broken-pipe",
                E::NotConnected => "not-connected",
                E::TimedOut => "timed-out",
                E::PermissionDenied => "permission-denied",
                E::UnexpectedEof => "unexpected-eof",
                E::InvalidData | E::InvalidInput => "invalid-data",
                _ => "other-io",
            },
        );
    }
}
async fn io<T>(
    limit: Duration,
    operation: impl std::future::Future<Output = std::io::Result<T>>,
    observer: &Observer,
    stage: &'static str,
) -> Result<T> {
    match timeout(limit, operation).await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => {
            observer.error(stage, &e);
            Err(e.into())
        }
        Err(e) => {
            inc("l2cap_transport_timeout");
            observer.event(stage, "deadline");
            Err(e.into())
        }
    }
}
async fn write_packet<S: AsyncWrite + Unpin>(s: &mut S, bytes: &[u8]) -> std::io::Result<()> {
    s.write_u32(bytes.len() as u32).await?;
    s.write_all(bytes).await
}
/// A writer waiting for Linux credits must not prevent the reader replenishing
/// the peer's credits. There is exactly one socket writer, an eight-entry control
/// queue and one bounded frame accumulator per direction. Dropping this future
/// cancels all halves; no detached task or socket ownership survives cancellation.
pub(super) async fn pump<S: AsyncRead + AsyncWrite + Unpin>(
    socket: S,
    bridge: DuplexStream,
    framed: bool,
    observer: Observer,
) -> Result<()> {
    struct Closed(Observer);
    impl Drop for Closed {
        fn drop(&mut self) {
            self.0.event("l2cap-bridge-closed", "none");
        }
    }
    let _closed = Closed(observer.clone());
    let (mut read, mut write) = tokio::io::split(socket);
    let (mut core_read, mut core_write) = tokio::io::split(bridge);
    let (ack_tx, mut ack_rx) = mpsc::channel::<Vec<u8>>(8);
    let receive = async {
        let mut frames = Frames::default();
        let mut rx = [0; 4096];
        let mut acknowledged = false;
        loop {
            let n = io(
                IDLE,
                read.read(&mut rx),
                &observer,
                "l2cap-socket-read-failed",
            )
            .await?;
            if n == 0 {
                observer.event("l2cap-peer-eof", "none");
                if !frames.is_empty() {
                    observer.event("l2cap-frame-rejected", "unexpected-eof");
                }
                ensure!(frames.is_empty(), "truncated socket frame");
                // Let the core consume all complete buffered frames before EOF.
                core_write.shutdown().await?;
                return Ok::<_, anyhow::Error>(());
            }
            frames
                .push(&rx[..n])
                .inspect_err(|_| observer.event("l2cap-frame-rejected", "none"))?;
            loop {
                if framed
                    && !acknowledged
                    && let Some(size) = frames
                        .socket_payload_length()
                        .inspect_err(|_| observer.event("l2cap-message-rejected", "none"))?
                {
                    let ack = acknowledgement(size)?;
                    timeout(CONTROL, ack_tx.send(ack))
                        .await
                        .inspect_err(|_| observer.event("l2cap-ack-queue-failed", "deadline"))?
                        .map_err(|_| {
                            observer.event("l2cap-ack-queue-failed", "not-connected");
                            anyhow::anyhow!("control writer closed")
                        })?;
                    acknowledged = true;
                }
                let Some(frame) = frames
                    .pop()
                    .inspect_err(|_| observer.event("l2cap-frame-rejected", "none"))?
                else {
                    break;
                };
                acknowledged = false;
                let data = if framed {
                    socket_data(&frame[4..]).inspect_err(|e| {
                        observer.event(
                            if e.is::<PeerSocketDisconnection>() {
                                "l2cap-peer-disconnection"
                            } else {
                                "l2cap-message-rejected"
                            },
                            "none",
                        )
                    })?
                } else {
                    Some(frame.as_slice())
                };
                if let Some(data) = data {
                    io(
                        IDLE,
                        core_write.write_all(data),
                        &observer,
                        "l2cap-core-write-failed",
                    )
                    .await?;
                    observer.event("l2cap-data-received", "none");
                } else {
                    observer.event("l2cap-control-received", "none");
                }
            }
        }
    };
    let transmit = async {
        if framed {
            io(
                CONTROL,
                write_packet(&mut write, INTRO),
                &observer,
                "l2cap-socket-write-failed",
            )
            .await?;
        }
        let mut frames = Frames::default();
        let mut tx = [0; 4096];
        let mut controls_open = true;
        loop {
            tokio::select! {
                // Controls are tiny, bounded, and cannot interleave a data frame.
                ack = ack_rx.recv(), if framed && controls_open => match ack {
                    Some(ack) => {
                        io(CONTROL, write_packet(&mut write, &ack), &observer, "l2cap-socket-write-failed").await?;
                        observer.event("l2cap-ack-written", "none");
                    }
                    None => controls_open = false,
                },
                n = core_read.read(&mut tx) => {
                    let n = n.inspect_err(|e| observer.error("l2cap-core-read-failed", e))?;
                    if n == 0 {
                        ensure!(frames.is_empty(), "truncated core frame");
                        observer.event("l2cap-core-eof", "none");
                        return Ok::<_, anyhow::Error>(());
                    }
                    frames.push(&tx[..n]).inspect_err(|_| observer.event("l2cap-frame-rejected", "none"))?;
                    while let Some(frame) = frames.pop().inspect_err(|_| observer.event("l2cap-frame-rejected", "none"))? {
                        let bytes = if framed {
                            let mut message = HASH.to_vec(); message.extend(frame);
                            let mut bytes = (message.len() as u32).to_be_bytes().to_vec();
                            bytes.extend(message); bytes
                        } else { frame };
                        io(IDLE, write.write_all(&bytes), &observer, "l2cap-socket-write-failed").await?;
                        observer.event("l2cap-data-written", "none");
                    }
                }
            }
        }
    };
    tokio::pin!(receive, transmit);
    let result = tokio::select! {
        result = &mut receive => {
            result?;
            // A clean peer half-close can follow the last payload immediately.
            // Keep draining the core's final encrypted response boundedly.
            timeout(IDLE, &mut transmit).await?
        },
        result = &mut transmit => result,
    };
    result
}

#[cfg(test)]
#[path = "l2cap_transport_test.rs"]
mod tests;
