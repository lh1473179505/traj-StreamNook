use crate::models::settings::AppState;
use crate::services::auth_proxy;
use crate::services::stream_server::StreamServer;
use crate::services::streamlink_manager::{StreamlinkDiagnostics, StreamlinkManager};
use crate::services::twitch_auth_service::AuthError;
use anyhow::Result;
use log::debug;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
pub struct StreamStartResult {
    /// Local proxy URL (or direct MP4 for clips) the player should load.
    pub url: String,
    /// The literal quality Streamlink actually served. May differ from the
    /// requested quality if the requested one wasn't offered for this stream
    /// (closest-match fallback). The frontend compares this against the user's
    /// saved preference to decide whether to notify.
    pub quality: String,
}

/// Check if the ttvlol plugin (twitch.py) actually exists
/// Uses the same 3-step resolution as get_plugins_directory:
/// 1. Custom folder plugins
/// 2. AppData plugins (for installed Streamlink)
/// 3. Bundled location
fn is_ttvlol_plugin_installed(custom_folder: Option<&str>) -> bool {
    // Step 1: Check custom folder plugins (for Portable versions)
    if let Some(folder) = custom_folder {
        if !folder.is_empty() {
            let custom_plugin = PathBuf::from(folder).join("plugins").join("twitch.py");
            if custom_plugin.exists() {
                debug!(
                    "[Streaming] ✅ Found ttvlol plugin in custom folder: {:?}",
                    custom_plugin
                );
                return true;
            } else {
                debug!(
                    "[Streaming] No ttvlol in custom folder {:?}, checking AppData...",
                    custom_plugin
                );
            }
        }
    }

    // Step 2: Check User AppData for installed Streamlink plugins
    // This is where the standard installer puts plugins: %APPDATA%/streamlink/plugins
    if let Some(config_dir) = dirs::config_dir() {
        let appdata_plugin = config_dir
            .join("streamlink")
            .join("plugins")
            .join("twitch.py");
        if appdata_plugin.exists() {
            debug!(
                "[Streaming] ✅ Found ttvlol plugin in AppData: {:?}",
                appdata_plugin
            );
            return true;
        } else {
            debug!(
                "[Streaming] No ttvlol in AppData {:?}, checking bundled...",
                appdata_plugin
            );
        }
    }

    // Step 3: Check bundled location (production)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let plugin_path = exe_dir.join("streamlink").join("plugins").join("twitch.py");
            debug!("[Streaming] Checking exe-relative path: {:?}", plugin_path);
            if plugin_path.exists() {
                debug!(
                    "[Streaming] ✅ Found ttvlol plugin at exe dir: {:?}",
                    plugin_path
                );
                return true;
            }
        }
    }

    // Development mode: check CWD and parent
    if let Ok(cwd) = std::env::current_dir() {
        debug!("[Streaming] CWD is: {:?}", cwd);

        // Check CWD (project root)
        let cwd_plugin = cwd.join("streamlink").join("plugins").join("twitch.py");
        if cwd_plugin.exists() {
            debug!(
                "[Streaming] ✅ Found ttvlol plugin at CWD: {:?}",
                cwd_plugin
            );
            return true;
        }

        // Check parent of CWD (for when CWD is src-tauri during dev)
        if let Some(parent) = cwd.parent() {
            let parent_plugin = parent.join("streamlink").join("plugins").join("twitch.py");
            debug!("[Streaming] Checking parent path: {:?}", parent_plugin);
            if parent_plugin.exists() {
                debug!(
                    "[Streaming] ✅ Found ttvlol plugin at parent: {:?}",
                    parent_plugin
                );
                return true;
            }
        }
    }

    debug!("[Streaming] ❌ ttvlol plugin NOT found in any location");
    false
}

