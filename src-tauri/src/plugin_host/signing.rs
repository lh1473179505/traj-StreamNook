//! Artifact and index verification: SHA-256 hashes and minisign-compatible
//! ed25519 detached signatures. Scheme frozen in docs/plugins/SIGNING.md.

use anyhow::{anyhow, bail, Result};
use minisign_verify::{PublicKey, Signature};
use sha2::{Digest, Sha256};

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex_encode(&hasher.finalize())
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Verifies a minisign detached signature (the text content of a `.minisig`
/// file) over `data` against a base64 minisign public key.
pub fn verify_minisign(data: &[u8], signature_text: &str, public_key_b64: &str) -> Result<()> {
    let pk = PublicKey::from_base64(public_key_b64.trim())
        .map_err(|e| anyhow!("invalid minisign public key: {e}"))?;
    let sig = Signature::decode(signature_text)
        .map_err(|e| anyhow!("invalid minisign signature: {e}"))?;
    pk.verify(data, &sig, false)
        .map_err(|e| anyhow!("signature verification failed: {e}"))?;
    Ok(())
}

/// Short fingerprint of a minisign public key for display in consent dialogs:
/// the first 16 hex chars of the SHA-256 of the key string, grouped in fours.
pub fn key_fingerprint(public_key_b64: &str) -> String {
    let hex = sha256_hex(public_key_b64.trim().as_bytes());
    let short: String = hex.chars().take(16).collect();
    short
        .as_bytes()
        .chunks(4)
        .map(|c| std::str::from_utf8(c).unwrap_or_default())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Constant-shape hash comparison helper with a clear error.
pub fn check_sha256(data: &[u8], expected_hex: &str) -> Result<()> {
    let actual = sha256_hex(data);
    if !actual.eq_ignore_ascii_case(expected_hex.trim()) {
        bail!("artifact hash mismatch (expected {expected_hex}, got {actual})");
    }
    Ok(())
}
