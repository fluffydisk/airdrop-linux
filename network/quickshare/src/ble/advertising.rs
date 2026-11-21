// GPL-3.0-only. Local advertising parameters/lifecycle diagnostics. No peer data.
use super::diagnostics::{self as diag, inc};
use anyhow::{Result, ensure};
use bluer::adv::{Advertisement, SecondaryChannel, Type};
use serde::Serialize;
use std::time::Duration;
use tokio::time::{Instant, timeout};

// A receiver remains available until visibility changes or its dedicated D-Bus
// owner closes. BlueZ removes an owner's advertisements on disconnect. A timed
// lease required destructive re-registration during LE connections on Realtek.
pub const RECEIVER_TIMEOUT: Duration = Duration::ZERO;
const CALL_LIMIT: Duration = Duration::from_secs(5);

pub const SETTLE: Duration = Duration::from_millis(250);
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupStatus {
    pub reason: &'static str,
    pub result: &'static str,
    pub unregister_result: &'static str,
    pub error_name: &'static str,
    pub category: &'static str,
    pub age_ms: u64,
    pub lease_ms: u64,
    pub daemon_release_before_cleanup: bool,
    pub daemon_release_during_cleanup: bool,
    pub io_stopped: bool,
    pub owner_scope_closed: bool,
    pub settle_ms: u64,
    pub duration_ms: u64,
}
/// Normal lifecycle paths await this barrier. Drop remains a bounded fallback
/// for cancellation/unwinding; its completion is never assumed by replacement.
pub async fn release_all(handles: &mut Vec<Handle>, reason: &'static str) -> Result<()> {
    let old = std::mem::take(handles);
    diag::current().count("advertisement_released", old.len() as u64);
    let results = futures::future::join_all(old.into_iter().map(|h| h.release(reason))).await;
    ensure!(
        results.iter().all(Result::is_ok),
        "advertisement cleanup incomplete"
    );
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub retry_seconds: u64,
    pub trigger: &'static str,
    pub phase: &'static str,
    pub result: &'static str,
    pub mode: &'static str,
    pub error_name: &'static str,
    pub failure_detail: &'static str,
    pub category: &'static str,
    pub service_data_bytes: usize,
    pub estimated_legacy_bytes: usize,
    pub advertisement_type: &'static str,
    pub secondary_channel: &'static str,
    pub discoverable: &'static str,
    pub timeout_seconds: u64,
    pub own_scan_paused: bool,
    pub discovery: &'static str,
    pub available_instances: Option<u8>,
    pub active_instances: Option<u8>,
}
impl Status {
    pub fn new(a: &Advertisement, mode: &'static str, context: Context) -> Self {
        let service_data_bytes = a.service_data.values().map(Vec::len).sum();
        Self {
            retry_seconds: 0,
            trigger: context.trigger,
            phase: "local-validation",
            result: "pending",
            mode,
            error_name: "none",
            failure_detail: "none",
            category: "none",
            service_data_bytes,
            estimated_legacy_bytes: service_data_bytes + 4 + 3,
            advertisement_type: if a.advertisement_type == Type::Peripheral {
                "peripheral"
            } else {
                "broadcast"
            },
            secondary_channel: if a.secondary_channel == Some(SecondaryChannel::OneM) {
                "1M"
            } else if a.secondary_channel.is_none() {
                "none"
            } else {
                "other"
            },
            discoverable: match a.discoverable {
                Some(true) => "true",
                Some(false) => "false",
                None => "adapter-default",
            },
            timeout_seconds: a.timeout.map(|v| v.as_secs()).unwrap_or(0),
            own_scan_paused: context.own_scan_paused,
            discovery: context.discovery,
            available_instances: context.available_instances,
            active_instances: context.active_instances,
        }
    }
}
#[derive(Clone, Copy)]
pub struct Context {
    pub trigger: &'static str,
    pub own_scan_paused: bool,
    pub discovery: &'static str,
    pub available_instances: Option<u8>,
    pub active_instances: Option<u8>,
}
impl Default for Context {
    fn default() -> Self {
        Self {
            trigger: "initial",
            own_scan_paused: false,
            discovery: "unknown",
            available_instances: None,
            active_instances: None,
        }
    }
}

