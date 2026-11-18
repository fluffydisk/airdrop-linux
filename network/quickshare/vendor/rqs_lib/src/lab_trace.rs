// GPL-3.0-only. Opt-in metadata-only laboratory observation; never a transport policy.
// A nonblocking Unix datagram sink cannot backpressure a file/audio session.
use std::sync::LazyLock;
#[cfg(target_os = "linux")]
use std::{
    os::unix::net::UnixDatagram,
    sync::atomic::{AtomicU64, Ordering},
};
use std::{
    pin::Pin,
    task::{Context, Poll},
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

const MAX_RECORDS: u64 = 10_000;
const MAX_NS: u64 = 180_000_000_000;
fn allowed(stage: &str) -> bool {
    matches!(
        stage,
        "trace-start"
            | "radio-stage"
            | "gatt-read"
            | "gatt-write"
            | "gatt-notify"
            | "state"
            | "frame-header"
            | "frame-body-read"
            | "frame-write-enter"
            | "frame-write-return"
            | "offline-decoded"
            | "payload-header"
            | "file-body-written"
            | "consent-received"
            | "consent-response-enter"
            | "consent-response-written"
            | "rfcomm-arrived"
            | "read-enter"
            | "read-return"
            | "write-enter"
            | "write-return"
            | "flush-return"
            | "shutdown-enter"
            | "shutdown-return"
            | "transport-drop"
            | "session-cancel"
            | "session-end"
            | "owner-stop"
    )
}
#[cfg(target_os = "linux")]
pub fn monotonic_ns() -> u64 {
    let mut t = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // No wall clock / Instant epoch conversion. Same domain as nsecs(monotonic).
    if unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut t) } != 0 {
        return 0;
    }
    (t.tv_sec as u64)
        .saturating_mul(1_000_000_000)
        .saturating_add(t.tv_nsec as u64)
}
#[cfg(not(target_os = "linux"))]
pub fn monotonic_ns() -> u64 {
    0
}
#[cfg(target_os = "linux")]
struct Trace {
    socket: UnixDatagram,
    start: u64,
    attempted: AtomicU64,
    lost: AtomicU64,
    terminal: AtomicU64,
}
#[cfg(target_os = "linux")]
impl Trace {
    fn new(socket: UnixDatagram) -> std::io::Result<Self> {
        socket.set_nonblocking(true)?;
        Ok(Self {
            socket,
            start: monotonic_ns(),
            attempted: AtomicU64::new(0),
            lost: AtomicU64::new(0),
            terminal: AtomicU64::new(0),
        })
    }
    fn emit(&self, stage: &str, a: u64, b: i64) {
        let now = monotonic_ns();
        if !allowed(stage) || now == 0 || now.saturating_sub(self.start) > MAX_NS {
            return;
        }
        let terminal = stage == "owner-stop" && a == 1;
        if terminal && self.terminal.fetch_add(1, Ordering::Relaxed) != 0 {
            return;
        }
        if !terminal && self.attempted.fetch_add(1, Ordering::Relaxed) >= MAX_RECORDS {
            self.lost.fetch_add(1, Ordering::Relaxed);
            return;
        }
        let line = format!(
            "{{\"v\":1,\"source\":\"app\",\"clock\":\"monotonic\",\"monoNs\":{now},\"stage\":\"{stage}\",\"a\":{a},\"b\":{b},\"lost\":{}}}",
            self.lost.load(Ordering::Relaxed)
        );
        if self.socket.send(line.as_bytes()).is_err() {
            self.lost.fetch_add(1, Ordering::Relaxed);
        }
    }
}
#[cfg(target_os = "linux")]
static TRACE: LazyLock<Option<Trace>> = LazyLock::new(|| {
    let path = std::env::var_os("AIRDROP_S24_LAB_TRACE_SOCKET")?;
    let socket = UnixDatagram::unbound().ok()?;
    socket.set_nonblocking(true).ok()?;
    socket.connect(path).ok()?;
    let trace = Trace::new(socket).ok()?;
    trace.emit("trace-start", 0, 0);
    Some(trace)
});
#[cfg(not(target_os = "linux"))]
static TRACE: LazyLock<Option<()>> = LazyLock::new(|| None);
pub fn enabled() -> bool {
    TRACE.is_some()
}
pub fn event(stage: &str, a: u64, b: i64) {
    #[cfg(target_os = "linux")]
    if let Some(t) = TRACE.as_ref() {
        t.emit(stage, a, b);
    }
    #[cfg(not(target_os = "linux"))]
    let _ = (stage, a, b);
}

