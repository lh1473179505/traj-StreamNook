//! Drops and Points Farmer — a StreamNook plugin.
//!
//! A separate program that StreamNook starts and talks to over JSON-RPC. It
//! runs background channel-points farming (and, in a later version, drops
//! mining) entirely in its own process, with its own networking, using a
//! Twitch credential the host hands over only after the user consents. The
//! core StreamNook binary contains none of this behavior.

mod mining;
mod protocol;
mod twitch;

use mining::{MiningSettings, PriorityMode, RecoveryMode};
use protocol::{read_loop, Host, Inbound};
use serde_json::{json, Value};
use std::collections::HashMap;
use twitch::{Channel, Cred};

/// Watch rotation, mirroring the former native farmer.
const MAX_CONCURRENT_DEFAULT: usize = 2;
const ROTATION_TICKS: u64 = 15; // re-pick the watch set every 15 minutes
const CLAIM_EVERY_TICKS: u64 = 5; // sweep bonus chests every 5 minutes

/// Parses a panel string_list value into trimmed, lowercased, non-empty entries.
fn string_list(arr: &[Value]) -> Vec<String> {
    arr.iter()
        .filter_map(|v| v.as_str())
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

struct Settings {
    active: bool,
    max_concurrent: usize,
    priority_logins: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            active: true,
            max_concurrent: MAX_CONCURRENT_DEFAULT,
            priority_logins: Vec::new(),
        }
    }
}

struct Farmer {
    host: Host,
    client: reqwest::Client,
    device_id: String,
    session_id: String,
    settings: Settings,
    live: Vec<Channel>,
    last_watched: HashMap<String, u64>,
    current_set: Vec<Channel>,
    tick_count: u64,
    cred: Option<Cred>,
    user_id: Option<String>,
    credential_denied: bool,
    miner: mining::Miner,
}

impl Farmer {
    fn new(host: Host) -> Self {
        Self {
            host,
            client: reqwest::Client::new(),
            device_id: uuid::Uuid::new_v4().simple().to_string(),
            session_id: uuid::Uuid::new_v4().simple().to_string(),
            settings: Settings::default(),
            live: Vec::new(),
            last_watched: HashMap::new(),
            current_set: Vec::new(),
            tick_count: 0,
            cred: None,
            user_id: None,
            credential_denied: false,
            miner: mining::Miner::new(),
        }
    }

    /// The host-rendered settings panel.
    fn panel_schema() -> Value {
        json!({
            "title": "Drops and Points Farmer",
            "sections": [
                {
                    "label": "Channel points",
                    "description": "Farms channel points on your followed live channels in the background. The channel you are actively watching already earns on its own.",
                    "fields": [
                        { "key": "active", "type": "toggle", "label": "Farming active", "description": "Pause without uninstalling.", "default": true },
                        { "key": "max_concurrent", "type": "number", "label": "Channels at once", "description": "Twitch credits points on up to two channels at a time.", "min": 1, "max": 2, "default": 2 },
                        { "key": "priority_channels", "type": "string_list", "label": "Priority channels", "description": "Logins to farm first, one per line. Others fill the remaining slots." }
                    ]
                },
                {
                    "label": "Drops mining",
                    "description": "Watches a stream that has an active drop campaign and claims each drop when it completes. A mined channel counts as one of the two watch slots.",
                    "fields": [
                        { "key": "mining_active", "type": "toggle", "label": "Mine drops", "default": false },
                        { "key": "priority_games", "type": "string_list", "label": "Priority games", "description": "Game names to mine first, one per line." },
                        { "key": "excluded_games", "type": "string_list", "label": "Excluded games", "description": "Game names to never mine, one per line." },
                        { "key": "priority_mode", "type": "select", "label": "Selection", "default": "PriorityOnly", "options": [
                            { "value": "PriorityOnly", "label": "Priority games only" },
                            { "value": "EndingSoonest", "label": "Ending soonest first" },
                            { "value": "LowAvailFirst", "label": "Low availability first" }
                        ] }
                    ]
                },
                {
                    "label": "Recovery",
                    "description": "How mining reacts when a stream stalls, goes offline, or changes game.",
                    "fields": [
                        { "key": "recovery_mode", "type": "select", "label": "Mode", "default": "Automatic", "options": [
                            { "value": "Automatic", "label": "Automatic" },
                            { "value": "Relaxed", "label": "Relaxed" },
                            { "value": "ManualOnly", "label": "Manual only" }
                        ] },
                        { "key": "detect_game_change", "type": "toggle", "label": "Switch if the stream changes game", "default": true },
                        { "key": "stale_minutes", "type": "number", "label": "Stall timeout (minutes)", "description": "Switch channels after this long with no drop progress.", "min": 2, "max": 30, "default": 7 }
                    ]
                }
            ]
        })
    }

