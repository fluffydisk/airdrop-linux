// GPL-3.0-only. Bounded Nearby BLE v2 codecs. Protocol references and provenance
// are recorded in docs/quickshare-ble-implementation.md; this is not device evidence.
use super::bloom::{bloom_positions, build_advertisement_header};
use anyhow::{Result, bail, ensure};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rqs_lib::utils::{DeviceType, gen_mdns_endpoint_info, parse_mdns_endpoint_info};

pub const HASH: [u8; 3] = [0xfc, 0x9f, 0x5e];
pub const MAX_ADVERT: usize = 512;
pub const MAX_FRAME: usize = 1024 * 1024;
pub const MAX_MESSAGE: usize = MAX_FRAME + 7;
pub const SLOT: &str = "00000000-0000-3000-8000-000000000000";
pub const WRITE: &str = "00000100-0004-1000-8000-001a11000101";
pub const NOTIFY: &str = "00000100-0004-1000-8000-001a11000102";
pub const INTRO: &[u8] = &[0, 0, 0, 8, 1, 18, 7, 10, 3, 0xfc, 0x9f, 0x5e, 16, 2];

/// Typed rejection reasons expose validation boundaries without exposing input.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DecodeError {
    InvalidLength,
    UnsupportedVersion,
    UnsupportedSocketVersion,
    UnsupportedFastFormat,
    InvalidServiceHash,
    BloomMismatch,
    MissingFields,
    InvalidFlagsPsm,
    InvalidEndpointMetadata,
    UnknownFieldsRejected,
    InvalidEncoding,
    UnsupportedSlots,
    UnsupportedPcp,
    UnsupportedProfile,
}
impl DecodeError {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidLength => "invalid_length",
            Self::UnsupportedVersion => "unsupported_version",
            Self::UnsupportedSocketVersion => "unsupported_socket_version",
            Self::UnsupportedFastFormat => "unsupported_fast_format",
            Self::InvalidServiceHash => "invalid_service_hash",
            Self::BloomMismatch => "bloom_mismatch",
            Self::MissingFields => "missing_fields",
            Self::InvalidFlagsPsm => "invalid_flags_psm",
            Self::InvalidEndpointMetadata => "invalid_endpoint_metadata",
            Self::UnknownFieldsRejected => "unknown_fields_rejected",
            Self::InvalidEncoding => "invalid_encoding",
            Self::UnsupportedSlots => "unsupported_slots",
            Self::UnsupportedPcp => "unsupported_pcp",
            Self::UnsupportedProfile => "unsupported_profile",
        }
    }
}
impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for DecodeError {}
macro_rules! check {
    ($condition:expr,$reason:ident) => {
        if !$condition {
            return Err(DecodeError::$reason);
        }
    };
}
/// Diagnostic-only recognition. Never turns an unsupported packet into a peer.
pub fn well_formed_fast_candidate(b: &[u8]) -> bool {
    if b.len() < 2
        || b.len() > MAX_ADVERT
        || b[0] >> 5 != 2
        || (b[0] >> 2) & 7 != 2
        || b[0] & 2 == 0
    {
        return false;
    }
    let n = b[1] as usize;
    if n < 6 || 2 + n > b.len() {
        return false;
    }
    let body = &b[2..2 + n];
    if body[0] != 0x23 || !body[1..5].iter().all(u8::is_ascii_alphanumeric) {
        return false;
    }
    let info = body[5] as usize;
    if info < 17 || 6 + info > body.len() {
        return false;
    }
    (b.len() == 2 + n || b.len() == 4 + n)
        && parse_mdns_endpoint_info(&URL_SAFE_NO_PAD.encode(&body[6..6 + info])).is_ok()
}