/// Observes actual transport poll boundaries, not the intermediate crypto duplex.
/// No extra reads, writes, flushes, shutdowns, retries or sleeps are introduced.
pub struct Observed<S> {
    inner: S,
    read: Option<u64>,
    write: Option<u64>,
}
impl<S> Observed<S> {
    pub fn new(inner: S) -> Self {
        Self {
            inner,
            read: None,
            write: None,
        }
    }
}
impl<S: AsyncRead + Unpin> AsyncRead for Observed<S> {
    fn poll_read(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let this = self.get_mut();
        let before = buf.filled().len();
        if enabled() && this.read.is_none() {
            this.read = Some(monotonic_ns());
            event("read-enter", buf.remaining() as u64, 0);
        }
        let result = Pin::new(&mut this.inner).poll_read(cx, buf);
        if let Poll::Ready(ref value) = result {
            if let Some(start) = this.read.take() {
                event(
                    "read-return",
                    monotonic_ns().saturating_sub(start),
                    match value {
                        Ok(()) => (buf.filled().len() - before) as i64,
                        Err(e) => -(e.raw_os_error().unwrap_or(1).unsigned_abs() as i64),
                    },
                );
            }
        }
        result
    }
}
impl<S: AsyncWrite + Unpin> AsyncWrite for Observed<S> {
    fn poll_write(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let this = self.get_mut();
        if enabled() && this.write.is_none() {
            this.write = Some(monotonic_ns());
            event("write-enter", buf.len() as u64, 0);
        }
        let result = Pin::new(&mut this.inner).poll_write(cx, buf);
        if let Poll::Ready(ref value) = result {
            if let Some(start) = this.write.take() {
                event(
                    "write-return",
                    monotonic_ns().saturating_sub(start),
                    match value {
                        Ok(n) => *n as i64,
                        Err(e) => -(e.raw_os_error().unwrap_or(1).unsigned_abs() as i64),
                    },
                );
            }
        }
        result
    }
    fn poll_flush(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        let r = Pin::new(&mut self.get_mut().inner).poll_flush(cx);
        if let Poll::Ready(ref v) = r {
            event("flush-return", 0, if v.is_ok() { 0 } else { -1 });
        }
        r
    }
    fn poll_shutdown(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        event("shutdown-enter", 0, 0);
        let r = Pin::new(&mut self.get_mut().inner).poll_shutdown(cx);
        if let Poll::Ready(ref v) = r {
            event("shutdown-return", 0, if v.is_ok() { 0 } else { -1 });
        }
        r
    }
}
impl<S> Drop for Observed<S> {
    fn drop(&mut self) {
        event(
            "transport-drop",
            self.read
                .map(|s| monotonic_ns().saturating_sub(s))
                .unwrap_or(0),
            self.write
                .map(|s| monotonic_ns().saturating_sub(s).min(i64::MAX as u64) as i64)
                .unwrap_or(0),
        );
    }
}
#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    #[test]
    fn fixed_schema_nonblocking_loss_and_monotonic_clock() {
        let (a, b) = UnixDatagram::pair().unwrap();
        b.set_nonblocking(true).unwrap();
        let t = Trace::new(a).unwrap();
        let before = monotonic_ns();
        t.emit("consent-received", 1, 0);
        let mut bytes = [0; 512];
        let n = b.recv(&mut bytes).unwrap();
        let s = std::str::from_utf8(&bytes[..n]).unwrap();
        assert!(s.contains("\"clock\":\"monotonic\""));
        assert!(!s.contains("code"));
        assert!(monotonic_ns() >= before);
        for stage in ["gatt-read", "gatt-write", "gatt-notify"] {
            t.emit(stage, 1, -1);
            let n = b.recv(&mut bytes).unwrap();
            let record = std::str::from_utf8(&bytes[..n]).unwrap();
            assert!(record.contains(&format!("\"stage\":\"{stage}\"")));
            assert!(record.contains("\"a\":1,"));
            assert!(record.contains("\"b\":-1,"));
            assert_eq!(record.matches(':').count(), 8);
        }
        t.emit("PRIVATE address filename token", 0, 0);
        assert!(b.recv(&mut bytes).is_err());
        for _ in 0..MAX_RECORDS + 1 {
            t.emit("write-return", 100, 49);
        }
        assert!(t.lost.load(Ordering::Relaxed) > 0); // Full socket never blocks sender.
        while b.recv(&mut bytes).is_ok() {}
        t.emit("owner-stop", 1, 0); // One terminal report survives the record cap.
        let n = b.recv(&mut bytes).unwrap();
        let end = std::str::from_utf8(&bytes[..n]).unwrap();
        assert!(end.contains("owner-stop"));
        assert!(!end.contains("\"lost\":0"));
    }
    #[tokio::test]
    async fn observed_transport_preserves_backpressure_bytes_eof_and_shutdown() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let (a, mut b) = tokio::io::duplex(3);
        let mut a = Observed::new(a);
        let send = tokio::spawn(async move {
            a.write_all(b"fixture").await.unwrap();
            a.shutdown().await.unwrap();
        });
        let mut out = vec![];
        b.read_to_end(&mut out).await.unwrap();
        send.await.unwrap();
        assert_eq!(out, b"fixture");
    }
}
