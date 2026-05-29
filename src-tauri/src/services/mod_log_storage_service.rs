// Per-channel moderation-log persistence.
//
// Mirrors whisper_storage_service: a single JSON file in the app data dir, keyed
// by lowercase channel login -> a capped list of mod-log entries. Entries are
// stored as opaque JSON values so this layer never has to track the frontend's
// ModLogEvent shape. The point is durability + bounded RAM: the live UI keeps
// only the channels you're currently viewing in memory, and reloads a channel's
// recent history from here when you open it again, instead of holding every
// moderation event for the whole session.

use log::debug;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const MOD_LOGS_FILE: &str = "mod_logs.json";
// Keep at most this many entries per channel on disk. Mod actions are
// infrequent, so this is plenty of history without unbounded growth.
const MAX_PER_CHANNEL: usize = 500;

#[derive(Debug, Serialize, Deserialize, Default)]
pub struct ModLogStorage {
    /// lowercase channel login -> chronological list of entries (oldest first)
    pub channels: HashMap<String, Vec<serde_json::Value>>,
    pub version: i32,
}

pub struct ModLogStorageService;

impl ModLogStorageService {
    fn get_storage_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data directory: {}", e))?;
        if !app_data_dir.exists() {
            fs::create_dir_all(&app_data_dir)
                .map_err(|e| format!("Failed to create app data directory: {}", e))?;
        }
        Ok(app_data_dir.join(MOD_LOGS_FILE))
    }

    fn load_all(app_handle: &AppHandle) -> ModLogStorage {
        let path = match Self::get_storage_path(app_handle) {
            Ok(p) => p,
            Err(_) => return ModLogStorage::default(),
        };
        if !path.exists() {
            return ModLogStorage::default();
        }
        match fs::read_to_string(&path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
            Err(_) => ModLogStorage::default(),
        }
    }

    fn save_all(app_handle: &AppHandle, storage: &ModLogStorage) -> Result<(), String> {
        let path = Self::get_storage_path(app_handle)?;
        let json = serde_json::to_string(storage)
            .map_err(|e| format!("Failed to serialize mod logs: {}", e))?;
        fs::write(&path, json).map_err(|e| format!("Failed to write mod logs file: {}", e))
    }

    /// Load one channel's persisted entries (oldest first). Empty if none.
    pub fn load_channel(app_handle: &AppHandle, channel: &str) -> Vec<serde_json::Value> {
        let key = channel.to_lowercase();
        Self::load_all(app_handle)
            .channels
            .remove(&key)
            .unwrap_or_default()
    }

    /// Append one entry to a channel, de-duped by its `id`, capped to
    /// MAX_PER_CHANNEL. If an entry with the same `id` already exists it is
    /// REPLACED in place (so an EventSub upgrade of an IRC entry persists too).
    pub fn append(
        app_handle: &AppHandle,
        channel: &str,
        entry: serde_json::Value,
    ) -> Result<(), String> {
        let key = channel.to_lowercase();
        if key.is_empty() {
            return Ok(());
        }
        let mut storage = Self::load_all(app_handle);
        let list = storage.channels.entry(key).or_default();

        let new_id = entry.get("id").and_then(|v| v.as_str()).map(String::from);
        if let Some(ref id) = new_id {
            if let Some(existing) = list
                .iter_mut()
                .find(|e| e.get("id").and_then(|v| v.as_str()) == Some(id.as_str()))
            {
                *existing = entry;
                return Self::save_all(app_handle, &storage);
            }
        }
        list.push(entry);
        if list.len() > MAX_PER_CHANNEL {
            let overflow = list.len() - MAX_PER_CHANNEL;
            list.drain(0..overflow);
        }
        Self::save_all(app_handle, &storage)
    }

    /// Clear one channel's persisted entries.
    pub fn clear_channel(app_handle: &AppHandle, channel: &str) -> Result<(), String> {
        let key = channel.to_lowercase();
        let mut storage = Self::load_all(app_handle);
        if storage.channels.remove(&key).is_some() {
            debug!("[ModLogStorage] cleared {}", key);
            return Self::save_all(app_handle, &storage);
        }
        Ok(())
    }
}
