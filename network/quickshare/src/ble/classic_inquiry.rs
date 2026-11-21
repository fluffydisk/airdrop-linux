// GPL-3.0-only. Default-off laboratory Classic inquiry lease. A separately
// supervised, bounded rollback watcher must acknowledge the private plan before
// ANY global property is changed. Not a controller capability override.
use anyhow::{Context, Result, ensure};
use dbus::nonblock::stdintf::org_freedesktop_dbus::Properties;
use dbus::{arg::Variant, nonblock::Proxy};
use serde::Serialize;
use std::{
    fs,
    io::Write,
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::time::{Instant, timeout};

const IFACE: &str = "org.bluez.Adapter1";
#[derive(Serialize)]
struct Values {
    alias: String,
    connectable: bool,
    discoverable: bool,
    timeout: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Plan {
    schema: u8,
    adapter: String,
    owner_pid: u32,
    owner_start_tick: String,
    original: Values,
    expected: Values,
}

pub struct Lease {
    stop: PathBuf,
    result: PathBuf,
    began: Instant,
    io: tokio::task::JoinHandle<dbus_tokio::connection::IOResourceError>,
}
impl Drop for Lease {
    fn drop(&mut self) {
        // Marker only; never overwrite/follow an existing file. The independent
        // watcher, not this dying runtime, owns asynchronous restoration.
        let _ = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&self.stop);
        self.io.abort();
    }
}
impl Lease {
    pub fn active(&self) -> bool {
        self.began.elapsed() < Duration::from_secs(90)
            && !self.result.exists()
            && !self.io.is_finished()
    }
    pub async fn start(adapter: &str, full: &[u8]) -> Result<Self> {
        ensure!(
            std::env::var("AIRDROP_S24_LAB_CLASSIC").as_deref() == Ok("1"),
            "Classic inquiry needs owned RFCOMM"
        );
        let path = PathBuf::from(
            std::env::var_os("AIRDROP_S24_LAB_CLASSIC_LEASE")
                .context("Classic rollback watcher unavailable")?,
        );
        private_parent(&path)?;
        ensure!(
            path.file_name().and_then(|x| x.to_str()) == Some("classic-lease.json"),
            "invalid Classic lease path"
        );
        ensure!(
            adapter.starts_with("hci")
                && adapter[3..].bytes().all(|x| x.is_ascii_digit())
                && !adapter[3..].is_empty(),
            "invalid adapter"
        );
        let (resource, connection) =
            tokio::task::spawn_blocking(dbus_tokio::connection::new_system_sync).await??;
        let io = tokio::spawn(resource);
        // Construct the drop guard immediately so failed reads/writes cannot
        // orphan the D-Bus I/O task. No property has changed at this point.
        let lease = Self {
            stop: path.with_extension("stop"),
            result: path.with_extension("result"),
            began: Instant::now(),
            io,
        };
        let proxy = Proxy::new(
            "org.bluez",
            format!("/org/bluez/{adapter}"),
            Duration::from_secs(1),
            connection,
        );
        let original = Values {
            alias: proxy
                .get(IFACE, "Alias")
                .await
                .context("Classic alias unavailable")?,
            connectable: proxy
                .get(IFACE, "Connectable")
                .await
                .context("Classic connectability unavailable")?,
            discoverable: proxy
                .get(IFACE, "Discoverable")
                .await
                .context("Classic visibility unavailable")?,
            timeout: proxy
                .get(IFACE, "DiscoverableTimeout")
                .await
                .context("Classic timeout unavailable")?,
        };
        ensure!(
            !original.discoverable,
            "Existing discoverability belongs to another caller"
        );
        let stat = fs::read_to_string("/proc/self/stat")?;
        let start = stat
            .rsplit_once(')')
            .context("process identity unavailable")?
            .1
            .split_whitespace()
            .nth(19)
            .context("process start unavailable")?
            .to_owned();
        let plan = Plan {
            schema: 1,
            adapter: adapter.to_owned(),
            owner_pid: std::process::id(),
            owner_start_tick: start,
            original,
            expected: Values {
                alias: super::protocol::classic_discovery_name(full)?,
                connectable: true,
                discoverable: true,
                timeout: 90,
            },
        };
        let bytes = serde_json::to_vec(&plan)?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&path)?;
        file.write_all(&bytes)?;
        file.sync_data()?;
        drop(file);
        let ready = path.with_extension("ready");
        timeout(Duration::from_secs(2), async {
            loop {
                if private_file(&ready) && fs::read(&ready).ok().as_deref() == Some(b"ready\n") {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .context("Classic rollback watcher did not acknowledge")?;
        // Alias first is the watcher's unique ownership marker. Original values
        // and expected values stay in a private functional checkpoint, not logs.
        macro_rules! set {
            ($key:expr,$value:expr) => {
                proxy
                    .method_call::<(), _, _, _>(
                        "org.freedesktop.DBus.Properties",
                        "Set",
                        (IFACE, $key, Variant($value)),
                    )
                    .await
                    .map_err(|_| anyhow::anyhow!("Classic inquiry property update failed"))?
            };
        }
        set!("Alias", plan.expected.alias.clone());
        set!("Connectable", true);
        set!("DiscoverableTimeout", 90u32);
        set!("Discoverable", true);
        ensure!(
            proxy.get::<String>(IFACE, "Alias").await? == plan.expected.alias
                && proxy.get::<bool>(IFACE, "Connectable").await?
                && proxy.get::<bool>(IFACE, "Discoverable").await?
                && proxy.get::<u32>(IFACE, "DiscoverableTimeout").await? == 90,
            "Classic inquiry readback failed"
        );
        Ok(lease)
    }
}
fn private_parent(path: &Path) -> Result<()> {
    let parent = path.parent().context("lease parent unavailable")?;
    let m = fs::symlink_metadata(parent)?;
    ensure!(
        path.is_absolute()
            && m.is_dir()
            && !m.file_type().is_symlink()
            && m.uid() == unsafe { libc::geteuid() }
            && m.permissions().mode() & 0o077 == 0
            && fs::canonicalize(parent)? == parent,
        "private owned lease directory required"
    );
    Ok(())
}
fn private_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| {
        m.is_file()
            && !m.file_type().is_symlink()
            && m.uid() == unsafe { libc::geteuid() }
            && m.permissions().mode() & 0o077 == 0
    })
}

#[cfg(test)]
#[path = "classic_inquiry_test.rs"]
mod tests;
