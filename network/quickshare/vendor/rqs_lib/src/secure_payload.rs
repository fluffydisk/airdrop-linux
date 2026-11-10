// GPL-3.0-only. Authenticate before decoding or decrypting peer-controlled data.
use anyhow::{Result, bail};
use hmac::{Hmac, Mac};
use libaes::Cipher;
use prost::Message;
use sha2::Sha256;

use crate::securemessage::{EncScheme, HeaderAndBody, SecureMessage, SigScheme};

fn verify_mac(key: &[u8], body: &[u8], signature: &[u8]) -> Result<()> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key)?;
    mac.update(body);
    mac.verify_slice(signature)?;
    Ok(())
}

pub(crate) fn decrypt(message: &SecureMessage, mac_key: &[u8], key: &[u8]) -> Result<Vec<u8>> {
    verify_mac(mac_key, &message.header_and_body, &message.signature)?;
    let body = HeaderAndBody::decode(message.header_and_body.as_slice())?;
    if body.header.signature_scheme != SigScheme::HmacSha256 as i32
        || body.header.encryption_scheme != EncScheme::Aes256Cbc as i32
        || body.header.associated_data_length() != 0
    {
        bail!("Unsupported secure message scheme");
    }
    let plaintext = decrypt_cbc(key, body.header.iv(), &body.body)?;
    if plaintext.is_empty() {
        bail!("Empty secure payload");
    }
    Ok(plaintext)
}

fn decrypt_cbc(key: &[u8], iv: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>> {
    let key: &[u8; 32] = key.try_into()?;
    if iv.len() != 16 || ciphertext.is_empty() || ciphertext.len() % 16 != 0 {
        bail!("Invalid CBC dimensions");
    }
    // libaes's automatic unpadding checks only the final byte. Validate every
    // PKCS#7 padding byte explicitly, after authentication, before protobuf use.
    let mut cipher = Cipher::new_256(key);
    cipher.set_auto_padding(false);
    let mut plaintext = cipher.cbc_decrypt(iv, ciphertext);
    let padding = *plaintext.last().unwrap() as usize;
    if !(1..=16).contains(&padding)
        || !plaintext[plaintext.len() - padding..]
            .iter()
            .all(|b| *b as usize == padding)
    {
        bail!("Invalid CBC padding");
    }
    plaintext.truncate(plaintext.len() - padding);
    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::securemessage::Header;

    #[test]
    fn rfc4231_hmac_vector_and_tampering() {
        // RFC 4231, section 4.2, test case 1 (independent published fixture).
        let key = [0x0b; 20];
        let tag = hex::decode("b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7")
            .unwrap();
        verify_mac(&key, b"Hi There", &tag).unwrap();
        assert!(verify_mac(&key, b"Hi there", &tag).is_err());
        assert!(verify_mac(&key, b"Hi There", &tag[..31]).is_err());
        assert!(verify_mac(&key, b"Hi There", &[0; 32]).is_err());
    }

    #[test]
    fn nist_aes256_cbc_vector_with_explicit_pkcs7() {
        // NIST SP 800-38A F.2.5 first block (independent published fixture).
        let key = hex::decode("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4")
            .unwrap();
        let first = hex::decode("f58c4c04d6e5f1ba779eabfb5f7bfbd6").unwrap();
        let iv = hex::decode("000102030405060708090a0b0c0d0e0f").unwrap();
        let mut cipher = Cipher::new_256(key.as_slice().try_into().unwrap());
        cipher.set_auto_padding(false);
        assert_eq!(
            cipher.cbc_decrypt(&iv, &first),
            hex::decode("6bc1bee22e409f96e93d7e117393172a").unwrap()
        );
        // OpenSSL-generated PKCS#7 fixture for the same NIST plaintext/key/IV.
        let ciphertext =
            hex::decode("f58c4c04d6e5f1ba779eabfb5f7bfbd6485a5c81519cf378fa36d42b8547edc0")
                .unwrap();
        assert_eq!(
            decrypt_cbc(&key, &iv, &ciphertext).unwrap(),
            hex::decode("6bc1bee22e409f96e93d7e117393172a").unwrap()
        );
        assert!(decrypt_cbc(&key, &iv[..15], &ciphertext).is_err());
        assert!(decrypt_cbc(&key, &iv, &ciphertext[..31]).is_err());
        let mut broken = ciphertext.clone();
        broken[0] ^= 1;
        assert!(decrypt_cbc(&key, &iv, &broken).is_err());
    }

    #[test]
    fn invalid_mac_is_rejected_before_protobuf_and_valid_mac_cannot_allow_a_short_iv() {
        let mut message = SecureMessage {
            header_and_body: vec![0xff],
            signature: vec![0; 32],
        };
        assert!(decrypt(&message, &[0; 32], &[0; 32]).is_err());
        let body = HeaderAndBody {
            header: Header {
                signature_scheme: 1,
                encryption_scheme: 2,
                iv: Some(vec![0; 15]),
                ..Default::default()
            },
            body: vec![0; 16],
        };
        message.header_and_body = body.encode_to_vec();
        let mut mac = Hmac::<Sha256>::new_from_slice(&[0; 32]).unwrap();
        mac.update(&message.header_and_body);
        message.signature = mac.finalize().into_bytes().to_vec();
        assert!(decrypt(&message, &[0; 32], &[0; 32]).is_err());
    }
}
