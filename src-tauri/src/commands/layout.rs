use crate::services::user_message_history_service::{
    UserMessageHistoryService, UserMessageSummary,
};

/// Get user message history from Rust LRU cache.
/// Returns compact summaries — see `UserMessageSummary`.
#[tauri::command]
pub async fn get_user_message_history(user_id: String) -> Result<Vec<UserMessageSummary>, String> {
    let service = UserMessageHistoryService::global();
    Ok(service.get_history(&user_id).await)
}

#[tauri::command]
pub async fn get_user_message_history_limited(
    user_id: String,
    limit: usize,
) -> Result<Vec<UserMessageSummary>, String> {
    let service = UserMessageHistoryService::global();
    Ok(service.get_history_limited(&user_id, limit).await)
}

/// Clear user message history (e.g., when switching channels)
#[tauri::command]
pub async fn clear_user_message_history() -> Result<(), String> {
    let service = UserMessageHistoryService::global();
    service.clear_all().await;
    Ok(())
}

#[tauri::command]
pub async fn get_user_history_count() -> Result<usize, String> {
    let service = UserMessageHistoryService::global();
    Ok(service.user_count().await)
}