pub fn valid_psm(psm: u16) -> bool {
    (0x80..=0xff).contains(&psm)
}
#[derive(Clone, Debug)]
pub struct Header {
    pub slots: u8,
    pub psm: Option<u16>,
    pub hash: [u8; 4],
}
impl Header {
    pub fn decode(bytes: &[u8]) -> std::result::Result<Self, DecodeError> {
        let decoded;
        let b = if bytes.len() == 15 || bytes.len() == 17 {
            bytes
        } else {
            check!(bytes.len() <= 24, InvalidLength);
            decoded = URL_SAFE_NO_PAD
                .decode(bytes)
                .map_err(|_| DecodeError::InvalidEncoding)?;
            &decoded
        };
        check!(b.len() == 15 || b.len() == 17, InvalidLength);
        check!(b[0] >> 5 == 2, UnsupportedVersion);
        check!(b[0] & 15 > 0, UnsupportedSlots);
        check!(
            bloom_positions(b"NearbySharing", 80)
                .iter()
                .all(|p| b[1 + p / 8] & (1 << (p % 8)) != 0),
            BloomMismatch
        );
        let psm = if b.len() == 17 {
            Some(u16::from_be_bytes([b[15], b[16]])).filter(|p| *p != 0)
        } else {
            None
        };
        check!(psm.is_none_or(valid_psm), InvalidFlagsPsm);
        Ok(Self {
            slots: b[0] & 15,
            psm,
            hash: b[11..15]
                .try_into()
                .map_err(|_| DecodeError::MissingFields)?,
        })
    }
}