// Validate only the advertisement profile constructed by this helper. Reserve
// three bytes for BlueZ/kernel-managed flags, even when currently not included.
// FEF3 is a Bluetooth-base UUID: its on-air encoding occupies two bytes.
pub fn validate(a: &Advertisement) -> Result<()> {
    ensure!(
        a.advertisement_type == Type::Peripheral,
        "advertisement profile"
    );
    ensure!(
        a.service_data.len() == 1 && a.service_data.contains_key(&super::radio::SERVICE),
        "service data profile"
    );
    ensure!(
        a.service_uuids.is_empty()
            && a.manufacturer_data.is_empty()
            && a.solicit_uuids.is_empty()
            && a.advertising_data.is_empty()
            && a.system_includes.is_empty()
            && a.local_name.is_none()
            && a.appearance.is_none(),
        "unexpected advertising fields"
    );
    ensure!(
        a.discoverable.is_none()
            && a.discoverable_timeout.is_none()
            && a.duration.is_none()
            && a.min_interval.is_none()
            && a.max_interval.is_none()
            && a.tx_power.is_none(),
        "unexpected advertising parameters"
    );
    ensure!(
        a.timeout == Some(RECEIVER_TIMEOUT),
        "advertisement lifetime"
    );
    let data = &a.service_data[&super::radio::SERVICE];
    if a.secondary_channel.is_none() {
        ensure!(
            matches!(data.len(), 15 | 17) && data.len() + 7 <= 31,
            "legacy advertisement budget"
        );
        super::protocol::Header::decode(data)
            .map_err(|_| anyhow::anyhow!("legacy header validation"))?;
    } else {
        ensure!(
            a.secondary_channel == Some(SecondaryChannel::OneM) && data.len() <= 248,
            "extended advertisement budget"
        );
        super::protocol::Advert::decode(data)
            .map_err(|_| anyhow::anyhow!("full advertisement validation"))?;
    }
    Ok(())
}

// Return only literals from a closed set. Never serialize Error::message,
// Display/Debug output, an arbitrary D-Bus name, an adapter name or object path.
pub fn failure(error: &anyhow::Error) -> (&'static str, &'static str) {
    use bluer::{ErrorKind as E, InternalErrorKind as I};
    if error
        .downcast_ref::<tokio::time::error::Elapsed>()
        .is_some()
    {
        return ("timeout", "timeout");
    }
    let Some(e) = error.downcast_ref::<bluer::Error>() else {
        return ("unknown", "other");
    };
    match &e.kind {
        E::InvalidArguments => ("org.bluez.Error.InvalidArguments", "invalid-arguments"),
        E::InvalidLength => ("org.bluez.Error.InvalidLength", "invalid-length"),
        E::NotSupported => ("org.bluez.Error.NotSupported", "not-supported"),
        E::NotPermitted => ("org.bluez.Error.NotPermitted", "capacity-or-policy"),
        E::NotAuthorized => ("org.bluez.Error.NotAuthorized", "permission-denied"),
        E::InProgress => ("org.bluez.Error.InProgress", "busy"),
        E::AlreadyExists => ("org.bluez.Error.AlreadyExists", "already-exists"),
        E::NotReady => ("org.bluez.Error.NotReady", "not-ready"),
        E::DoesNotExist => ("org.bluez.Error.DoesNotExist", "missing-object"),
        E::NotAvailable => ("org.bluez.Error.NotAvailable", "not-available"),
        E::NotFound => ("org.freedesktop.DBus.Error.UnknownObject", "missing-object"),
        E::Failed => (
            "org.bluez.Error.Failed",
            if e.message == "Failed to parse advertisement." {
                "parse-failed"
            } else {
                "failed"
            },
        ),
        E::Internal(I::DBus(s)) => match s.as_str() {
            "org.freedesktop.DBus.Error.NoReply" => {
                ("org.freedesktop.DBus.Error.NoReply", "timeout")
            }
            "org.freedesktop.DBus.Error.Timeout" => {
                ("org.freedesktop.DBus.Error.Timeout", "timeout")
            }
            "org.freedesktop.DBus.Error.AccessDenied" => (
                "org.freedesktop.DBus.Error.AccessDenied",
                "permission-denied",
            ),
            "org.freedesktop.DBus.Error.LimitsExceeded" => {
                ("org.freedesktop.DBus.Error.LimitsExceeded", "resources")
            }
            "org.freedesktop.DBus.Error.UnknownMethod" => {
                ("org.freedesktop.DBus.Error.UnknownMethod", "not-supported")
            }
            "org.freedesktop.DBus.Error.ServiceUnknown" => (
                "org.freedesktop.DBus.Error.ServiceUnknown",
                "service-unavailable",
            ),
            "org.freedesktop.DBus.Error.Disconnected" => {
                ("org.freedesktop.DBus.Error.Disconnected", "disconnected")
            }
            _ => ("unknown", "other"),
        },
        E::Internal(I::DBusConnectionLost) => ("unknown", "disconnected"),
        _ => ("unknown", "other"),
    }
}
// Exact public BlueZ 5.87 literals only. Unknown/personalized bodies are never
// copied or partially matched. The daemon can still hide the MGMT status code.
pub fn failure_detail(error: &anyhow::Error) -> &'static str {
    match error.downcast_ref::<bluer::Error>() {
        Some(e) if e.kind == bluer::ErrorKind::Failed => match e.message.as_str() {
            "Failed to register advertisement" => "controller-registration",
            "Failed to complete registration" => "registration-incomplete",
            "Failed to parse advertisement." => "parameter-parsing",
            _ => "unknown",
        },
        _ => "none",
    }
}
fn failed(mut status: Status, error: &anyhow::Error) {
    (status.error_name, status.category) = failure(error);
    status.result = "failed";
    status.failure_detail = failure_detail(error);
    if status.failure_detail != "none" {
        inc(&format!(
            "advertisement_failure_detail_{}",
            status.failure_detail.replace('-', "_")
        ));
    }
    inc(&format!(
        "advertisement_error_{}",
        status.category.replace('-', "_")
    ));
    diag::current().advertising(status);
}