#[tauri::command]
pub async fn start_stream(
    url: String,
    quality: String,
    state: State<'_, AppState>,
) -> Result<StreamStartResult, String> {
    debug!("[Streaming] start_stream called for URL: {}", url);

    // Get settings values and determine which args to use
    let (streamlink_args, streamlink_settings, custom_path) = {
        let settings = state.settings.lock().unwrap();
        let custom = settings.streamlink.custom_streamlink_path.clone();

        // Check if ttvlol plugin actually exists (not just enabled in settings)
        let ttvlol_installed = is_ttvlol_plugin_installed(custom.as_deref());
        debug!("[Streaming] ttvlol plugin installed: {}", ttvlol_installed);

        // Determine the proxy args to use:
        // 1. If use_proxy is enabled in streamlink settings, use proxy_playlist
        // 2. Fall back to the legacy streamlink_args field
        let proxy_args =
            if settings.streamlink.use_proxy && !settings.streamlink.proxy_playlist.is_empty() {
                debug!(
                    "[Streaming] Using streamlink.proxy_playlist: {}",
                    settings.streamlink.proxy_playlist
                );
                settings.streamlink.proxy_playlist.clone()
            } else if !settings.streamlink_args.is_empty() {
                debug!(
                    "[Streaming] Using legacy streamlink_args: {}",
                    settings.streamlink_args
                );
                settings.streamlink_args.clone()
            } else {
                String::new()
            };

        debug!(
            "[Streaming] Settings: ttvlol_enabled={}, use_proxy={}, proxy_args='{}', custom_path={:?}",
            settings.ttvlol_plugin.enabled, settings.streamlink.use_proxy, proxy_args, custom
        );

        // Identify if it's a VOD or Clip
        let is_vod_or_clip =
            url.contains("/videos/") || url.contains("/clip/") || url.contains("clips.twitch.tv");

        // Only use ttvlol args if BOTH enabled in settings AND the plugin file exists AND it's a live stream
        let args = if settings.ttvlol_plugin.enabled && ttvlol_installed && !is_vod_or_clip {
            // Use the ttvlol plugin args (proxy args)
            debug!("[Streaming] ✅ Using ttvlol plugin args: {}", proxy_args);
            proxy_args
        } else {
            // Don't use any special args if plugin is disabled, not installed, or URL is a VOD/Clip
            if is_vod_or_clip {
                debug!("[Streaming] ℹ️ Bypassing ttvlol proxy args for VOD/Clip");
            } else if settings.ttvlol_plugin.enabled && !ttvlol_installed {
                debug!(
                    "[Streaming] ⚠️ WARNING: ttvlol enabled but plugin not installed, skipping ttvlol args"
                );
            } else if !settings.ttvlol_plugin.enabled {
                debug!("[Streaming] ℹ️ ttvlol plugin is disabled in settings");
            }
            String::new()
        };
        (args, settings.streamlink.clone(), custom)
    };

    debug!("[Streaming] Final args to be used: '{}'", streamlink_args);

    // Splice mode: TTVLOL proxy on → spin up our local splice server and
    // replace streamlink's proxy URL with it. The server fetches both TTVLOL
    // (ad-free, 1080p ceiling) and authed (with 1440p) masters and merges
    // them. See services/auth_proxy.rs. Twitch auth is always-on now, so
    // splice mode is purely a function of whether the user wants the
    // ad-blocking proxy.
    let splice_active = streamlink_settings.use_proxy;
    let is_vod_or_clip =
        url.contains("/videos/") || url.contains("/clip/") || url.contains("clips.twitch.tv");
    let twitch_auth = state.twitch_auth.clone();

    let streamlink_args = if splice_active && !is_vod_or_clip && !streamlink_args.is_empty() {
        match auth_proxy::ensure_running(&streamlink_args, twitch_auth.clone()).await {
            Ok(port) => {
                let new_arg = auth_proxy::streamlink_proxy_arg(port);
                log::info!("[Streaming] splice mode active → {}", new_arg);
                new_arg
            }
            Err(e) => {
                log::warn!(
                    "[Streaming] splice server failed to start ({}); falling back to plain TTVLOL",
                    e
                );
                streamlink_args
            }
        }
    } else {
        streamlink_args
    };

    // Use the custom path if set, otherwise fallback to bundled/development paths
    let streamlink_path = StreamlinkManager::get_effective_path(custom_path.as_deref());

    // Direct auth-only mode (no proxy): pass the cookie to streamlink itself.
    // In splice mode the server handles auth internally, so streamlink doesn't
    // need the header (and the proxy URL would strip it anyway).
    let oauth_token = if !splice_active {
        match twitch_auth.get_token().await {
            Ok(t) => {
                log::info!(
                    "[Streaming] auth: WebView2 cookie acquired (len={})",
                    t.len()
                );
                Some(t)
            }
            Err(AuthError::NotLoggedIn) => {
                log::info!(
                    "[Streaming] auth: not logged in to twitch.tv in WebView; using anonymous"
                );
                None
            }
            Err(e) => {
                log::warn!("[Streaming] auth service error: {}; using anonymous", e);
                None
            }
        }
    } else {
        None
    };

    let (stream_url, actual_quality) = StreamlinkManager::get_stream_url_with_fallback(
        &url,
        &quality,
        &streamlink_path,
        &streamlink_args,
        &streamlink_settings,
        oauth_token.as_deref(),
    )
    .await
    .map_err(|e| e.to_string())?;

    // If it's an MP4 file (like Twitch Clips), we don't proxy it through the HLS server!
    let stream_url_lower = stream_url.to_lowercase();
    let url_without_query = if let Some(q_idx) = stream_url_lower.find('?') {
        &stream_url_lower[..q_idx]
    } else {
        &stream_url_lower
    };

    if url_without_query.ends_with(".mp4") {
        debug!(
            "[Streaming] Stream URL is an MP4 (likely a Clip), bypassing proxy: {}",
            stream_url
        );
        return Ok(StreamStartResult {
            url: stream_url,
            quality: actual_quality,
        });
    }

    // Start local HTTP server to proxy the stream
    let port = StreamServer::start_proxy_server(stream_url)
        .await
        .map_err(|e| e.to_string())?;

    Ok(StreamStartResult {
        url: format!(
            "http://localhost:{}/stream.m3u8?t={}",
            port,
            chrono::Utc::now().timestamp_millis()
        ),
        quality: actual_quality,
    })
}