#[derive(Clone, Debug)]
pub struct Advert {
    pub endpoint: [u8; 4],
    pub identity: [u8; 16],
    pub name: String,
    pub kind: DeviceType,
    pub psm: Option<u16>,
    pub visible: bool,
}
impl Advert {
    pub fn decode(b: &[u8]) -> std::result::Result<Self, DecodeError> {
        check!(b.len() >= 8 && b.len() <= MAX_ADVERT, InvalidLength);
        check!(b[0] >> 5 == 2, UnsupportedVersion);
        check!((b[0] >> 2) & 7 == 2, UnsupportedSocketVersion);
        check!(b[0] & 2 == 0, UnsupportedFastFormat);
        check!(b[1..4] == HASH, InvalidServiceHash);
        let len = u32::from_be_bytes(b[4..8].try_into().map_err(|_| DecodeError::MissingFields)?)
            as usize;
        check!(len >= 9 && len <= b.len() - 8, InvalidLength);
        let data = &b[8..8 + len];
        check!(data[0] == 0x23, UnsupportedPcp);
        check!(data[1..4] == HASH, InvalidServiceHash);
        let endpoint: [u8; 4] = data[4..8]
            .try_into()
            .map_err(|_| DecodeError::MissingFields)?;
        check!(
            endpoint.iter().all(u8::is_ascii_alphanumeric),
            InvalidEndpointMetadata
        );
        let n = data[8] as usize;
        check!(n >= 17 && n <= data.len() - 9, InvalidLength);
        let info = &data[9..9 + n];
        let (kind, name) = parse_mdns_endpoint_info(&URL_SAFE_NO_PAD.encode(info))
            .map_err(|_| DecodeError::InvalidEndpointMetadata)?;
        check!(
            name.len() <= 80 && !name.chars().any(char::is_control),
            InvalidEndpointMetadata
        );
        let tail = &b[8 + len..];
        let mut psm = None;
        if tail.len() > 2 {
            let mask = tail[2];
            let mut at = 3;
            check!(mask & !3 == 0, UnknownFieldsRejected);
            if mask & 1 != 0 {
                check!(tail.len() >= at + 2, MissingFields);
                let p = u16::from_be_bytes([tail[at], tail[at + 1]]);
                check!(p == 0 || valid_psm(p), InvalidFlagsPsm);
                psm = Some(p).filter(|p| *p != 0);
                at += 2;
            }
            if mask & 2 != 0 {
                let size = *tail.get(at).ok_or(DecodeError::MissingFields)? as usize;
                at += 1;
                check!(tail.len() >= at + size, MissingFields);
                at += size;
            }
            check!(tail.len() == at, UnknownFieldsRejected);
        } else {
            check!(tail.is_empty() || tail.len() == 2, MissingFields);
        }
        Ok(Self {
            endpoint,
            identity: info[1..17]
                .try_into()
                .map_err(|_| DecodeError::MissingFields)?,
            name,
            kind,
            psm,
            visible: info[0] & 16 == 0,
        })
    }
    /// Service-bound decoder. Hashless fast data is valid only in Quick
    /// Share's FEF3 namespace, never as a generic hash-validation fallback.
    pub fn decode_service(service: u16, b: &[u8]) -> std::result::Result<Self, DecodeError> {
        check!(service == 0xfef3, InvalidServiceHash);
        if b.first().is_some_and(|v| v & 2 != 0) {
            Self::decode_fast(b)
        } else {
            Self::decode(b)
        }
    }
    /// Strict legacy fast subset from google/nearby@1bbe8ec: outer v2/socket2,
    /// one-byte length, inner v1/P2P-point-to-point, 17-byte identity metadata,
    /// optional zero-length UWB field, optional two-byte device token. Legacy
    /// fast advertising is at most 27 bytes and has no room for PSM/extras.
    fn decode_fast(b: &[u8]) -> std::result::Result<Self, DecodeError> {
        check!(b.len() >= 25 && b.len() <= 27, InvalidLength);
        check!(b[0] >> 5 == 2, UnsupportedVersion);
        check!((b[0] >> 2) & 7 == 2, UnsupportedSocketVersion);
        check!(b[0] & 1 == 0, UnsupportedProfile);
        check!(b[0] & 2 != 0, UnsupportedFastFormat);
        let n = b[1] as usize;
        check!(n == 23 || n == 24, InvalidLength);
        check!(2 + n <= b.len(), MissingFields);
        let data = &b[2..2 + n];
        check!(data[0] == 0x23, UnsupportedPcp);
        let endpoint: [u8; 4] = data[1..5]
            .try_into()
            .map_err(|_| DecodeError::MissingFields)?;
        check!(
            endpoint.iter().all(u8::is_ascii_alphanumeric),
            InvalidEndpointMetadata
        );
        check!(data[5] == 17, InvalidEndpointMetadata);
        let info = &data[6..23];
        check!(
            info[0] >> 5 <= 1 && info[0] & 1 == 0,
            InvalidEndpointMetadata
        );
        if n == 24 {
            check!(data[23] == 0, UnknownFieldsRejected);
        }
        check!(b.len() == 2 + n || b.len() == 4 + n, UnknownFieldsRejected);
        let (kind, name) = parse_mdns_endpoint_info(&URL_SAFE_NO_PAD.encode(info))
            .map_err(|_| DecodeError::InvalidEndpointMetadata)?;
        Ok(Self {
            endpoint,
            identity: info[1..17]
                .try_into()
                .map_err(|_| DecodeError::MissingFields)?,
            name,
            kind,
            psm: None,
            visible: info[0] & 16 == 0,
        })
    }
    pub fn same_identity(&self, other: &Self) -> bool {
        self.endpoint == other.endpoint && self.identity == other.identity
    }
    pub fn key(&self) -> String {
        rqs_lib::utils::discovery_key(self.endpoint, self.identity)
    }
}
pub fn receiver(endpoint: [u8; 4], name: &str, psm: Option<u16>) -> Result<Vec<u8>> {
    ensure!(psm.is_none_or(valid_psm), "invalid PSM");
    let info = URL_SAFE_NO_PAD.decode(gen_mdns_endpoint_info(3, name))?;
    ensure!(info.len() <= 255, "endpoint too large");
    let mut data = vec![0x23];
    data.extend(HASH);
    data.extend(endpoint);
    data.push(info.len() as u8);
    data.extend(info);
    data.extend([0; 8]);
    let mut b = vec![0x48];
    b.extend(HASH);
    b.extend((data.len() as u32).to_be_bytes());
    b.extend(data);
    b.extend(rand::random::<[u8; 2]>());
    if let Some(psm) = psm {
        b.push(1);
        b.extend(psm.to_be_bytes());
    } else {
        b.push(0);
    }
    Ok(b)
}
pub fn header(full: &[u8], extended: bool, psm: Option<u16>) -> Vec<u8> {
    build_advertisement_header(full, extended, psm)
}