/// Each attempt has a dedicated, explicitly owned D-Bus connection. Failed or
/// cancelled publication closes it independently of the GATT/scanner owner.
/// Success retains a cancellable handle with bounded unregister/close cleanup.
pub async fn register(
    adapter_name: &str,
    a: Advertisement,
    mode: &'static str,
    context: Context,
) -> Result<Handle> {
    let mut status = Status::new(&a, mode, context);
    if validate(&a).is_err() {
        inc("advertisement_validation_failure");
        status.result = "failed";
        status.error_name = "local-validation";
        status.category = "invalid-parameters";
        diag::current().advertising(status);
        anyhow::bail!("local advertisement validation")
    }
    status.phase = "publisher";
    diag::current().advertising(status.clone());
    let result = timeout(CALL_LIMIT, publisher::publish(adapter_name, a, &mut status))
        .await
        .map_err(anyhow::Error::from)
        .and_then(|r| r);
    match result {
        Ok(handle) => {
            inc("advertisement_registration_success");
            status.result = "registered";
            diag::current().advertising(status);
            Ok(handle)
        }
        Err(e) => {
            inc(if status.phase == "bluez" {
                "advertisement_registration_failure"
            } else {
                "advertisement_publisher_failure"
            });
            failed(status, &e);
            Err(e)
        }
    }
}