#[tauri::command]
pub async fn stop_stream() -> Result<(), String> {
    StreamServer::stop().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_stream_qualities(
    url: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let (custom_path, enhanced_codecs) = {
        let settings = state.settings.lock().unwrap();
        (
            settings.streamlink.custom_streamlink_path.clone(),
            settings.streamlink.enhanced_codecs,
        )
    };
    let streamlink_path = StreamlinkManager::get_effective_path(custom_path.as_deref());

    // Twitch auth is always-on so the quality menu probe sees the same
    // expanded variant list start_stream can serve (1440p / 2160p tiers).
    let oauth_token = state.twitch_auth.get_token().await.ok();

    StreamlinkManager::get_qualities_authed(
        &url,
        &streamlink_path,
        oauth_token.as_deref(),
        enhanced_codecs,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn change_stream_quality(
    url: String,
    quality: String,
    state: State<'_, AppState>,
) -> Result<StreamStartResult, String> {
    // Don't stop the server - just update the stream URL
    // The server will keep running on the same port
    start_stream(url, quality, state).await
}

/// Get comprehensive streamlink diagnostics for debugging
/// This helps identify why streamlink might not be found on some systems
#[tauri::command]
pub async fn get_streamlink_diagnostics() -> Result<StreamlinkDiagnostics, String> {
    Ok(StreamlinkManager::get_diagnostics_with_version().await)
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct StreamlinkValidation {
    /// The full executable path the resolver landed on for the given input.
    pub resolved_path: String,
    /// Whether `resolved_path` points at a file on disk.
    pub exists: bool,
    /// `streamlink --version` stdout (e.g. "streamlink 7.5.0"). None on probe failure.
    pub version: Option<String>,
    /// Set when the path doesn't exist or `--version` failed.
    pub error: Option<String>,
}

/// Validate a streamlink installation by running --version against it.
/// Pass `path = None` to validate whatever the effective resolver would pick
/// (bundled / dev tree). Pass `path = Some(custom_folder_or_file)` to validate
/// a user-supplied selection, including paths that the smart resolver would
/// rewrite (folder pointing at the streamlink root, the bin dir, or the exe
/// directly are all accepted).
#[tauri::command]
pub async fn validate_streamlink_install(
    path: Option<String>,
) -> Result<StreamlinkValidation, String> {
    let resolved_path = StreamlinkManager::get_effective_path(path.as_deref());
    let exists = std::path::Path::new(&resolved_path).exists();

    if !exists {
        return Ok(StreamlinkValidation {
            resolved_path,
            exists: false,
            version: None,
            error: Some("No Streamlink executable found at this location.".to_string()),
        });
    }

    match tokio::process::Command::new(&resolved_path)
        .arg("--version")
        .output()
        .await
    {
        Ok(output) if output.status.success() => Ok(StreamlinkValidation {
            resolved_path,
            exists: true,
            version: Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
            error: None,
        }),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let msg = if stderr.is_empty() {
                "Streamlink found but --version failed with no output.".to_string()
            } else {
                stderr
            };
            Ok(StreamlinkValidation {
                resolved_path,
                exists: true,
                version: None,
                error: Some(msg),
            })
        }
        Err(e) => Ok(StreamlinkValidation {
            resolved_path,
            exists: true,
            version: None,
            error: Some(format!("Failed to execute Streamlink: {}", e)),
        }),
    }
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct DetectedStreamlinkInstall {
    /// Human-friendly source label, e.g. "Bundled with StreamNook" or "Program Files".
    pub label: String,
    /// Full path to the streamlinkw.exe (or streamlink.exe) found at this source.
    pub path: String,
    /// `--version` output if probing succeeded.
    pub version: Option<String>,
    /// True for the install that ships inside the StreamNook app folder.
    pub is_bundled: bool,
}

/// Scan well-known Windows locations for existing Streamlink installs so the
/// settings UI can offer them as one-click chips instead of asking the user to
/// hunt through the filesystem. Each candidate is probed with --version; entries
/// that don't respond are dropped.
#[tauri::command]
pub async fn detect_streamlink_installs() -> Result<Vec<DetectedStreamlinkInstall>, String> {
    use std::path::PathBuf;

    let mut candidates: Vec<(String, PathBuf, bool)> = Vec::new();

    // Bundled (whatever the resolver would pick with no custom path)
    let bundled = StreamlinkManager::get_effective_path(None);
    candidates.push((
        "Bundled with StreamNook".to_string(),
        PathBuf::from(bundled),
        true,
    ));

    // Standard installer (machine-wide)
    candidates.push((
        "Program Files".to_string(),
        PathBuf::from("C:\\Program Files\\Streamlink\\bin\\streamlinkw.exe"),
        false,
    ));

    // Standard installer (per-user) + winget default install
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        candidates.push((
            "User install".to_string(),
            PathBuf::from(&local_app_data)
                .join("Programs")
                .join("Streamlink")
                .join("bin")
                .join("streamlinkw.exe"),
            false,
        ));
    }

    // Scoop
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        candidates.push((
            "Scoop".to_string(),
            PathBuf::from(&user_profile)
                .join("scoop")
                .join("apps")
                .join("streamlink")
                .join("current")
                .join("bin")
                .join("streamlinkw.exe"),
            false,
        ));
    }

    // Chocolatey shim
    candidates.push((
        "Chocolatey".to_string(),
        PathBuf::from("C:\\ProgramData\\chocolatey\\bin\\streamlink.exe"),
        false,
    ));

    // pip user-site install
    if let Ok(app_data) = std::env::var("APPDATA") {
        candidates.push((
            "Python user-site".to_string(),
            PathBuf::from(&app_data)
                .join("Python")
                .join("Scripts")
                .join("streamlink.exe"),
            false,
        ));
    }

    let mut detected: Vec<DetectedStreamlinkInstall> = Vec::new();
    let mut seen_paths: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (label, path, is_bundled) in candidates {
        if !path.exists() {
            continue;
        }
        let path_str = path.to_string_lossy().to_string();
        // Dedup in case multiple labels resolve to the same install (e.g. when bundled lives in user_install path)
        if !seen_paths.insert(path_str.clone()) {
            continue;
        }
        let version = match tokio::process::Command::new(&path)
            .arg("--version")
            .output()
            .await
        {
            Ok(output) if output.status.success() => {
                Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
            }
            _ => None,
        };
        // Drop entries that don't respond to --version (probably not actually streamlink)
        if version.is_none() && !is_bundled {
            continue;
        }
        detected.push(DetectedStreamlinkInstall {
            label,
            path: path_str,
            version,
            is_bundled,
        });
    }

    Ok(detected)
}

/// Quick check if streamlink is available
/// Returns true if streamlink.exe is found at the expected location
/// Checks custom path from settings first, then bundled/dev paths
#[tauri::command]
pub fn is_streamlink_available(state: State<'_, AppState>) -> bool {
    // Get the custom path from settings if set
    let custom_path = {
        let settings = state.settings.lock().unwrap();
        settings.streamlink.custom_streamlink_path.clone()
    };

    // Use get_effective_path which checks custom -> bundled -> dev paths
    let effective_path = StreamlinkManager::get_effective_path(custom_path.as_deref());
    let path = std::path::Path::new(&effective_path);

    let available = path.exists();
    debug!(
        "[Streaming] is_streamlink_available check: path={:?}, exists={}",
        effective_path, available
    );
    available
}

#[tauri::command]
pub async fn register_active_channel(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let bg_service = state.background_service.lock().await;
    let ws_service_mutex = bg_service.websocket_service.clone();
    let ws_service = ws_service_mutex.lock().await;
    ws_service.register_active_channel(&channel_id).await;
    Ok(())
}

#[tauri::command]
pub async fn unregister_active_channel(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let bg_service = state.background_service.lock().await;
    let ws_service_mutex = bg_service.websocket_service.clone();
    let ws_service = ws_service_mutex.lock().await;
    ws_service.unregister_active_channel(&channel_id).await;
    Ok(())
}
