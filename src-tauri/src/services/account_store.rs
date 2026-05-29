//! Multi-account registry. Phase 1 foundation for the "send as" picker and,
//! later, multi-account actions (mining, whispers, mod tools).
//!
//! Design constraints (deliberate, see Brain `projects/StreamNook.md` ->
//! "Multi-account support"):
//!
//!   - The PRIMARY account (the one you watch / stream as) keeps its exact
//!     existing storage: the obfuscated `.twitch_token` file, the main cookie
//!     jar, and the legacy keyring entry (`streamnook_twitch_token` / `user`).
//!     `TwitchService::get_token()` remains the unchanged hot path for it. This
//!     module never reads or writes the primary's token storage; it only records
//!     the primary's *identity* so the account list has a complete view.
//!
//!   - SECONDARY ("action") accounts store their OAuth token in the OS keyring
//!     keyed by Twitch user id, plus an obfuscated file backup. They NEVER touch
//!     the cookie jar: the cookie jar is the single web session, which belongs
//!     to the primary alone.
//!
//!   - Phase 1 ships no UI. It establishes the data model, persistence, a
//!     refresh-aware per-account token accessor, and a cheap startup reconcile
//!     that records the current login as the primary. Add / remove / set-primary
//!     flows land in later phases.

use anyhow::Result;
use keyring::Entry;
use log::{debug, warn};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::services::twitch_service::{get_app_data_dir, StorableToken, TwitchService};

/// Plain-JSON registry of every known account (primary + secondaries). The
/// metadata here is not secret (login, display name, avatar); the actual tokens
/// live in the keyring / obfuscated per-account files.
const ACCOUNTS_FILE_NAME: &str = "accounts.json";

/// Keyring service name for SECONDARY account tokens. Deliberately distinct from
/// the primary's legacy `streamnook_twitch_token` / `user` entry so the two can
/// never collide. The keyring username is the account's Twitch user id.
const ACCOUNT_KEYRING_SERVICE: &str = "streamnook_twitch_account";

/// Matches the XOR obfuscation key TwitchService uses for the primary token file,
/// so secondary token files are stored with the same (light) at-rest scheme.
const TOKEN_OBFUSCATION_KEY: &[u8] = b"StreamNookTokenKey2024";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAccount {
    pub user_id: String,
    pub login: String,
    pub display_name: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub is_primary: bool,
    /// Unix seconds when the account was linked. 0 for the migrated primary.
    #[serde(default)]
    pub added_at: i64,
}

pub struct AccountStore;

impl AccountStore {
    // ----- registry (metadata) persistence -------------------------------

    fn accounts_file_path() -> Result<PathBuf> {
        let mut path = get_app_data_dir()?;
        if !path.exists() {
            fs::create_dir_all(&path)?;
        }
        path.push(ACCOUNTS_FILE_NAME);
        Ok(path)
    }

    /// Every known account, primary first. Empty if nothing has been recorded
    /// yet (e.g. a brand-new install, or before the first startup reconcile).
    pub fn list() -> Vec<StoredAccount> {
        let path = match Self::accounts_file_path() {
            Ok(p) => p,
            Err(_) => return Vec::new(),
        };
        if !path.exists() {
            return Vec::new();
        }
        match fs::read_to_string(&path).map(|s| serde_json::from_str::<Vec<StoredAccount>>(&s)) {
            Ok(Ok(mut accounts)) => {
                accounts.sort_by(|a, b| b.is_primary.cmp(&a.is_primary));
                accounts
            }
            _ => {
                warn!("[accounts] registry unreadable or malformed; treating as empty");
                Vec::new()
            }
        }
    }

    fn save(accounts: &[StoredAccount]) -> Result<()> {
        let path = Self::accounts_file_path()?;
        let json = serde_json::to_string_pretty(accounts)?;
        fs::write(&path, json)?;
        Ok(())
    }

    /// Number of distinct accounts. The frontend uses this to decide whether to
    /// render the "send as" picker (only shown when there are 2 or more).
    pub fn count() -> usize {
        Self::list().len()
    }

    pub fn get(user_id: &str) -> Option<StoredAccount> {
        Self::list().into_iter().find(|a| a.user_id == user_id)
    }

    pub fn primary() -> Option<StoredAccount> {
        Self::list().into_iter().find(|a| a.is_primary)
    }

    // ----- secondary token storage (keyring + obfuscated file) -----------

    fn xor(data: &[u8]) -> Vec<u8> {
        data.iter()
            .enumerate()
            .map(|(i, b)| b ^ TOKEN_OBFUSCATION_KEY[i % TOKEN_OBFUSCATION_KEY.len()])
            .collect()
    }

    fn secondary_token_file_path(user_id: &str) -> Result<PathBuf> {
        let mut path = get_app_data_dir()?;
        if !path.exists() {
            fs::create_dir_all(&path)?;
        }
        path.push(format!(".twitch_account_{}", user_id));
        Ok(path)
    }

    fn store_secondary_token(user_id: &str, token: &StorableToken) -> Result<()> {
        let json = serde_json::to_string(token)?;

        // File (primary store for secondaries), obfuscated to match the primary scheme.
        let path = Self::secondary_token_file_path(user_id)?;
        fs::write(&path, Self::xor(json.as_bytes()))?;

        // Keyring (backup), keyed by user id. Best-effort, like the primary path.
        if let Ok(entry) = Entry::new(ACCOUNT_KEYRING_SERVICE, user_id) {
            let _ = entry.set_password(&json);
        }
        Ok(())
    }

