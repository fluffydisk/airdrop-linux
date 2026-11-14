// GPL-3.0-only. Adapted from open-quickshare@fb9c8f9 core_lib/src/hdl/blea.rs.
use rand::RngCore;
use sha2::{Digest, Sha256};
fn murmur3_x64_128_low(data: &[u8]) -> u64 {
    const C1: u64 = 0x87c3_7b91_1142_53d5;
    const C2: u64 = 0x4cf5_ad43_2745_937f;
    let mut h1: u64 = 0;
    let mut h2: u64 = 0;

    let nblocks = data.len() / 16;
    for i in 0..nblocks {
        let b = i * 16;
        let mut k1 = u64::from_le_bytes(data[b..b + 8].try_into().unwrap());
        let mut k2 = u64::from_le_bytes(data[b + 8..b + 16].try_into().unwrap());

        k1 = k1.wrapping_mul(C1);
        k1 = k1.rotate_left(31);
        k1 = k1.wrapping_mul(C2);
        h1 ^= k1;
        h1 = h1.rotate_left(27);
        h1 = h1.wrapping_add(h2);
        h1 = h1.wrapping_mul(5).wrapping_add(0x52dce729);

        k2 = k2.wrapping_mul(C2);
        k2 = k2.rotate_left(33);
        k2 = k2.wrapping_mul(C1);
        h2 ^= k2;
        h2 = h2.rotate_left(31);
        h2 = h2.wrapping_add(h1);
        h2 = h2.wrapping_mul(5).wrapping_add(0x38495ab5);
    }

    // Tail -- mirrors the C switch's fall-through exactly.
    let t = &data[nblocks * 16..];
    let n = t.len();
    let mut k1: u64 = 0;
    let mut k2: u64 = 0;
    if n >= 15 {
        k2 ^= (t[14] as u64) << 48;
    }
    if n >= 14 {
        k2 ^= (t[13] as u64) << 40;
    }
    if n >= 13 {
        k2 ^= (t[12] as u64) << 32;
    }
    if n >= 12 {
        k2 ^= (t[11] as u64) << 24;
    }
    if n >= 11 {
        k2 ^= (t[10] as u64) << 16;
    }
    if n >= 10 {
        k2 ^= (t[9] as u64) << 8;
    }
    if n >= 9 {
        k2 ^= t[8] as u64;
        k2 = k2.wrapping_mul(C2);
        k2 = k2.rotate_left(33);
        k2 = k2.wrapping_mul(C1);
        h2 ^= k2;
    }
    if n >= 8 {
        k1 ^= (t[7] as u64) << 56;
    }
    if n >= 7 {
        k1 ^= (t[6] as u64) << 48;
    }
    if n >= 6 {
        k1 ^= (t[5] as u64) << 40;
    }
    if n >= 5 {
        k1 ^= (t[4] as u64) << 32;
    }
    if n >= 4 {
        k1 ^= (t[3] as u64) << 24;
    }
    if n >= 3 {
        k1 ^= (t[2] as u64) << 16;
    }
    if n >= 2 {
        k1 ^= (t[1] as u64) << 8;
    }
    if n >= 1 {
        k1 ^= t[0] as u64;
        k1 = k1.wrapping_mul(C1);
        k1 = k1.rotate_left(31);
        k1 = k1.wrapping_mul(C2);
        h1 ^= k1;
    }

    let len = data.len() as u64;
    h1 ^= len;
    h2 ^= len;
    h1 = h1.wrapping_add(h2);
    h2 = h2.wrapping_add(h1);
    h1 = fmix64(h1);
    h2 = fmix64(h2);
    h1 = h1.wrapping_add(h2);
    // h2 is the high 64 bits; unused.
    h1
}

fn fmix64(mut k: u64) -> u64 {
    k ^= k >> 33;
    k = k.wrapping_mul(0xff51_afd7_ed55_8ccd);
    k ^= k >> 33;
    k = k.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    k ^= k >> 33;
    k
}

/// The five bit positions an element sets/tests in an `nbits`-wide Bloom filter,
/// per Nearby's `BloomFilter::GetHashes` (5 reps over the murmur low-64 halves).
pub(super) fn bloom_positions(element: &[u8], nbits: usize) -> [usize; 5] {
    let low = murmur3_x64_128_low(element);
    let hash1 = (low & 0xffff_ffff) as u32 as i32;
    let hash2 = ((low >> 32) & 0xffff_ffff) as u32 as i32;
    let mut out = [0usize; 5];
    for (idx, slot) in out.iter_mut().enumerate() {
        let i = (idx + 1) as i32;
        let mut combined = hash1.wrapping_add(i.wrapping_mul(hash2));
        // Flip the bits of a negative value to guarantee non-negative, exactly
        // as the C++ does before the `% size` (which then can't go haywire).
        if combined < 0 {
            combined = !combined;
        }
        *slot = (combined as usize) % nbits;
    }
    out
}

/// Builds the 10-byte service-id Bloom filter over the given elements. Bit
/// position p lives at `bytes[p / 8] |= 1 << (p % 8)` (Nearby's serialisation).
fn build_bloom_filter(elements: &[&[u8]]) -> [u8; 10] {
    let nbits = 10 * 8;
    let mut bytes = [0u8; 10];
    for element in elements {
        for pos in bloom_positions(element, nbits) {
            bytes[pos / 8] |= 1 << (pos % 8);
        }
    }
    bytes
}

fn sha256_prefix(data: &[u8], n: usize) -> Vec<u8> {
    Sha256::digest(data)[..n].to_vec()
}

/// Nearby's chained advertisement hash: seed with SHA-256 of the dummy service
/// id, then fold in each slot's advertisement. Truncated to 4 bytes. This is
/// only ever used as a cache/dedup key by scanners -- it is never checked
/// against the bytes actually served from slot 0 -- so its exact value doesn't
/// gate discovery; we still compute it faithfully.
fn advertisement_hash(dummy_service_id: &[u8], slots: &[&[u8]]) -> Vec<u8> {
    let mut hash = sha256_prefix(dummy_service_id, 4);
    for slot in slots {
        let mut body = Vec::with_capacity(hash.len() + slot.len());
        body.extend_from_slice(&hash);
        body.extend_from_slice(slot);
        hash = sha256_prefix(&body, 4);
    }
    hash
}

/// Builds the 15-byte legacy-sized advertisement header that points a scanning
/// phone at the full advertisement served from GATT slot 0 (`full_advert`).
///
/// The Bloom filter must answer "yes" for `PossiblyContains("NearbySharing")`
/// on the phone, or it discards us as uninteresting before ever reading slot 0;
/// the random dummy service id only anonymises the filter and never has to be
/// recovered. Computed once and kept stable for the lifetime of the advertiser
/// so the header's hash stays a consistent dedup key.
pub(super) fn build_advertisement_header(
    full_advert: &[u8],
    extended_on_air: bool,
    l2cap_psm: Option<u16>,
) -> Vec<u8> {
    let mut dummy = [0u8; 128];
    rand::rng().fill_bytes(&mut dummy);

    let bloom = build_bloom_filter(&[&dummy, b"NearbySharing"]);
    let hash = advertisement_hash(&dummy, &[full_advert]);

    let mut header = Vec::with_capacity(1 + 10 + 4);
    let mut version_byte = 0x41;
    if extended_on_air {
        version_byte |= 0x10;
    }
    header.push(version_byte);
    header.extend_from_slice(&bloom);
    header.extend_from_slice(&hash);
    if let Some(psm) = l2cap_psm {
        header.extend_from_slice(&psm.to_be_bytes());
    }
    header
}
