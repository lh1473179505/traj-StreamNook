use crate::services::mod_log_storage_service::ModLogStorageService;
use tauri::AppHandle;

/// Load a channel's persisted mod-log entries (oldest first).
#[tauri::command]
pub async fn load_mod_logs(
    app_handle: AppHandle,
    channel: String,
) -> Result<Vec<serde_json::Value>, String> {
    Ok(ModLogStorageService::load_channel(&app_handle, &channel))
}

/// Append (or upgrade, by id) one mod-log entry for a channel.
#[tauri::command]
pub async fn append_mod_log(
    app_handle: AppHandle,
    channel: String,
    entry: serde_json::Value,
) -> Result<(), String> {
    ModLogStorageService::append(&app_handle, &channel, entry)
}

/// Clear a channel's persisted mod-log entries.
#[tauri::command]
pub async fn clear_mod_logs(app_handle: AppHandle, channel: String) -> Result<(), String> {
    ModLogStorageService::clear_channel(&app_handle, &channel)
}