    fn apply_panel_values(&mut self, values: &Value) {
        if let Some(active) = values.get("active").and_then(|v| v.as_bool()) {
            self.settings.active = active;
        }
        if let Some(n) = values.get("max_concurrent").and_then(|v| v.as_u64()) {
            self.settings.max_concurrent = (n as usize).clamp(1, 2);
        }
        if let Some(list) = values.get("priority_channels").and_then(|v| v.as_array()) {
            self.settings.priority_logins = string_list(list);
        }

        // Drops mining.
        let m: &mut MiningSettings = &mut self.miner.settings;
        if let Some(active) = values.get("mining_active").and_then(|v| v.as_bool()) {
            m.enabled = active;
        }
        if let Some(list) = values.get("priority_games").and_then(|v| v.as_array()) {
            m.priority_games = string_list(list);
        }
        if let Some(list) = values.get("excluded_games").and_then(|v| v.as_array()) {
            m.excluded_games = string_list(list);
        }
        if let Some(mode) = values.get("priority_mode").and_then(|v| v.as_str()) {
            m.priority_mode = PriorityMode::parse(mode);
        }
        if let Some(mode) = values.get("recovery_mode").and_then(|v| v.as_str()) {
            m.recovery_mode = RecoveryMode::parse(mode);
        }
        if let Some(d) = values.get("detect_game_change").and_then(|v| v.as_bool()) {
            m.detect_game_change = d;
        }
        if let Some(n) = values.get("stale_minutes").and_then(|v| v.as_u64()) {
            m.stale_threshold_secs = n.clamp(2, 30) * 60;
        }
    }

    async fn on_initialized(&mut self) {
        let _ = self
            .host
            .request("register_panel", json!({ "schema": Self::panel_schema() }))
            .await;
        if let Ok(result) = self.host.request("get_panel_values", json!({})).await {
            if let Some(values) = result.get("values") {
                self.apply_panel_values(values);
            }
        }
        self.host.log("info", "drops-farmer initialized").await;
    }

