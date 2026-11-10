// Airdrop Linux modifications, 2026-11-10. GPL-3.0-only.
use anyhow::{Result, bail};
use std::collections::HashMap;

const MAX_BYTES: usize = 5 * 1024 * 1024;
const MAX_PAYLOADS: usize = 8;

#[derive(Debug, Default)]
pub(crate) struct BytesPayloads(HashMap<i64, (usize, Vec<u8>)>);

impl BytesPayloads {
    /// Validate before allocation, freeze each declaration and free completed
    /// setup payloads. Both transfer roles use exactly the same resource limits.
    pub(crate) fn push(
        &mut self,
        id: i64,
        total: i64,
        offset: i64,
        body: &[u8],
        last: bool,
    ) -> Result<Option<Vec<u8>>> {
        let total = usize::try_from(total).ok().filter(|n| *n <= MAX_BYTES);
        let offset = usize::try_from(offset).ok();
        let (Some(total), Some(offset)) = (total, offset) else {
            bail!("Invalid payload dimensions");
        };
        let existing = self.0.get(&id);
        if existing.is_none() && self.0.len() >= MAX_PAYLOADS {
            bail!("Too many setup payloads");
        }
        let length = existing.map_or(0, |(_, bytes)| bytes.len());
        if existing.is_some_and(|(declared, _)| *declared != total)
            || offset != length
            || body.len() > total.saturating_sub(length)
        {
            bail!("Payload declaration or offset changed");
        }
        let buffered: usize = self.0.values().map(|(_, bytes)| bytes.len()).sum();
        if body.len() > MAX_BYTES.saturating_sub(buffered) {
            bail!("Buffered payload limit exceeded");
        }
        if last && length + body.len() != total {
            bail!("Truncated setup payload");
        }
        let (_, bytes) = self.0.entry(id).or_insert_with(|| (total, Vec::new()));
        bytes.extend_from_slice(body);
        Ok(if last {
            self.0.remove(&id).map(|(_, bytes)| bytes)
        } else {
            None
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_dimensions_offsets_and_final_size_before_allocation() {
        let mut p = BytesPayloads::default();
        assert!(p.push(1, -1, 0, &[], false).is_err());
        assert!(p.push(1, i64::MAX, 0, &[], false).is_err());
        assert!(p.push(1, 0, 0, &[1], false).is_err());
        assert!(p.push(1, 2, -1, &[], false).is_err());
        assert!(p.push(1, 2, 0, &[1], true).is_err());
        assert!(p.push(1, 2, 0, &[1], false).unwrap().is_none());
        assert!(p.push(1, 3, 1, &[2], false).is_err());
        assert!(p.push(1, 2, 0, &[2], false).is_err());
        assert_eq!(p.push(1, 2, 1, &[2], true).unwrap(), Some(vec![1, 2]));
        assert!(p.0.is_empty());
        assert_eq!(p.push(2, 0, 0, &[], true).unwrap(), Some(vec![]));
    }
    #[test]
    fn bounds_payload_count_and_aggregate_bytes_and_releases_completed_payloads() {
        let mut p = BytesPayloads::default();
        for id in 0..MAX_PAYLOADS as i64 {
            p.push(id, 1, 0, &[], false).unwrap();
        }
        assert!(p.push(99, 1, 0, &[], false).is_err());
        p.push(0, 1, 0, &[1], true).unwrap();
        p.push(99, MAX_BYTES as i64, 0, &vec![0; MAX_BYTES], false)
            .unwrap();
        assert!(p.push(1, 1, 0, &[1], false).is_err());
        p.push(99, MAX_BYTES as i64, MAX_BYTES as i64, &[], true)
            .unwrap();
        assert!(p.push(1, 1, 0, &[1], true).is_ok());
    }
}
