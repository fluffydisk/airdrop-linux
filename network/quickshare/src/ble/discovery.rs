// GPL-3.0-only. An independently owned BlueZ discovery lease. StopDiscovery
// replies are observed; neither the reply nor closing this bus proves RF idle.
use super::diagnostics::{self as diag, inc};
use anyhow::{Result, ensure};
use dbus::{
    arg::{PropMap, Variant},
    nonblock::{Proxy, SyncConnection},
};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::{
    sync::Mutex,
    task::JoinHandle,
    time::{Instant, timeout},
};

const LIMIT: Duration = Duration::from_secs(5);
const IFACE: &str = "org.bluez.Adapter1";

struct Owner {
    connection: Arc<SyncConnection>,
    io: JoinHandle<dbus_tokio::connection::IOResourceError>,
}
impl Drop for Owner {
    fn drop(&mut self) {
        self.io.abort();
    }
}
struct Lease {
    owner: Option<Owner>,
    path: String,
    started: Instant,
}
impl Lease {
    async fn start(adapter: &str) -> Result<Self> {
        ensure!(
            adapter.starts_with("hci")
                && adapter
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_'),
            "adapter path"
        );
        let (resource, connection) =
            tokio::task::spawn_blocking(dbus_tokio::connection::new_system_sync).await??;
        let owner = Owner {
            connection: connection.clone(),
            io: tokio::spawn(resource),
        };
        let path = format!("/org/bluez/{adapter}");
        let proxy = Proxy::new("org.bluez", path.clone(), LIMIT, connection);
        let mut filter = PropMap::new();
        filter.insert("Transport".into(), Variant(Box::new("le".to_string())));
        filter.insert("DuplicateData".into(), Variant(Box::new(true)));
        filter.insert("Discoverable".into(), Variant(Box::new(false)));
        timeout(
            LIMIT,
            proxy.method_call::<(), _, _, _>(IFACE, "SetDiscoveryFilter", (filter,)),
        )
        .await??;
        timeout(
            LIMIT,
            proxy.method_call::<(), _, _, _>(IFACE, "StartDiscovery", ()),
        )
        .await??;
        Ok(Self {
            owner: Some(owner),
            path,
            started: Instant::now(),
        })
    }
    async fn stop(mut self) -> Result<()> {
        inc("scan_stop_requested");
        let owner = self.owner.as_ref().expect("owned scan");
        let proxy = Proxy::new(
            "org.bluez",
            self.path.clone(),
            LIMIT,
            owner.connection.clone(),
        );
        let result = timeout(
            LIMIT,
            proxy.method_call::<(), _, _, _>(IFACE, "StopDiscovery", ()),
        )
        .await;
        let result = match result {
            Ok(Ok(())) => {
                inc("scan_stop_acknowledged");
                Ok(())
            }
            Ok(Err(e)) => {
                let timed_out = matches!(
                    e.name(),
                    Some(
                        "org.freedesktop.DBus.Error.NoReply" | "org.freedesktop.DBus.Error.Timeout"
                    )
                );
                let e = bluer::Error::from(e);
                diag::dbus_error(&e.kind);
                inc(if timed_out {
                    "scan_stop_timeout"
                } else {
                    "scan_stop_failed"
                });
                Err(anyhow::anyhow!("owned discovery stop failed"))
            }
            Err(_) => {
                inc("scan_stop_timeout");
                Err(anyhow::anyhow!("owned discovery stop timeout"))
            }
        };
        drop(proxy);
        // The discovery bus has no GATT or device connection ownership. Closing
        // it can only release this client's discovery/filter state.
        let mut owner = self.owner.take().expect("owned scan");
        owner.io.abort();
        let joined = timeout(Duration::from_millis(500), &mut owner.io)
            .await
            .is_ok();
        drop(owner);
        diag::current().scan_close(self.started);
        inc(if joined {
            "scan_owner_closed"
        } else {
            "scan_owner_close_timeout"
        });
        ensure!(joined, "discovery owner I/O did not stop");
        result
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if self.owner.is_some() {
            inc("scan_stop_unobserved");
            diag::current().scan_close(self.started);
        }
    }
}

#[derive(Default)]
struct State {
    lease: Option<Lease>,
    stopping: Option<JoinHandle<Result<()>>>,
}
#[derive(Default)]
struct Health {
    active: AtomicBool,
    failed: AtomicBool,
}
/// One generation's discovery state, shared with inbound GATT workers. A
/// cancelled caller does not cancel a pending stop: the bounded task remains
/// owned here and is joined before any subsequent start or generation teardown.
#[derive(Default)]
pub(super) struct Discovery {
    state: Mutex<State>,
    health: Arc<Health>,
}
impl Discovery {
    pub fn active(&self) -> bool {
        self.health.active.load(Ordering::Relaxed)
    }
    pub fn healthy(&self) -> bool {
        !self.health.failed.load(Ordering::Relaxed)
    }
    async fn finish_stop(&self, state: &mut State) -> Result<()> {
        if let Some(task) = state.stopping.as_mut() {
            let result = task
                .await
                .unwrap_or_else(|_| Err(anyhow::anyhow!("scan stop task failed")));
            state.stopping = None;
            if result.is_err() {
                self.health.active.store(false, Ordering::Relaxed);
                self.health.failed.store(true, Ordering::Relaxed);
            }
            result?;
        }
        Ok(())
    }
    pub async fn start(&self, adapter: &str) -> Result<()> {
        let mut state = self.state.lock().await;
        self.finish_stop(&mut state).await?;
        ensure!(
            self.healthy() && state.lease.is_none(),
            "discovery unhealthy or active"
        );
        inc("scan_start_requested");
        let start = timeout(LIMIT, Lease::start(adapter))
            .await
            .unwrap_or_else(|_| {
                inc("scan_start_timeout");
                Err(anyhow::anyhow!("owned discovery start timeout"))
            });
        match start {
            Ok(lease) => {
                state.lease = Some(lease);
                self.health.active.store(true, Ordering::Relaxed);
                inc("scan_start_success");
                diag::current().scan_open();
                Ok(())
            }
            Err(e) => {
                self.health.failed.store(true, Ordering::Relaxed);
                inc("scan_start_failure");
                Err(e)
            }
        }
    }
    pub async fn stop(&self) -> Result<()> {
        let mut state = self.state.lock().await;
        if let Some(lease) = state.lease.take() {
            let health = self.health.clone();
            state.stopping = Some(tokio::spawn(async move {
                let result = lease.stop().await;
                health.active.store(false, Ordering::Relaxed);
                if result.is_err() {
                    health.failed.store(true, Ordering::Relaxed);
                }
                result
            }));
        }
        self.finish_stop(&mut state).await?;
        ensure!(self.healthy(), "discovery generation failed");
        Ok(())
    }
}

#[cfg(test)]
#[path = "discovery_test.rs"]
mod tests;
