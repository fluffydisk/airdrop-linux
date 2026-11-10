// Airdrop Linux modifications; distributed with this component under GPLv3.
use anyhow::{Result, anyhow};
pub const MAX_FILES: usize = 100;
pub const MAX_BYTES: u64 = 64 * 1024 * 1024 * 1024;

pub fn safe_name(name: &str) -> Result<&str> {
    if name.is_empty()
        || name.len() > 240
        || name.starts_with('.')
        || name == "ui"
        || name.contains(['/', '\\'])
        || name.chars().any(char::is_control)
        || std::path::Path::new(name).components().count() != 1
    {
        return Err(anyhow!("Invalid file name"));
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_untrusted_paths_and_preserves_unicode_names() {
        for name in [
            "",
            ".",
            "..",
            ".private",
            "ui",
            "../escape",
            "/absolute",
            "a/b",
            "a\\b",
            "bad\0name",
            "bad\nname",
        ] {
            assert!(safe_name(name).is_err(), "{name:?}");
        }
        assert!(safe_name(&"x".repeat(256)).is_err());
        assert_eq!(safe_name("photo ü.txt").unwrap(), "photo ü.txt");
    }
}
