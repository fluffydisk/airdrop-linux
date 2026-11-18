// GPL-3.0-only. Lab-only feedback experiment. At most one user SDU waits for
// Linux's real HCI TX_COMPLETION report. This is NOT a peer file acknowledgement.
// No HCI commands, global credit overrides, sleeps between writes or resets.
use std::{
    future::Future,
    io, mem,
    os::fd::{AsRawFd, FromRawFd, OwnedFd},
    pin::Pin,
    sync::Arc,
    task::{Context, Poll, ready},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, Interest, ReadBuf, unix::AsyncFd},
    time::{Sleep, sleep},
};

const TX_COMPLETION: i32 = 1 << 18;
const SOFTWARE: i32 = 1 << 4;
const OPT_ID: i32 = 1 << 7;
const TSONLY: i32 = 1 << 11;
const SOL_BLUETOOTH: i32 = 274;
const BT_SCM_ERROR: i32 = 4;

#[repr(C)]
#[derive(Clone, Copy)]
struct ExtendedError {
    errno: u32,
    origin: u8,
    kind: u8,
    code: u8,
    pad: u8,
    info: u32,
    id: u32,
}
fn completion(e: ExtendedError) -> io::Result<Option<u32>> {
    if e.origin == 4 && e.errno == libc::ENOMSG as u32 {
        return Ok((e.info == 3).then_some(e.id));
    }
    if e.errno != 0 {
        return Err(io::Error::from_raw_os_error(e.errno as i32));
    }
    Ok(None)
}
fn receive(fd: i32, level: i32, kind: i32) -> io::Result<Option<ExtendedError>> {
    // usize guarantees cmsghdr alignment. TSONLY means there is no packet body.
    let mut control = [0usize; 64];
    let mut msg: libc::msghdr = unsafe { mem::zeroed() };
    msg.msg_control = control.as_mut_ptr().cast();
    msg.msg_controllen = mem::size_of_val(&control);
    let n = unsafe { libc::recvmsg(fd, &mut msg, libc::MSG_ERRQUEUE | libc::MSG_DONTWAIT) };
    if n < 0 {
        return Err(io::Error::last_os_error());
    }
    if msg.msg_flags & libc::MSG_CTRUNC != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "truncated completion metadata",
        ));
    }
    unsafe {
        let mut c = libc::CMSG_FIRSTHDR(&msg);
        while !c.is_null() {
            if (*c).cmsg_level == level && (*c).cmsg_type == kind {
                if (*c).cmsg_len < libc::CMSG_LEN(mem::size_of::<ExtendedError>() as u32) as usize {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "short completion metadata",
                    ));
                }
                return Ok(Some(std::ptr::read_unaligned(libc::CMSG_DATA(c).cast())));
            }
            c = libc::CMSG_NXTHDR(&msg, c);
        }
    }
    Ok(None)
}
// Error-queue readiness is EPOLLERR, a separate interest in current Tokio.
// poll_read_ready() does not wait for this event and can miss every report.
async fn next_report(fd: &AsyncFd<OwnedFd>, level: i32, kind: i32) -> io::Result<ExtendedError> {
    loop {
        let mut ready = fd.ready(Interest::ERROR).await?;
        match ready.try_io(|fd| receive(fd.get_ref().as_raw_fd(), level, kind)) {
            Ok(Ok(Some(report))) => return Ok(report),
            Ok(Ok(None)) => {}
            Ok(Err(error)) => return Err(error),
            Err(_) => {}
        }
    }
}
type ReportWait = Pin<Box<dyn Future<Output = io::Result<()>> + Send>>;
pub(super) struct Completion<S> {
    inner: S,
    reports: Arc<AsyncFd<OwnedFd>>,
    wait: Option<ReportWait>,
    sent: u32,
    pending: Option<u32>,
    deadline: Option<Pin<Box<Sleep>>>,
}
impl<S: AsRawFd> Completion<S> {
    pub fn new(inner: S) -> io::Result<Self> {
        let flags = TX_COMPLETION | SOFTWARE | OPT_ID | TSONLY;
        if unsafe {
            libc::setsockopt(
                inner.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_TIMESTAMPING,
                (&flags as *const i32).cast(),
                mem::size_of_val(&flags) as _,
            )
        } < 0
        {
            return Err(io::Error::last_os_error());
        }
        let fd = unsafe { libc::fcntl(inner.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        // The owned duplicate stays open for this AsyncFd's lifetime; no code
        // exposes or replaces it. Registration owns the descriptor on success.
        let reports =
            unsafe { AsyncFd::register_with_interest(OwnedFd::from_raw_fd(fd), Interest::ERROR) }
                .map_err(|e| e.into_parts().1)?;
        super::diagnostics::inc("l2cap_lab_completion_enabled");
        Ok(Self {
            inner,
            reports: Arc::new(reports),
            wait: None,
            sent: 0,
            pending: None,
            deadline: None,
        })
    }
}
impl<S> Completion<S> {
    fn poll_completion(&mut self, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let Some(expected) = self.pending else {
            return Poll::Ready(Ok(()));
        };
        if self
            .deadline
            .as_mut()
            .is_some_and(|d| d.as_mut().poll(cx).is_ready())
        {
            super::diagnostics::inc("l2cap_lab_completion_timeout");
            return Poll::Ready(Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "controller completion deadline",
            )));
        }
        if self.wait.is_none() {
            let reports = Arc::clone(&self.reports);
            self.wait = Some(Box::pin(async move {
                loop {
                    let report = next_report(&reports, SOL_BLUETOOTH, BT_SCM_ERROR).await?;
                    if completion(report)? == Some(expected) {
                        return Ok(());
                    }
                    super::diagnostics::inc("l2cap_lab_completion_unmatched");
                    tokio::task::yield_now().await;
                }
            }));
        }
        ready!(self.wait.as_mut().unwrap().as_mut().poll(cx))?;
        self.pending = None;
        self.deadline = None;
        self.wait = None;
        super::diagnostics::inc("l2cap_lab_completion_received");
        Poll::Ready(Ok(()))
    }
}
impl<S: AsyncRead + Unpin> AsyncRead for Completion<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        b: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_read(cx, b)
    }
}
impl<S: AsyncWrite + Unpin> AsyncWrite for Completion<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        b: &[u8],
    ) -> Poll<io::Result<usize>> {
        if b.is_empty() {
            return Poll::Ready(Ok(0));
        }
        ready!(self.poll_completion(cx))?;
        let n = ready!(
            Pin::new(&mut self.inner).poll_write(cx, &b[..b.len().min(super::l2cap_sdu::LIMIT)])
        )?;
        if n > 0 {
            self.sent = self.sent.wrapping_add(n as u32);
            self.pending = Some(self.sent.wrapping_sub(1));
            self.deadline = Some(Box::pin(sleep(Duration::from_secs(5))));
        }
        Poll::Ready(Ok(n))
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        ready!(self.poll_completion(cx))?;
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        ready!(self.poll_completion(cx))?;
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    #[test]
    fn only_real_completion_reports_release_a_write() {
        let e = ExtendedError {
            errno: libc::ENOMSG as u32,
            origin: 4,
            kind: 0,
            code: 0,
            pad: 0,
            info: 3,
            id: 20,
        };
        assert_eq!(completion(e).unwrap(), Some(20));
        assert_eq!(completion(ExtendedError { info: 0, ..e }).unwrap(), None);
        assert!(
            completion(ExtendedError {
                errno: libc::ETIMEDOUT as u32,
                origin: 2,
                ..e
            })
            .is_err()
        );
    }
    #[tokio::test(start_paused = true)]
    async fn missing_report_never_releases_another_send_and_reads_stay_live() {
        // A private Unix socket deliberately has no HCI completion source.
        // This verifies fail-closed flow control, not Bluetooth hardware support.
        let (inner, mut peer) = tokio::net::UnixStream::pair().unwrap();
        let fd = unsafe { libc::fcntl(inner.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
        assert!(fd >= 0);
        let reports =
            unsafe { AsyncFd::register_with_interest(OwnedFd::from_raw_fd(fd), Interest::ERROR) }
                .unwrap();
        let mut socket = Completion {
            inner,
            reports: Arc::new(reports),
            wait: None,
            sent: 0,
            pending: None,
            deadline: None,
        };
        assert_eq!(socket.write(&[7; 100]).await.unwrap(), 21);
        peer.write_all(&[4, 5]).await.unwrap();
        let mut received = [0; 2];
        socket.read_exact(&mut received).await.unwrap();
        assert_eq!(received, [4, 5]);
        assert_eq!(
            socket.write(&[8]).await.unwrap_err().kind(),
            io::ErrorKind::TimedOut
        );
        let mut data = [0; 21];
        peer.read_exact(&mut data).await.unwrap();
        assert_eq!(data, [7; 21]);
        assert!(
            matches!(peer.try_read(&mut [0; 1]), Err(e) if e.kind()==io::ErrorKind::WouldBlock)
        );
    }
    #[tokio::test]
    async fn kernel_timestamp_on_error_queue_wakes_without_readable_data() {
        // A real private loopback TX timestamp exercises EPOLLERR, recvmsg and
        // ancillary parsing, without Bluetooth or an external network.
        let receiver = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let sender = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        sender.set_nonblocking(true).unwrap();
        let flags: i32 = (1 << 1) | SOFTWARE | OPT_ID | TSONLY;
        assert_eq!(
            unsafe {
                libc::setsockopt(
                    sender.as_raw_fd(),
                    libc::SOL_SOCKET,
                    libc::SO_TIMESTAMPING,
                    (&flags as *const i32).cast(),
                    mem::size_of_val(&flags) as _,
                )
            },
            0
        );
        let fd = unsafe { libc::fcntl(sender.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
        assert!(fd >= 0);
        let reports =
            unsafe { AsyncFd::register_with_interest(OwnedFd::from_raw_fd(fd), Interest::ERROR) }
                .unwrap();
        sender
            .send_to(&[7], receiver.local_addr().unwrap())
            .unwrap();
        let e = tokio::time::timeout(
            Duration::from_secs(2),
            next_report(&reports, libc::SOL_IP, libc::IP_RECVERR),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(
            (e.origin, e.errno, e.info, e.id),
            (4, libc::ENOMSG as u32, 0, 0)
        );
        assert!(matches!(sender.recv(&mut [0;1]),Err(e) if e.kind()==io::ErrorKind::WouldBlock));
    }
}