    fn load_secondary_token(user_id: &str) -> Result<StorableToken> {
        // File first.
        if let Ok(path) = Self::secondary_token_file_path(user_id) {
            if path.exists() {
                if let Ok(bytes) = fs::read(&path) {
                    let decoded = Self::xor(&bytes);
                    if let Ok(s) = String::from_utf8(decoded) {
                        if let Ok(token) = serde_json::from_str::<StorableToken>(&s) {
                            return Ok(token);
                        }
                    }
                }
            }
        }
        // Keyring fallback.
        if let Ok(entry) = Entry::new(ACCOUNT_KEYRING_SERVICE, user_id) {
            if let Ok(pwd) = entry.get_password() {
                if let Ok(token) = serde_json::from_str::<StorableToken>(&pwd) {
                    return Ok(token);
                }
            }
        }
        Err(anyhow::anyhow!(
            "No stored token for secondary account {}",
            user_id
        ))
    }

    fn delete_secondary_token(user_id: &str) -> Result<()> {
        if let Ok(path) = Self::secondary_token_file_path(user_id) {
            if path.exists() {
                let _ = fs::remove_file(&path);
            }
        }
        if let Ok(entry) = Entry::new(ACCOUNT_KEYRING_SERVICE, user_id) {
            let _ = entry.delete_credential();
        }
        Ok(())
    }

    // ----- public accessors / mutators -----------------------------------

    /// Resolve a usable access token for ANY account, refreshing if it is within
    /// five minutes of expiry. The primary delegates to the unchanged
    /// `TwitchService::get_token()`; secondaries use their own stored token and
    /// refresh through the shared `TwitchService::refresh_token`.
    pub async fn get_token_for(user_id: &str) -> Result<String> {
        if let Some(primary) = Self::primary() {
            if primary.user_id == user_id {
                return TwitchService::get_token().await;
            }
        }

        let mut token = Self::load_secondary_token(user_id)?;
        let buffer = 300; // 5-minute pre-expiry refresh window, matching the primary.
        if token.expires_at > 0 && chrono::Utc::now().timestamp() >= token.expires_at - buffer {
            if token.refresh_token.is_empty() {
                return Err(anyhow::anyhow!(
                    "Account {} token expired and has no refresh token; re-link it.",
                    user_id
                ));
            }
            let refreshed = TwitchService::refresh_token(&token.refresh_token).await?;
            Self::store_secondary_token(user_id, &refreshed)?;
            token = refreshed;
        }
        Ok(token.access_token)
    }

    /// Link a new secondary account from a freshly obtained token. Identifies the
    /// account from the token itself, stores the token, and upserts it into the
    /// registry as a non-primary account. Returns the stored metadata.
    /// (Phase 2's add-account flow calls this.)
    pub async fn add_secondary(token: StorableToken) -> Result<StoredAccount> {
        let info = TwitchService::get_user_info_with_token(&token.access_token).await?;

        // Don't allow the primary to also be added as a secondary.
        if let Some(primary) = Self::primary() {
            if primary.user_id == info.id {
                return Err(anyhow::anyhow!(
                    "That account is already signed in as your primary."
                ));
            }
        }

        Self::store_secondary_token(&info.id, &token)?;

        let account = StoredAccount {
            user_id: info.id.clone(),
            login: info.login,
            display_name: info.display_name,
            avatar_url: info.profile_image_url,
            is_primary: false,
            added_at: chrono::Utc::now().timestamp(),
        };

        let mut accounts = Self::list();
        accounts.retain(|a| a.user_id != account.user_id);
        accounts.push(account.clone());
        Self::save(&accounts)?;
        debug!("[accounts] linked secondary account @{}", account.login);
        Ok(account)
    }

    /// Remove a secondary account (its token and registry entry). The primary is
    /// not removable here; that belongs to logout (Phase 4).
    pub fn remove_secondary(user_id: &str) -> Result<()> {
        if let Some(primary) = Self::primary() {
            if primary.user_id == user_id {
                return Err(anyhow::anyhow!("Cannot remove the primary account here."));
            }
        }
        Self::delete_secondary_token(user_id)?;
        let mut accounts = Self::list();
        accounts.retain(|a| a.user_id != user_id);
        Self::save(&accounts)?;
        Ok(())
    }

    /// Record the current login as the primary account in the registry. Cheap:
    /// when the registry already lists this user as primary it does no network
    /// work. Called on startup with the user id Twitch's validate endpoint
    /// already returned, so a re-login as a different account self-heals. Always
    /// best-effort: any failure is logged and swallowed so login is never broken.
    pub async fn reconcile_primary(validated_user_id: &str) {
        if let Some(p) = Self::primary() {
            if p.user_id == validated_user_id {
                return; // already correct, no work needed
            }
        }

        let info = match TwitchService::get_user_info().await {
            Ok(i) => i,
            Err(e) => {
                debug!("[accounts] could not record primary identity yet: {}", e);
                return;
            }
        };

        let mut accounts = Self::list();
        // If the new primary was previously linked as a secondary, clean up its
        // secondary token: the primary slot now owns this account's token.
        if accounts
            .iter()
            .any(|a| !a.is_primary && a.user_id == info.id)
        {
            let _ = Self::delete_secondary_token(&info.id);
        }
        // Drop the OLD primary entry entirely (its token lived in the primary
        // slot, not the secondary store, so it cannot become a usable secondary)
        // and any duplicate of the new primary id. Genuine secondaries own their
        // own tokens and are preserved untouched.
        accounts.retain(|a| !a.is_primary && a.user_id != info.id);
        accounts.insert(
            0,
            StoredAccount {
                user_id: info.id,
                login: info.login,
                display_name: info.display_name,
                avatar_url: info.profile_image_url,
                is_primary: true,
                added_at: 0,
            },
        );

        match Self::save(&accounts) {
            Ok(_) => debug!("[accounts] primary recorded in registry"),
            Err(e) => warn!("[accounts] failed to record primary: {}", e),
        }
    }
}