    fn on_followed_live(&mut self, params: &Value) {
        self.live = params
            .get("channels")
            .and_then(|c| c.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|c| {
                        Some(Channel {
                            channel_id: c.get("channel_id")?.as_str()?.to_string(),
                            login: c.get("login")?.as_str()?.to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
    }

    /// Ensures we hold a credential, requesting one (and triggering the host's
    /// consent prompt) only the first time it is actually needed. A denial
    /// stops further requests for the session.
    async fn ensure_credential(&mut self) -> Option<Cred> {
        if let Some(cred) = &self.cred {
            return Some(cred.clone());
        }
        if self.credential_denied {
            return None;
        }
        match self
            .host
            .request("get_credential", json!({ "kind": "twitch.android" }))
            .await
        {
            Ok(result) => {
                let token = result.get("token").and_then(|t| t.as_str())?.to_string();
                let client_id = result
                    .get("client_id")
                    .and_then(|c| c.as_str())
                    .unwrap_or_default()
                    .to_string();
                if client_id.is_empty() {
                    self.host
                        .log("error", "credential handover returned no client id")
                        .await;
                    return None;
                }
                let cred = Cred { token, client_id };
                self.cred = Some(cred.clone());
                // One-time confirmation once consent is granted and farming
                // actually begins.
                self.host
                    .notify_user("info", "Channel points farming is now active")
                    .await;
                Some(cred)
            }
            Err(e) => {
                // consent_denied or unavailable: stop asking this session.
                self.credential_denied = true;
                self.host
                    .log("info", format!("credential not available: {e}"))
                    .await;
                None
            }
        }
    }

    /// Picks up to `max` channels for points farming: priority logins first
    /// (when live), then least-recently-watched of the rest, skipping the
    /// channel already being mined for drops.
    fn pick_channels(&self, max: usize, exclude: &Option<String>) -> Vec<Channel> {
        let excluded = |id: &str| exclude.as_deref() == Some(id);
        let mut picked: Vec<Channel> = Vec::new();
        for login in &self.settings.priority_logins {
            if picked.len() >= max {
                break;
            }
            if let Some(ch) = self.live.iter().find(|c| &c.login == login) {
                if !excluded(&ch.channel_id) {
                    picked.push(ch.clone());
                }
            }
        }
        let mut rest: Vec<&Channel> = self
            .live
            .iter()
            .filter(|c| !picked.iter().any(|p| p.channel_id == c.channel_id))
            .filter(|c| !excluded(&c.channel_id))
            .collect();
        rest.sort_by_key(|c| self.last_watched.get(&c.channel_id).copied().unwrap_or(0));
        for ch in rest {
            if picked.len() >= max {
                break;
            }
            picked.push(ch.clone());
        }
        picked
    }

    async fn on_tick(&mut self) {
        let cp_active = self.settings.active && !self.live.is_empty();
        if !cp_active && !self.miner.settings.enabled {
            return;
        }
        let Some(cred) = self.ensure_credential().await else {
            return;
        };
        if self.user_id.is_none() {
            match twitch::fetch_user_id(&self.client, &cred.token).await {
                Ok(id) => self.user_id = Some(id),
                Err(e) => {
                    self.host.log("error", format!("user id fetch failed: {e}")).await;
                    return;
                }
            }
        }
        let user_id = self.user_id.clone().unwrap();
        self.tick_count += 1;

        // Drops mining runs first; the mined channel takes one of the two
        // concurrent watch slots, so points farming gets the rest.
        let mined = self
            .miner
            .tick(
                &self.client,
                &cred,
                &user_id,
                &self.device_id,
                &self.session_id,
                self.tick_count,
                &self.host,
            )
            .await;

        if !cp_active {
            return;
        }

        let reserved = if mined.is_some() { 1 } else { 0 };
        let available = self.settings.max_concurrent.saturating_sub(reserved);
        let invalid = self.current_set.len() > available
            || mined
                .as_ref()
                .is_some_and(|m| self.current_set.iter().any(|c| &c.channel_id == m));
        if available == 0 {
            self.current_set.clear();
        } else if self.current_set.is_empty()
            || self.tick_count % ROTATION_TICKS == 1
            || invalid
        {
            self.current_set = self.pick_channels(available, &mined);
        }

        let set = self.current_set.clone();
        let mut watched = 0;
        for ch in &set {
            match twitch::fetch_stream_info(&self.client, &ch.channel_id, &cred).await {
                Ok(Some((broadcast_id, game_id, game_name))) => {
                    match twitch::send_minute_watched(
                        &self.client,
                        ch,
                        &broadcast_id,
                        &game_id,
                        &game_name,
                        &user_id,
                        &cred,
                    )
                    .await
                    {
                        Ok(true) => {
                            self.last_watched.insert(ch.channel_id.clone(), self.tick_count);
                            watched += 1;
                        }
                        Ok(false) => {}
                        Err(e) => self.host.log("debug", format!("watch send failed for {}: {e}", ch.login)).await,
                    }
                }
                Ok(None) => {} // not live anymore; rotation will replace it
                Err(e) => self.host.log("debug", format!("stream info failed for {}: {e}", ch.login)).await,
            }
        }
        if watched > 0 {
            self.host.log("debug", format!("watched {watched} channel(s)")).await;
        }

        // Bonus chest sweep across all live channels every few minutes.
        if self.tick_count % CLAIM_EVERY_TICKS == 0 {
            let live = self.live.clone();
            let mut claimed = 0;
            for ch in &live {
                match twitch::fetch_claim(
                    &self.client,
                    &ch.login,
                    &self.device_id,
                    &self.session_id,
                    &cred.token,
                )
                .await
                {
                    Ok(Some((channel_id, claim_id))) => {
                        if let Ok(true) = twitch::claim_points(
                            &self.client,
                            &channel_id,
                            &claim_id,
                            &self.device_id,
                            &self.session_id,
                            &cred,
                        )
                        .await
                        {
                            claimed += 1;
                        }
                    }
                    Ok(None) => {}
                    Err(_) => {}
                }
            }
            if claimed > 0 {
                self.host.log("info", format!("claimed {claimed} bonus chest(s)")).await;
            }
        }
    }
}

#[tokio::main]
async fn main() {
    let host = Host::new(tokio::io::stdout());
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Inbound>(64);

    tokio::spawn(read_loop(tokio::io::stdin(), host.clone(), tx));

    let mut farmer = Farmer::new(host);
    while let Some(event) = rx.recv().await {
        match event {
            Inbound::Initialized => farmer.on_initialized().await,
            Inbound::FollowedLive(params) => farmer.on_followed_live(&params),
            Inbound::WatchTick => farmer.on_tick().await,
            Inbound::PanelChange(params) => {
                if let Some(values) = params.get("values") {
                    farmer.apply_panel_values(values);
                }
            }
        }
    }
}
