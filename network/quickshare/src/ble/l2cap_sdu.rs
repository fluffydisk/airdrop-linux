// GPL-3.0-only. Laboratory comparison, disabled by default. Limit each LE CoC
// send to 21 bytes: 27-byte HCI ACL capacity minus L2CAP header (4) and SDU
// length (2). This changes SDU boundaries, not the application byte stream.
// No sleeps, controller credit emulation, or adapter configuration changes.
use std::{
    pin::Pin,
    task::{Context, Poll},
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};

pub(super) const LIMIT: usize = 21;
pub(super) struct SduWrites<S> {
    inner: S,
    limited: bool,
}
impl<S> SduWrites<S> {
    pub fn new(inner: S, limited: bool) -> Self {
        Self { inner, limited }
    }
}
impl<S: AsyncRead + Unpin> AsyncRead for SduWrites<S> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        b: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_read(cx, b)
    }
}
impl<S: AsyncWrite + Unpin> AsyncWrite for SduWrites<S> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        b: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        let n = if self.limited {
            b.len().min(LIMIT)
        } else {
            b.len()
        };
        match Pin::new(&mut self.inner).poll_write(cx, &b[..n]) {
            Poll::Ready(Ok(written)) => {
                if self.limited && written > 0 {
                    super::diagnostics::inc("l2cap_lab_small_sdu_writes");
                }
                Poll::Ready(Ok(written))
            }
            other => other,
        }
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    #[derive(Default)]
    struct Recorder {
        bytes: Vec<u8>,
        lengths: Vec<usize>,
        flushed: bool,
        closed: bool,
    }
    impl AsyncWrite for Recorder {
        fn poll_write(
            mut self: Pin<&mut Self>,
            _: &mut Context<'_>,
            b: &[u8],
        ) -> Poll<std::io::Result<usize>> {
            self.lengths.push(b.len());
            self.bytes.extend_from_slice(b);
            Poll::Ready(Ok(b.len()))
        }
        fn poll_flush(mut self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<std::io::Result<()>> {
            self.flushed = true;
            Poll::Ready(Ok(()))
        }
        fn poll_shutdown(
            mut self: Pin<&mut Self>,
            _: &mut Context<'_>,
        ) -> Poll<std::io::Result<()>> {
            self.closed = true;
            Poll::Ready(Ok(()))
        }
    }
    #[tokio::test]
    async fn byte_stream_preserved_with_no_hci_continuation_sized_writes() {
        let bytes: Vec<u8> = (0..8192).map(|n| (n % 251) as u8).collect();
        for limited in [false, true] {
            let mut writer = SduWrites::new(Recorder::default(), limited);
            writer.write_all(&bytes).await.unwrap();
            writer.flush().await.unwrap();
            writer.shutdown().await.unwrap();
            assert_eq!(writer.inner.bytes, bytes);
            assert!(writer.inner.flushed && writer.inner.closed);
            if limited {
                assert!(writer.inner.lengths.iter().all(|n| *n + 4 + 2 <= 27));
            } else {
                assert_eq!(writer.inner.lengths, vec![bytes.len()]);
            }
        }
    }
    #[tokio::test]
    async fn backpressure_does_not_block_read_and_half_close_is_forwarded() {
        let (socket, mut peer) = tokio::io::duplex(2);
        let (mut read, mut write) = tokio::io::split(SduWrites::new(socket, true));
        let writer = tokio::spawn(async move {
            write.write_all(&[7; 100]).await.unwrap();
            write.shutdown().await.unwrap();
        });
        peer.write_all(&[4, 5]).await.unwrap();
        let mut b = [0; 2];
        read.read_exact(&mut b).await.unwrap();
        assert_eq!(b, [4, 5]);
        let mut received = Vec::new();
        peer.read_to_end(&mut received).await.unwrap();
        writer.await.unwrap();
        assert_eq!(received, vec![7; 100]);
    }
}