/// Packet counters include the connection request/confirm (counter zero).
/// No continuation before first, interleaved message, or sequence gap is accepted.
#[derive(Default)]
pub struct Weave {
    pub rx: u8,
    pub tx: u8,
    assembly: Option<Vec<u8>>,
    pub packet_size: usize,
}
impl Weave {
    pub fn new() -> Self {
        Self {
            packet_size: 20,
            ..Default::default()
        }
    }
    pub fn accept(&mut self, b: &[u8], server: bool) -> Result<Vec<u8>> {
        ensure!(
            self.rx == 0
                && b.len() >= if server { 7 } else { 5 }
                && b.len() <= 20
                && b[0] == if server { 0x80 } else { 0x81 },
            "weave handshake"
        );
        let read = |at| u16::from_be_bytes([b[at], b[at + 1]]);
        let selected = if server {
            ensure!(read(1) <= 1 && read(3) >= 1, "weave version");
            let max = read(5);
            if max == 0 { 20 } else { max.min(20) }
        } else {
            ensure!(read(1) == 1, "weave version");
            read(3)
        };
        ensure!((20..=20).contains(&selected), "weave packet size");
        // Extra handshake bytes carry stream data; reject rather than discard them.
        ensure!(
            b.len() == if server { 7 } else { 5 },
            "weave extra data unsupported"
        );
        self.rx = 1;
        self.tx = 1;
        self.packet_size = selected as usize;
        Ok(vec![0x81, 0, 1, 0, selected as u8])
    }
    pub fn receive(&mut self, b: &[u8]) -> Result<Option<Vec<u8>>> {
        ensure!(
            !b.is_empty()
                && b.len() <= self.packet_size
                && b[0] & 0x83 == 0
                && (b[0] >> 4) & 7 == self.rx & 7,
            "weave packet"
        );
        self.rx = self.rx.wrapping_add(1);
        if b[0] & 8 != 0 {
            ensure!(self.assembly.is_none(), "interleaved weave message");
            self.assembly = Some(Vec::new());
        }
        let a = self
            .assembly
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("weave continuation without first"))?;
        ensure!(
            a.len() + b.len() - 1 <= MAX_MESSAGE,
            "weave message too large"
        );
        a.extend_from_slice(&b[1..]);
        Ok(if b[0] & 4 != 0 {
            self.assembly.take()
        } else {
            None
        })
    }
    pub fn packets(&mut self, message: &[u8]) -> Result<Vec<Vec<u8>>> {
        ensure!(
            !message.is_empty() && message.len() <= MAX_MESSAGE && self.packet_size >= 20,
            "weave message size"
        );
        let count = message.len().div_ceil(self.packet_size - 1);
        let mut out = Vec::with_capacity(count);
        for (i, chunk) in message.chunks(self.packet_size - 1).enumerate() {
            let mut p = vec![
                (self.tx & 7) << 4
                    | if i == 0 { 8 } else { 0 }
                    | if i + 1 == count { 4 } else { 0 },
            ];
            self.tx = self.tx.wrapping_add(1);
            p.extend(chunk);
            out.push(p);
        }
        Ok(out)
    }
}
/// Cancellation-safe accumulator for the Nearby [length][frame] stream.
#[derive(Default)]
pub struct Frames {
    bytes: Vec<u8>,
}
impl Frames {
    pub fn push(&mut self, b: &[u8]) -> Result<()> {
        ensure!(
            self.bytes.len() + b.len() <= MAX_FRAME + 4096,
            "frame buffer limit"
        );
        self.bytes.extend(b);
        if self.bytes.len() >= 4 {
            let n = u32::from_be_bytes(self.bytes[..4].try_into()?) as usize;
            ensure!(n > 0 && n <= MAX_FRAME, "frame length");
        }
        Ok(())
    }
    pub fn pop(&mut self) -> Result<Option<Vec<u8>>> {
        if self.bytes.len() < 4 {
            return Ok(None);
        }
        let n = u32::from_be_bytes(self.bytes[..4].try_into()?) as usize;
        ensure!(n > 0 && n <= MAX_FRAME, "frame length");
        if self.bytes.len() < n + 4 {
            return Ok(None);
        }
        Ok(Some(self.bytes.drain(..n + 4).collect()))
    }
}
pub fn socket_data(message: &[u8]) -> Result<Option<&[u8]>> {
    use prost::Message;
    use rqs_lib::ble_proto::{SocketControlFrame, socket_control_frame::ControlFrameType};
    ensure!(message.len() >= 3, "socket message too short");
    if message[..3] == [0, 0, 0] {
        ensure!(message.len() <= MAX_ADVERT, "control length");
        let control = SocketControlFrame::decode(&message[3..])?;
        match control.r#type() {
            ControlFrameType::Introduction => {
                ensure!(
                    control.disconnection.is_none() && control.packet_acknowledgement.is_none(),
                    "mixed control"
                );
                let i = control
                    .introduction
                    .ok_or_else(|| anyhow::anyhow!("missing introduction"))?;
                ensure!(
                    i.service_id_hash.as_deref() == Some(&HASH[..]) && i.socket_version == Some(2),
                    "socket introduction"
                );
            }
            ControlFrameType::PacketAcknowledgement => {
                ensure!(
                    control.introduction.is_none() && control.disconnection.is_none(),
                    "mixed control"
                );
                let a = control
                    .packet_acknowledgement
                    .ok_or_else(|| anyhow::anyhow!("missing acknowledgement"))?;
                ensure!(
                    a.service_id_hash.as_deref() == Some(&HASH[..])
                        && a.received_size
                            .is_some_and(|n| n >= 0 && n as usize <= MAX_FRAME + 4),
                    "socket acknowledgement"
                );
            }
            _ => bail!("socket disconnected or unsupported control"),
        }
        return Ok(None);
    }
    ensure!(message[..3] == HASH, "foreign socket service");
    let b = &message[3..];
    ensure!(b.len() >= 4, "socket frame missing");
    let n = u32::from_be_bytes(b[..4].try_into()?) as usize;
    ensure!(
        n > 0 && n <= MAX_FRAME && b.len() == n + 4,
        "socket frame length"
    );
    Ok(Some(b))
}
pub fn acknowledgement(size: usize) -> Result<Vec<u8>> {
    use prost::Message;
    use rqs_lib::ble_proto::{PacketAcknowledgementFrame, SocketControlFrame};
    ensure!(size <= MAX_FRAME + 4, "acknowledgement size");
    let control = SocketControlFrame {
        r#type: Some(3),
        packet_acknowledgement: Some(PacketAcknowledgementFrame {
            service_id_hash: Some(HASH.to_vec()),
            received_size: Some(size as i32),
        }),
        ..Default::default()
    };
    let mut b = vec![0; 3];
    b.extend(control.encode_to_vec());
    Ok(b)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_rejection_reasons_do_not_relax_formats() {
        let full = receiver(*b"AB12", "Linux", None).unwrap();
        let h = header(&full, false, None);
        let mut b = full.clone();
        b[0] = 0x68;
        assert_eq!(
            Advert::decode(&b).unwrap_err(),
            DecodeError::UnsupportedVersion
        );
        b = full.clone();
        b[0] = 0x44;
        assert_eq!(
            Advert::decode(&b).unwrap_err(),
            DecodeError::UnsupportedSocketVersion
        );
        b = full.clone();
        b[0] |= 2;
        assert_eq!(
            Advert::decode(&b).unwrap_err(),
            DecodeError::UnsupportedFastFormat
        );
        b = full.clone();
        b[1] ^= 1;
        assert_eq!(
            Advert::decode(&b).unwrap_err(),
            DecodeError::InvalidServiceHash
        );
        b = full.clone();
        b[12] = 0;
        assert_eq!(
            Advert::decode(&b).unwrap_err(),
            DecodeError::InvalidEndpointMetadata
        );
        b = full.clone();
        *b.last_mut().unwrap() = 4;
        assert_eq!(
            Advert::decode(&b).unwrap_err(),
            DecodeError::UnknownFieldsRejected
        );
        let mut bad = h.clone();
        bad[0] &= 0xf0;
        assert_eq!(
            Header::decode(&bad).unwrap_err(),
            DecodeError::UnsupportedSlots
        );
        bad = h.clone();
        bad[1..11].fill(0);
        assert_eq!(
            Header::decode(&bad).unwrap_err(),
            DecodeError::BloomMismatch
        );
        bad = h.clone();
        bad.extend([0, 1]);
        assert_eq!(
            Header::decode(&bad).unwrap_err(),
            DecodeError::InvalidFlagsPsm
        );
        assert_eq!(
            Header::decode(b"!").unwrap_err(),
            DecodeError::InvalidEncoding
        );
        assert_eq!(Advert::decode(&[]).unwrap_err(), DecodeError::InvalidLength);
    }
    #[test]
    fn well_formed_unsupported_fast_shape_is_diagnostic_only() {
        let info = URL_SAFE_NO_PAD
            .decode(gen_mdns_endpoint_info(3, "Linux"))
            .unwrap();
        let mut body = vec![0x23];
        body.extend(b"AB12");
        body.push(info.len() as u8);
        body.extend(info);
        let mut fast = vec![0x4a, body.len() as u8];
        fast.extend(body);
        assert!(well_formed_fast_candidate(&fast));
        assert_eq!(
            Advert::decode(&fast).unwrap_err(),
            DecodeError::UnsupportedFastFormat
        );
        assert!(Header::decode(&fast).is_err());
        for n in 0..fast.len() {
            assert!(!well_formed_fast_candidate(&fast[..n]));
        }
    }
    #[test]
    fn independent_fast_fixture_is_service_bound_and_strict() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/quickshare-ble-wire.json"
        ))
        .unwrap();
        for negative in fixture["fastRejected"].as_array().unwrap() {
            let text = negative["bytes"].as_str().unwrap();
            let bytes: Vec<u8> = (0..text.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
                .collect();
            assert!(
                Advert::decode_service(negative["service"].as_u64().unwrap() as u16, &bytes)
                    .is_err(),
                "independent negative {}",
                negative["case"]
            );
        }
        let text = fixture["fast"].as_str().unwrap();
        let bytes: Vec<u8> = (0..text.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&text[i..i + 2], 16).unwrap())
            .collect();
        let a = Advert::decode_service(0xfef3, &bytes).unwrap();
        assert_eq!(a.endpoint, *b"S24A");
        assert_eq!(a.identity, core::array::from_fn(|i| i as u8));
        assert!(a.name.is_empty() && a.psm.is_none());
        assert_eq!(
            Advert::decode_service(0xfe2c, &bytes).unwrap_err(),
            DecodeError::InvalidServiceHash
        );
        // No-token form is documented; every other truncation is malformed.
        for n in 0..bytes.len() {
            if n != 25 {
                assert!(
                    Advert::decode_service(0xfef3, &bytes[..n]).is_err(),
                    "prefix {n}"
                );
            }
        }
        assert!(Advert::decode_service(0xfef3, &bytes[..25]).is_ok());
        for (at, value) in [
            (0, 0x6a),
            (0, 0x46),
            (0, 0x4b),
            (1, 24),
            (1, 255),
            (2, 0x21),
            (3, 0),
            (7, 16),
            (8, 0xe0),
            (8, 0x13),
        ] {
            let mut bad = bytes.clone();
            bad[at] = value;
            assert!(
                Advert::decode_service(0xfef3, &bad).is_err(),
                "mutation {at}/{value}"
            );
        }
        let mut trailing = bytes.clone();
        trailing.push(0);
        assert!(Advert::decode_service(0xfef3, &trailing).is_err());
        let mut uwb = bytes[..25].to_vec();
        uwb[1] = 24;
        uwb.push(0);
        assert!(Advert::decode_service(0xfef3, &uwb).is_ok());
        uwb[25] = 1;
        assert!(Advert::decode_service(0xfef3, &uwb).is_err());
        let mut other = a.clone();
        other.endpoint = *b"ZZZZ";
        assert!(!a.same_identity(&other));
        other = a.clone();
        other.identity[0] ^= 1;
        assert!(!a.same_identity(&other));
        assert!(a.same_identity(&a));
    }
    #[test]
    fn coherent_identity_and_header() {
        let f = receiver(*b"AB12", "Linux 한", None).unwrap();
        let a = Advert::decode(&f).unwrap();
        assert_eq!(a.identity, *rqs_lib::utils::ENDPOINT_IDENTITY);
        assert_eq!(a.endpoint, *b"AB12");
        assert_eq!(a.name, "Linux 한");
        let h = Header::decode(&header(&f, false, None)).unwrap();
        assert_eq!(h.slots, 1);
        assert!(h.psm.is_none());
    }
    #[test]
    fn malformed_ads_and_psms() {
        let f = receiver(*b"AB12", "Linux", Some(128)).unwrap();
        assert_eq!(Advert::decode(&f).unwrap().psm, Some(128));
        for n in 0..(8 + u32::from_be_bytes(f[4..8].try_into().unwrap()) as usize) {
            assert!(Advert::decode(&f[..n]).is_err());
        }
        for p in [1, 31, 127, 256, 65535] {
            assert!(receiver(*b"AB12", "Linux", Some(p)).is_err());
        }
        let mut bad = f;
        bad[4..8].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(Advert::decode(&bad).is_err());
    }
    #[test]
    fn independent_python_wire_fixtures() {
        let v: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/quickshare-ble-wire.json"
        ))
        .unwrap();
        let decode = |s: &str| -> Vec<u8> {
            (0..s.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
                .collect()
        };
        let advert = Advert::decode(&decode(v["full"].as_str().unwrap())).unwrap();
        assert_eq!(advert.endpoint, *b"S24A");
        assert_eq!(advert.name, "Galaxy");
        assert!(advert.psm.is_none());
        assert_eq!(
            Header::decode(&decode(v["compact"].as_str().unwrap()))
                .unwrap()
                .slots,
            1
        );
        let positions = bloom_positions(b"NearbySharing", 80);
        assert_eq!(serde_json::json!(positions), v["bloomPositions"]);
        let mut weave = Weave::new();
        weave.accept(&[0x81, 0, 1, 0, 20], false).unwrap();
        let mut message = None;
        for p in v["packets"].as_array().unwrap() {
            message = weave.receive(&decode(p.as_str().unwrap())).unwrap();
        }
        assert_eq!(
            socket_data(&message.unwrap()).unwrap().unwrap(),
            decode(v["nearbyFrame"].as_str().unwrap())
        );
    }
    #[test]
    fn weave_fragment_order_and_bounds() {
        let mut a = Weave::new();
        a.accept(&[0x80, 0, 1, 0, 1, 0, 20], true).unwrap();
        let mut b = Weave::new();
        b.accept(&[0x81, 0, 1, 0, 20], false).unwrap();
        let data = vec![7; 111];
        let ps = a.packets(&data).unwrap();
        let mut got = None;
        for p in &ps {
            got = b.receive(p).unwrap();
        }
        assert_eq!(got.unwrap(), data);
        assert!(b.receive(&ps[0]).is_err());
        let mut c = Weave::new();
        assert!(c.accept(&[0x80, 0, 2, 0, 3, 0, 20], true).is_err());
        assert!(c.receive(&[0x14, 1]).is_err());
    }
    #[test]
    fn frames_and_service_are_bounded() {
        let mut f = Frames::default();
        f.push(&[0, 0]).unwrap();
        assert!(f.pop().unwrap().is_none());
        f.push(&[0, 1, 9]).unwrap();
        assert_eq!(f.pop().unwrap().unwrap(), [0, 0, 0, 1, 9]);
        assert!(f.push(&u32::MAX.to_be_bytes()).is_err());
        assert!(socket_data(&[1, 2, 3, 0, 0, 0, 1, 5]).is_err());
    }
    #[test]
    fn advertisements_never_panic_on_arbitrary_bounded_input() {
        use rand::RngCore;
        for n in 0..=MAX_ADVERT + 1 {
            let mut b = vec![0; n];
            rand::rng().fill_bytes(&mut b);
            let _ = Advert::decode(&b);
            let _ = Header::decode(&b);
        }
    }
    #[test]
    fn weave_rejects_oversize_and_unfinished_fragments() {
        let mut w = Weave::new();
        w.accept(&[0x80, 0, 1, 0, 1, 0, 20], true).unwrap();
        assert!(w.receive(&[0x1c; 21]).is_err());
        let mut w = Weave::new();
        w.accept(&[0x80, 0, 1, 0, 1, 0, 20], true).unwrap();
        w.receive(&[0x18, 1]).unwrap();
        assert!(w.receive(&[0x28, 1]).is_err());
        let mut w = Weave::new();
        w.accept(&[0x80, 0, 1, 0, 1, 0, 20], true).unwrap();
        for n in 0..(MAX_MESSAGE / 19 + 1) {
            let mut p = vec![1; 20];
            p[0] = (((n + 1) & 7) as u8) << 4 | if n == 0 { 8 } else { 0 };
            let r = w.receive(&p);
            if r.is_err() {
                return;
            }
        }
        panic!("unbounded fragment assembly accepted");
    }
    #[test]
    fn socket_controls_validate_hash_and_sizes() {
        assert!(socket_data(INTRO).unwrap().is_none());
        assert!(
            socket_data(&acknowledgement(42).unwrap())
                .unwrap()
                .is_none()
        );
        let mut wrong = INTRO.to_vec();
        wrong[11] ^= 1;
        assert!(socket_data(&wrong).is_err());
        assert!(acknowledgement(MAX_FRAME + 5).is_err());
        assert!(socket_data(&[0, 0, 0, 8, 2]).is_err());
    }
    #[test]
    fn lan_ble_and_connection_metadata_have_identical_ephemeral_identity() {
        let endpoint = *b"AB12";
        let full = receiver(endpoint, "Linux", None).unwrap();
        let advert = Advert::decode(&full).unwrap();
        let info = gen_mdns_endpoint_info(3, "Linux");
        let name = format!("{}.service.local.", rqs_lib::utils::gen_mdns_name(endpoint));
        assert_eq!(
            rqs_lib::utils::mdns_discovery_key(&name, &info).unwrap(),
            advert.key()
        );
        let connection = rqs_lib::utils::RemoteDeviceInfo {
            name: "Linux".into(),
            device_type: DeviceType::Laptop,
        }
        .serialize();
        assert_eq!(&connection[1..17], &advert.identity);
        assert!(rqs_lib::utils::mdns_discovery_key("bad.service.local.", &info).is_none());
    }
}