#[derive(Default)]
pub struct Retry {
    failures: u8,
    settled: bool,
    next: Option<Instant>,
}
impl Retry {
    pub fn due(&self, now: Instant) -> bool {
        !self.settled && self.next.is_none_or(|at| now >= at)
    }
    pub fn reset(&mut self) {
        self.failures = 0;
        self.settled = false;
        self.next = None;
    }
    pub fn succeeded(&mut self, _now: Instant) {
        self.failures = 0;
        self.settled = true;
        self.next = None;
    }
    pub fn failed(&mut self, now: Instant) -> Duration {
        self.settled = false;
        let delay = Duration::from_secs((2u64 << self.failures.min(4)).min(30));
        self.failures = self.failures.saturating_add(1);
        self.next = Some(now + delay);
        delay
    }
    pub fn hidden(&mut self, _now: Instant) {
        self.settled = true;
        self.next = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn packet(psm: Option<u16>) -> Advertisement {
        let full = super::super::protocol::receiver(*b"AB12", "Linux", psm).unwrap();
        Advertisement {
            advertisement_type: Type::Peripheral,
            service_data: [(
                super::super::radio::SERVICE,
                super::super::protocol::header(&full, false, psm),
            )]
            .into(),
            timeout: Some(RECEIVER_TIMEOUT),
            ..Default::default()
        }
    }
    #[test]
    fn compact_parameters_fit_legacy_budget_with_and_without_bound_psm() {
        for psm in [None, Some(0x83)] {
            let a = packet(psm);
            validate(&a).unwrap();
            let s = Status::new(&a, "compact-gatt", Context::default());
            assert_eq!(
                s.estimated_legacy_bytes,
                if psm.is_some() { 24 } else { 22 }
            );
            assert!(
                a.service_uuids.is_empty()
                    && a.secondary_channel.is_none()
                    && a.discoverable.is_none()
            );
            let mut bad = a.clone();
            bad.service_data
                .get_mut(&super::super::radio::SERVICE)
                .unwrap()
                .resize(28, 0);
            assert!(validate(&bad).is_err());
            bad = a.clone();
            bad.local_name = Some("private".into());
            assert!(validate(&bad).is_err());
            bad = a.clone();
            bad.advertisement_type = Type::Broadcast;
            assert!(validate(&bad).is_err());
            bad = a.clone();
            bad.secondary_channel = Some(SecondaryChannel::OneM);
            assert!(validate(&bad).is_err());
            bad = a.clone();
            bad.discoverable = Some(true);
            assert!(validate(&bad).is_err());
            bad = a.clone();
            bad.timeout = None;
            assert!(validate(&bad).is_err());
        }
    }
    #[test]
    fn error_names_and_messages_fail_closed() {
        use bluer::{ErrorKind as E, InternalErrorKind as I};
        let secret = "AA:BB:CC:DD:EE:FF /home/owner/private.txt account@example.com SESSION-SECRET";
        for (kind, name, category) in [
            (
                E::InvalidArguments,
                "org.bluez.Error.InvalidArguments",
                "invalid-arguments",
            ),
            (
                E::InvalidLength,
                "org.bluez.Error.InvalidLength",
                "invalid-length",
            ),
            (
                E::NotPermitted,
                "org.bluez.Error.NotPermitted",
                "capacity-or-policy",
            ),
            (
                E::NotSupported,
                "org.bluez.Error.NotSupported",
                "not-supported",
            ),
            (E::InProgress, "org.bluez.Error.InProgress", "busy"),
            (
                E::AlreadyExists,
                "org.bluez.Error.AlreadyExists",
                "already-exists",
            ),
            (
                E::NotAuthorized,
                "org.bluez.Error.NotAuthorized",
                "permission-denied",
            ),
            (E::Failed, "org.bluez.Error.Failed", "failed"),
            (E::Internal(I::DBus(secret.into())), "unknown", "other"),
            (
                E::Internal(I::DBus("org.freedesktop.DBus.Error.LimitsExceeded".into())),
                "org.freedesktop.DBus.Error.LimitsExceeded",
                "resources",
            ),
        ] {
            let err: anyhow::Error = bluer::Error {
                kind,
                message: secret.into(),
            }
            .into();
            assert_eq!(failure(&err), (name, category));
            assert!(!format!("{:?}", failure(&err)).contains("SESSION-SECRET"));
        }
        let err: anyhow::Error = bluer::Error {
            kind: E::Failed,
            message: "Failed to parse advertisement.".into(),
        }
        .into();
        assert_eq!(failure(&err).1, "parse-failed");
        assert_eq!(failure_detail(&err), "parameter-parsing");
        let exact: anyhow::Error = bluer::Error {
            kind: E::Failed,
            message: "Failed to register advertisement".into(),
        }
        .into();
        assert_eq!(failure_detail(&exact), "controller-registration");
        let private: anyhow::Error = bluer::Error {
            kind: E::Failed,
            message: format!("Failed to register advertisement {secret}"),
        }
        .into();
        assert_eq!(failure_detail(&private), "unknown");
    }
    #[tokio::test(start_paused = true)]
    async fn retry_is_bounded_and_owner_bound_success_never_schedules_a_destructive_renewal() {
        let mut r = Retry::default();
        let mut now = Instant::now();
        assert!(r.due(now));
        for seconds in [2, 4, 8, 16, 30, 30, 30] {
            assert_eq!(r.failed(now).as_secs(), seconds);
            assert!(!r.due(now));
            now += Duration::from_secs(seconds);
            assert!(r.due(now));
        }
        r.succeeded(now);
        for seconds in [89, 90, 120, 130, 86400] {
            assert!(!r.due(now + Duration::from_secs(seconds)));
        }
        assert_eq!(RECEIVER_TIMEOUT, Duration::ZERO);
        // An actual daemon release still re-arms bounded recovery.
        assert_eq!(r.failed(now).as_secs(), 2);
        assert!(r.due(now + Duration::from_secs(2)));
        r.reset();
        assert!(r.due(now));
        assert_eq!(r.failed(now).as_secs(), 2);
        r.hidden(now);
        assert!(!r.due(now));
        r.reset();
        assert!(r.due(now));
        // The recorded 300-second failure must not cause 148 API calls again.
        let mut r = Retry::default();
        let start = Instant::now();
        let mut now = start;
        let mut attempts = 0;
        while now < start + Duration::from_secs(300) {
            if r.due(now) {
                attempts += 1;
                r.failed(now);
            }
            now += Duration::from_millis(250);
        }
        assert_eq!(attempts, 13);
    }
}

#[cfg(test)]
#[path = "advertising_test.rs"]
mod dbus_tests;

#[path = "advertising_publisher.rs"]
mod publisher;

pub use publisher::Handle;
