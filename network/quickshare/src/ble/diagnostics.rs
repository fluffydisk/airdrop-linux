// GPL-3.0-only. Metadata-free, fixed-schema diagnostic counters. No addresses,
// packet bytes, keys, names or verification codes are ever serialized.
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashSet},
    hash::{Hash, Hasher},
    sync::{Arc, LazyLock, Mutex},
};
use tokio::time::Instant;
const LIMIT: u64 = 1_000_000_000;
static KEYS: LazyLock<HashSet<String>> = LazyLock::new(|| {
    let schema: Value = serde_json::from_str(include_str!(
        "../../../../lib/sharing/quickshare-diagnostic-schema.json"
    ))
    .expect("compiled diagnostic schema");
    schema["counters"]
        .as_array()
        .expect("counter schema")
        .iter()
        .filter_map(|v| v.as_str().map(str::to_owned))
        .collect()
});
#[derive(Default)]
struct State {
    counters: BTreeMap<String, u64>,
    candidates: HashSet<u64>,
    scan_closed: Option<Instant>,
}
#[derive(Clone, Default)]
pub struct Diagnostics(Arc<Mutex<State>>);
static ACTIVE: LazyLock<Diagnostics> = LazyLock::new(Diagnostics::default);
impl Diagnostics {
    pub fn count(&self, key: &str, n: u64) {
        if KEYS.contains(key)
            && let Ok(mut state) = self.0.lock()
        {
            let entry = state.counters.entry(key.to_owned()).or_default();
            *entry = entry.saturating_add(n).min(LIMIT);
        }
    }
    pub fn snapshot(&self) -> Value {
        let counters = self
            .0
            .lock()
            .map(|s| s.counters.clone())
            .unwrap_or_default();
        json!({"schema":1,"counters":counters})
    }
    pub fn observe(&self, candidate: impl Hash, length: usize, first: Option<u8>) {
        self.count("fef3_observations", 1);
        let bucket = match length {
            0..=7 => "0_7",
            8..=14 => "8_14",
            15 => "15",
            16 => "16",
            17 => "17",
            18..=24 => "18_24",
            25..=31 => "25_31",
            32..=127 => "32_127",
            128..=512 => "128_512",
            _ => "over_512",
        };
        self.count(&format!("length_{bucket}"), 1);
        if let Some(first) = first {
            self.count(&format!("version_{}", first >> 5), 1);
        }
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        candidate.hash(&mut hash);
        let id = hash.finish();
        let key = if let Ok(mut s) = self.0.lock() {
            if s.candidates.contains(&id) {
                "candidate_repeated"
            } else if s.candidates.len() < 256 {
                s.candidates.insert(id);
                "candidate_distinct"
            } else {
                "candidate_tracking_saturated"
            }
        } else {
            return;
        };
        self.count(key, 1);
    }
    pub fn parse_observation(
        &self,
        candidate: impl Hash,
        bytes: &[u8],
    ) -> (
        Result<super::protocol::Advert, super::protocol::DecodeError>,
        Result<super::protocol::Header, super::protocol::DecodeError>,
    ) {
        self.observe(candidate, bytes.len(), bytes.first().copied());
        let full = super::protocol::Advert::decode(bytes);
        let compact = super::protocol::Header::decode(bytes);
        match &full {
            Ok(_) => self.count("full_accepted", 1),
            Err(e) => self.count(&format!("full_reject_{}", e.code()), 1),
        }
        match &compact {
            Ok(_) => self.count("compact_accepted", 1),
            Err(e) => self.count(&format!("compact_reject_{}", e.code()), 1),
        }
        let decoded = if matches!(
            &full,
            Err(super::protocol::DecodeError::UnsupportedFastFormat)
        ) {
            let size = match bytes.len() {
                0..=24 => "0_24",
                25 => "25",
                26 => "26",
                27 => "27",
                28..=31 => "28_31",
                _ => "over_31",
            };
            self.count(&format!("fast_length_{size}"), 1);
            if let Some(length) = bytes.get(7) {
                self.count(
                    if *length == 17 {
                        "fast_info_prefix_17"
                    } else {
                        "fast_info_prefix_other"
                    },
                    1,
                );
            }
            let fast = super::protocol::Advert::decode_service(0xfef3, bytes);
            match &fast {
                Ok(_) => self.count("fast_accepted", 1),
                Err(e) => self.count(&format!("fast_reject_{}", e.code()), 1),
            }
            fast
        } else {
            full
        };
        if decoded.is_err() && compact.is_err() {
            self.count("candidate_rejected", 1);
            if bytes.len() != 15 && bytes.len() != 17 && !(bytes.len() >= 8 && bytes[0] >> 5 == 2) {
                self.count("format_unrecognized", 1)
            }
            if super::protocol::well_formed_fast_candidate(bytes) {
                self.count("unsupported_fast_well_formed", 1)
            }
        }
        (decoded, compact)
    }
    pub fn scan_open(&self) {
        self.count("scan_windows", 1);
        let closed = self.0.lock().ok().and_then(|mut s| s.scan_closed.take());
        if let Some(at) = closed {
            self.count(
                "scan_pause_ms",
                at.elapsed().as_millis().min(LIMIT as u128) as u64,
            );
        }
    }
    pub fn scan_close(&self, started: Instant) {
        self.count("scan_closed", 1);
        self.count(
            "scan_ms",
            started.elapsed().as_millis().min(LIMIT as u128) as u64,
        );
        if let Ok(mut s) = self.0.lock() {
            s.scan_closed = Some(Instant::now());
        }
    }
}
pub fn current() -> Diagnostics {
    ACTIVE.clone()
}
pub fn inc(key: &str) {
    ACTIVE.count(key, 1);
}
pub fn reject(kind: &str, error: &super::protocol::DecodeError) {
    inc(&format!("{kind}_reject_{}", error.code()));
}
pub fn dbus_error(kind: &bluer::ErrorKind) {
    inc(match kind {
        bluer::ErrorKind::NotAuthorized | bluer::ErrorKind::NotPermitted => {
            "dbus_permission_denied"
        }
        bluer::ErrorKind::NotSupported => "dbus_not_supported",
        bluer::ErrorKind::ConnectionAttemptFailed => "dbus_connection_failed",
        bluer::ErrorKind::AuthenticationFailed
        | bluer::ErrorKind::AuthenticationRejected
        | bluer::ErrorKind::AuthenticationCanceled => "dbus_link_authentication_failed",
        bluer::ErrorKind::AuthenticationTimeout => "dbus_link_timeout",
        bluer::ErrorKind::ServicesUnresolved => "dbus_services_unresolved",
        bluer::ErrorKind::DiscoveryActive => "dbus_discovery_active",
        bluer::ErrorKind::InvalidLength
        | bluer::ErrorKind::InvalidOffset
        | bluer::ErrorKind::InvalidArguments => "dbus_invalid_value",
        bluer::ErrorKind::NotReady => "dbus_not_ready",
        bluer::ErrorKind::InProgress => "dbus_busy",
        bluer::ErrorKind::DoesNotExist | bluer::ErrorKind::NotAvailable => "dbus_missing_object",
        _ => "dbus_other_error",
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn repeated_observations_are_not_distinct_devices_and_schema_is_bounded() {
        let d = Diagnostics::default();
        for _ in 0..72 {
            d.observe(7u64, 24, Some(0x4a));
        }
        assert_eq!(d.snapshot()["counters"]["fef3_observations"], 72);
        assert_eq!(d.snapshot()["counters"]["candidate_distinct"], 1);
        assert_eq!(d.snapshot()["counters"]["candidate_repeated"], 71);
        d.count("PRIVATE ADDRESS", 1);
        d.count("scan_ms", u64::MAX);
        assert_eq!(d.snapshot()["counters"]["scan_ms"], LIMIT);
        assert!(!d.snapshot().to_string().contains("PRIVATE"));
    }
    #[test]
    fn rejected_observations_have_two_parser_reasons_and_no_endpoint() {
        let d = Diagnostics::default();
        for _ in 0..72 {
            let (full, compact) = d.parse_observation(1u64, &[0x68; 17]);
            assert!(full.is_err() && compact.is_err());
        }
        let c = d.snapshot();
        assert_eq!(c["counters"]["fef3_observations"], 72);
        assert_eq!(c["counters"]["candidate_rejected"], 72);
        assert_eq!(c["counters"]["full_reject_unsupported_version"], 72);
        assert_eq!(c["counters"]["compact_reject_unsupported_version"], 72);
        assert!(c["counters"]["endpoint_decoded"].is_null());
    }
    #[tokio::test(start_paused = true)]
    async fn scan_durations_exclude_pause_and_are_bounded() {
        let d = Diagnostics::default();
        let at = Instant::now();
        d.scan_open();
        tokio::time::advance(std::time::Duration::from_secs(3)).await;
        d.scan_close(at);
        tokio::time::advance(std::time::Duration::from_secs(7)).await;
        d.scan_open();
        let c = d.snapshot();
        assert_eq!(c["counters"]["scan_ms"], 3000);
        assert_eq!(c["counters"]["scan_pause_ms"], 7000);
        assert_eq!(c["counters"]["scan_windows"], 2);
    }
    #[test]
    fn supported_fast_is_not_a_joint_parser_rejection() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/quickshare-ble-wire.json"
        ))
        .unwrap();
        let h = fixture["fast"].as_str().unwrap();
        let b: Vec<u8> = (0..h.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap())
            .collect();
        let d = Diagnostics::default();
        let (a, h) = d.parse_observation(1, &b);
        assert!(a.is_ok() && h.is_err());
        let c = d.snapshot();
        assert_eq!(c["counters"]["fast_accepted"], 1);
        assert_eq!(c["counters"]["full_reject_unsupported_fast_format"], 1);
        assert!(c["counters"]["candidate_rejected"].is_null());
    }
}
