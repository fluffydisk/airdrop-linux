// Modified by Airdrop Linux, 2026-11-10; see network/quickshare/MODIFICATIONS.md.
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};

use anyhow::anyhow;
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use bytes::Bytes;
use get_if_addrs::{IfAddr, get_if_addrs};
use hkdf::Hkdf;
use num_bigint::{BigUint, ToBigInt};
use p256::elliptic_curve::rand_core::OsRng;
use p256::{PublicKey, SecretKey};
use rand::{Rng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tokio::io::AsyncReadExt;

use crate::CUSTOM_DOWNLOAD;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[allow(dead_code)]
pub enum DeviceType {
    Unknown = 0,
    Phone = 1,
    Tablet = 2,
    Laptop = 3,
}

#[allow(dead_code)]
impl DeviceType {
    pub fn from_raw_value(value: u8) -> Self {
        match value {
            0 => DeviceType::Unknown,
            1 => DeviceType::Phone,
            2 => DeviceType::Tablet,
            3 => DeviceType::Laptop,
            _ => DeviceType::Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoteDeviceInfo {
    pub name: String,
    pub device_type: DeviceType,
}

impl RemoteDeviceInfo {
    pub fn serialize(&self) -> Vec<u8> {
        // 1 byte: Version(3 bits)|Visibility(1 bit)|Device Type(3 bits)|Reserved(1 bit)
        let mut endpoint_info: Vec<u8> = vec![((self.device_type.clone() as u8) << 1) & 0b111];

        // 16 bytes: unknown random bytes
        endpoint_info.extend((0..16).map(|_| rand::rng().random_range(0..=255)));

        // Device name in UTF-8 prefixed with 1-byte length
        let name_chars = utf8_prefix(&self.name, 255).as_bytes();
        endpoint_info.push(name_chars.len() as u8);
        endpoint_info.extend_from_slice(name_chars);

        endpoint_info
    }
}

pub fn gen_mdns_name(endpoint_id: [u8; 4]) -> String {
    let mut name_b = Vec::new();

    let pcp: [u8; 1] = [0x23];
    name_b.extend_from_slice(&pcp);

    name_b.extend_from_slice(&endpoint_id);

    let service_id: [u8; 3] = [0xFC, 0x9F, 0x5E];
    name_b.extend_from_slice(&service_id);

    let unknown_bytes: [u8; 2] = [0x00, 0x00];
    name_b.extend_from_slice(&unknown_bytes);

    URL_SAFE_NO_PAD.encode(&name_b)
}

/// The 16 identity bytes (2-byte salt + 14-byte metadata-key hash) this run
/// presents in every advertisement. Random per run, but the *same* over mDNS
/// and BLE: the phone can't tell that two advertisements with different
/// identity bytes are the same device, and lists it twice.
pub static ENDPOINT_IDENTITY: once_cell::sync::Lazy<[u8; 16]> =
    once_cell::sync::Lazy::new(|| rand::rng().random());

pub(crate) fn utf8_prefix(name: &str, maximum: usize) -> &str {
    let mut end = name.len().min(maximum);
    while !name.is_char_boundary(end) {
        end -= 1;
    }
    &name[..end]
}

pub fn gen_mdns_endpoint_info(device_type: u8, device_name: &str) -> String {
    let mut record = Vec::new();

    // 1 byte: Version(3 bits)|Visibility(1 bit)|Device Type(3 bits)|Reserved(1 bits)
    // Device types: unknown=0, phone=1, tablet=2, laptop=3
    record.push(device_type << 1);

    record.extend_from_slice(ENDPOINT_IDENTITY.as_slice());

    let device_name = utf8_prefix(device_name, 255).as_bytes();
    let length = device_name.len() as u8;
    record.push(length);
    record.extend_from_slice(device_name);

    URL_SAFE_NO_PAD.encode(&record)
}

pub fn parse_mdns_endpoint_info(encoded_str: &str) -> Result<(DeviceType, String), anyhow::Error> {
    if encoded_str.len() > 8192 {
        return Err(anyhow!("Advertisement too large"));
    }
    let decoded_bytes = URL_SAFE_NO_PAD.decode(encoded_str)?;
    if decoded_bytes.len() < 17 {
        return Err(anyhow!("Invalid data length"));
    }

    if decoded_bytes[0] >> 5 > 1 {
        return Err(anyhow!("Unsupported advertisement version"));
    }
    let device_type = (decoded_bytes[0] >> 1) & 0x7;
    // Some Android advertisements carry only the identity prefix. An absent
    // display name must not hide an otherwise usable endpoint; it is not trust.
    if decoded_bytes.len() == 17 {
        return Ok((DeviceType::from_raw_value(device_type), String::new()));
    }
    // Google sharing/advertisement.cc: bit 4 set means no name. Bytes after
    // the identity are TLVs in that case, not a name-length byte.
    let has_name = decoded_bytes[0] & 0x10 == 0;
    let name_length = if has_name {
        decoded_bytes[17] as usize
    } else {
        0
    };
    let name_start = if has_name { 18 } else { 17 };
    if name_start + name_length > decoded_bytes.len() {
        return Err(anyhow!("Invalid name length"));
    }

    let device_name_bytes = &decoded_bytes[name_start..name_start + name_length];
    let device_name = String::from_utf8(device_name_bytes.to_vec())?;
    let mut offset = name_start + name_length;
    while decoded_bytes.len() - offset >= 2 {
        let length = decoded_bytes[offset + 1] as usize;
        offset += 2;
        if length > decoded_bytes.len() - offset {
            return Err(anyhow!("Invalid advertisement TLV length"));
        }
        offset += length;
    }

    Ok((DeviceType::from_raw_value(device_type), device_name))
}

pub async fn stream_read_exact<S: tokio::io::AsyncRead + Unpin>(
    socket: &mut S,
    buf: &mut [u8],
) -> Result<(), anyhow::Error> {
    match socket.read_exact(buf).await {
        Ok(_) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

/// Prefix bytes survive cancellation by the control-message select branch.
/// AsyncReadExt::read is cancellation-safe; read_exact on a stack buffer is not.
#[derive(Debug, Default)]
pub(crate) struct LengthPrefix {
    bytes: [u8; 4],
    used: usize,
}
impl LengthPrefix {
    pub(crate) async fn read<S: tokio::io::AsyncRead + Unpin>(
        &mut self,
        socket: &mut S,
    ) -> std::io::Result<[u8; 4]> {
        while self.used < self.bytes.len() {
            let n = socket.read(&mut self.bytes[self.used..]).await?;
            if n == 0 {
                return Err(std::io::ErrorKind::UnexpectedEof.into());
            }
            self.used += n;
        }
        self.used = 0;
        Ok(self.bytes)
    }
}

pub fn gen_ecdsa_keypair() -> (SecretKey, PublicKey) {
    let secret_key = SecretKey::random(&mut OsRng);
    let public_key = secret_key.public_key();

    (secret_key, public_key)
}

pub fn decode_p256_public_key(
    raw: crate::securemessage::GenericPublicKey,
) -> Result<PublicKey, anyhow::Error> {
    if raw.r#type != crate::securemessage::PublicKeyType::EcP256 as i32 {
        return Err(anyhow!("Unsupported public key type"));
    }
    let key = raw
        .ec_p256_public_key
        .ok_or_else(|| anyhow!("Missing P-256 public key"))?;
    let mut encoded = [0u8; 65];
    encoded[0] = 4;
    decode_coordinate(&key.x, &mut encoded[1..33])?;
    decode_coordinate(&key.y, &mut encoded[33..])?;
    PublicKey::from_sec1_bytes(&encoded).map_err(|_| anyhow!("Invalid P-256 point"))
}

fn decode_coordinate(bytes: &[u8], target: &mut [u8]) -> Result<(), anyhow::Error> {
    // Java's positive BigInteger encoding may add one leading zero. Accept
    // shorter unsigned coordinates with left padding, never truncate data.
    let bytes = if bytes.len() == 33 && bytes[0] == 0 {
        &bytes[1..]
    } else {
        bytes
    };
    if bytes.is_empty() || bytes.len() > 32 {
        return Err(anyhow!("Invalid P-256 coordinate"));
    }
    target[32 - bytes.len()..].copy_from_slice(bytes);
    Ok(())
}

pub fn encode_point(unsigned: Bytes) -> Result<Vec<u8>, anyhow::Error> {
    let big_int = BigUint::from_bytes_be(&unsigned)
        .to_bigint()
        .ok_or_else(|| anyhow!("Failed to convert to bigint"))?;

    Ok(big_int.to_signed_bytes_be())
}

pub fn hkdf_extract_expand(
    salt: &[u8],
    input: &[u8],
    info: &[u8],
    output_len: usize,
) -> Result<Vec<u8>, anyhow::Error> {
    let hkdf = Hkdf::<Sha256>::new(Some(salt), input);
    let mut okm = vec![0u8; output_len];
    hkdf.expand(info, &mut okm)
        .map_err(|e| anyhow!("HKDF expand failed: {}", e))?;
    Ok(okm)
}

pub fn to_four_digit_string(bytes: &Vec<u8>) -> String {
    let k_hash_modulo = 9973;
    let k_hash_base_multiplier = 31;

    let mut hash = 0;
    let mut multiplier = 1;
    for &byte in bytes {
        let byte = byte as i8 as i32;
        hash = (hash + byte * multiplier) % k_hash_modulo;
        multiplier = (multiplier * k_hash_base_multiplier) % k_hash_modulo;
    }

    format!("{:04}", hash.abs())
}

pub fn gen_random(size: usize) -> Vec<u8> {
    let mut data = vec![0; size];
    rand::rng().fill_bytes(&mut data);

    data
}

pub fn get_download_dir() -> PathBuf {
    let cdown = CUSTOM_DOWNLOAD.read();
    match cdown {
        Ok(mg) => {
            if mg.is_some() {
                return mg.as_ref().unwrap().to_path_buf();
            }
        }
        Err(_) => {
            // TODO
        }
    }

    if let Some(user_dirs) = directories::UserDirs::new() {
        if let Some(dd) = user_dirs.download_dir() {
            return dd.to_path_buf();
        }

        return user_dirs.home_dir().to_path_buf();
    }

    Path::new("/").to_path_buf()
}

/// First non-loopback IPv4 address of this host (used to advertise our Wi-Fi-LAN
/// endpoint in a bandwidth-upgrade). Prefers private LAN ranges when several exist.
pub fn local_ipv4() -> Option<[u8; 4]> {
    let addrs = get_if_addrs().ok()?;
    let mut fallback: Option<[u8; 4]> = None;
    for ia in addrs {
        if let std::net::IpAddr::V4(v4) = ia.ip() {
            if v4.is_loopback() || v4.is_link_local() {
                continue;
            }
            if v4.is_private() {
                return Some(v4.octets());
            }
            fallback.get_or_insert(v4.octets());
        }
    }
    fallback
}

/// Whether `remote` falls inside the subnet of any of our non-loopback IPv4
/// interfaces — i.e. whether a peer at that address is reachable over the
/// local network (used to pick the bandwidth-upgrade path).
pub fn same_subnet(remote: [u8; 4]) -> bool {
    let Ok(addrs) = get_if_addrs() else {
        return false;
    };
    let r = u32::from(Ipv4Addr::from(remote));
    for ia in addrs {
        if let IfAddr::V4(v4) = &ia.addr {
            if v4.ip.is_loopback() || v4.ip.is_link_local() {
                continue;
            }
            let ip = u32::from(v4.ip);
            let mask = u32::from(v4.netmask);
            if mask != 0 && (ip & mask) == (r & mask) {
                return true;
            }
        }
    }
    false
}

pub fn is_not_self_ip(ip_address: &Ipv4Addr) -> bool {
    if let Ok(if_addrs) = get_if_addrs() {
        for if_addr in if_addrs {
            if if_addr.ip() == *ip_address {
                return false;
            }
        }
    }

    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn p256_generator_and_signed_coordinates_decode_but_invalid_peer_points_never_panic() {
        use crate::securemessage::{EcP256PublicKey, GenericPublicKey};
        // NIST P-256 generator coordinates, independently specified by the curve.
        let x = hex::decode("6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296")
            .unwrap();
        let y = hex::decode("4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5")
            .unwrap();
        let make = |x, y| GenericPublicKey {
            r#type: 1,
            ec_p256_public_key: Some(EcP256PublicKey { x, y }),
            ..Default::default()
        };
        let expected = decode_p256_public_key(make(x.clone(), y.clone())).unwrap();
        let mut signed = vec![0];
        signed.extend_from_slice(&x);
        assert_eq!(
            decode_p256_public_key(make(signed, y.clone())).unwrap(),
            expected
        );
        for (x, y) in [
            (vec![0; 32], vec![0; 32]),
            (vec![1; 33], y.clone()),
            (vec![0; 34], y.clone()),
            (Vec::new(), y),
        ] {
            assert!(decode_p256_public_key(make(x, y)).is_err());
        }
        assert!(
            decode_p256_public_key(GenericPublicKey {
                r#type: 2,
                ..Default::default()
            })
            .is_err()
        );
    }

    #[test]
    fn test_gen_and_parse_mdns_info() {
        let device_name = "a_device_name";
        let device_type = DeviceType::Laptop;

        dbg!(&device_type);
        dbg!(device_type.clone() as u8);

        let info = gen_mdns_endpoint_info(device_type.clone() as u8, device_name);
        let parse_info = parse_mdns_endpoint_info(&info).unwrap();

        assert_eq!(parse_info.1, device_name);
        assert_eq!(parse_info.0, device_type);
    }

    #[test]
    fn anonymous_and_empty_android_advertisements_are_accepted_but_truncated_names_are_rejected() {
        let mut prefix = vec![0; 17];
        prefix[0] = 2;
        assert_eq!(
            parse_mdns_endpoint_info(&URL_SAFE_NO_PAD.encode(&prefix)).unwrap(),
            (DeviceType::Phone, String::new())
        );
        prefix.push(0);
        assert_eq!(
            parse_mdns_endpoint_info(&URL_SAFE_NO_PAD.encode(&prefix))
                .unwrap()
                .1,
            ""
        );
        prefix[17] = 4;
        assert!(parse_mdns_endpoint_info(&URL_SAFE_NO_PAD.encode(&prefix)).is_err());
        assert!(parse_mdns_endpoint_info(&URL_SAFE_NO_PAD.encode(&prefix[..16])).is_err());
    }

    #[test]
    fn google_reference_name_flag_versions_and_tlv_lengths() {
        // Reference: google/nearby@e71e92b sharing/advertisement.cc.
        // Source-based fixtures, not an executed Google/Android peer test.
        let mut bytes = vec![0; 17];
        bytes[0] = 0x32; // v1, no name, phone
        bytes.extend_from_slice(&[0x7f, 2, 0xaa, 0xbb]);
        let parsed = parse_mdns_endpoint_info(&URL_SAFE_NO_PAD.encode(&bytes)).unwrap();
        assert_eq!(parsed, (DeviceType::Phone, String::new()));
        bytes[18] = 3;
        assert!(parse_mdns_endpoint_info(&URL_SAFE_NO_PAD.encode(&bytes)).is_err());
        bytes.truncate(17);
        bytes[0] = 0x52; // unsupported v2
        assert!(parse_mdns_endpoint_info(&URL_SAFE_NO_PAD.encode(&bytes)).is_err());
        bytes[0] = 0x22;
        bytes.extend_from_slice(&[3, b'P', b'i', b'x', 0x7f, 1, 0]);
        assert_eq!(
            parse_mdns_endpoint_info(&URL_SAFE_NO_PAD.encode(&bytes))
                .unwrap()
                .1,
            "Pix"
        );
    }

    #[test]
    fn emitted_names_never_wrap_length_or_split_utf8() {
        let name = "🙂".repeat(100);
        let encoded = gen_mdns_endpoint_info(1, &name);
        let (_, decoded) = parse_mdns_endpoint_info(&encoded).unwrap();
        assert_eq!(decoded, "🙂".repeat(63));
    }
}
