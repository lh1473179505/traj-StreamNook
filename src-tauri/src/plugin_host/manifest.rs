//! Plugin manifest (`plugin.toml`) parsing and validation.
//! The schema is frozen in docs/plugins/MANIFEST.md; validation fails closed.

use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};

/// Events a plugin may subscribe to (protocol v1).
pub const KNOWN_EVENTS: &[&str] = &[
    "on_stream_start",
    "on_stream_stop",
    "on_channel_change",
    "on_watch_tick",
    "on_followed_live",
    "on_ad_window",
    "on_settings_change",
    "on_panel_change",
];

/// Host methods a plugin may call (protocol v1). `get_credential` is governed
/// by the `credentials` capability list, not by `host_methods`.
pub const KNOWN_HOST_METHODS: &[&str] = &[
    "get_followed_live",
    "set_upstream",
    "notify",
    "log",
    "register_panel",
    "get_panel_values",
];

/// Credential kinds the broker can hand over (protocol v1).
pub const KNOWN_CREDENTIALS: &[&str] = &["twitch.android"];

/// UI contributions (protocol v1).
pub const KNOWN_UI: &[&str] = &["panel"];

pub const PROTOCOL_VERSION: u64 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Tier {
    A,
    B,
    C,
}

impl Tier {
    pub fn as_str(&self) -> &'static str {
        match self {
            Tier::A => "A",
            Tier::B => "B",
            Tier::C => "C",
        }
    }
    pub fn parse(s: &str) -> Result<Tier> {
        match s {
            "A" => Ok(Tier::A),
            "B" => Ok(Tier::B),
            "C" => Ok(Tier::C),
            other => bail!("unknown tier '{other}' (expected A, B, or C)"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub tier: String,
    pub description: String,
    #[serde(default)]
    pub homepage: Option<String>,
    pub host_min: String,
    pub runtime: RuntimeSpec,
    #[serde(default)]
    pub capabilities: Capabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeSpec {
    pub kind: String,
    pub entry: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default = "default_transport")]
    pub transport: String,
}

fn default_transport() -> String {
    "stdio".to_string()
}

fn default_network() -> String {
    "none".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Capabilities {
    #[serde(default)]
    pub events: Vec<String>,
    #[serde(default)]
    pub host_methods: Vec<String>,
    #[serde(default)]
    pub credentials: Vec<String>,
    #[serde(default = "default_network")]
    pub network: String,
    #[serde(default)]
    pub ui: Vec<String>,
}

impl Default for Capabilities {
    fn default() -> Self {
        Self {
            events: Vec::new(),
            host_methods: Vec::new(),
            credentials: Vec::new(),
            network: default_network(),
            ui: Vec::new(),
        }
    }
}

impl PluginManifest {
    pub fn parse(toml_text: &str) -> Result<Self> {
        let manifest: PluginManifest =
            toml::from_str(toml_text).map_err(|e| anyhow!("manifest parse error: {e}"))?;
        manifest.validate()?;
        Ok(manifest)
    }

    pub fn tier(&self) -> Result<Tier> {
        Tier::parse(&self.tier)
    }

    /// Full fail-closed validation per docs/plugins/MANIFEST.md.
    pub fn validate(&self) -> Result<()> {
        // id: reverse-DNS, lowercase, max 64
        if self.id.len() > 64 {
            bail!("plugin id exceeds 64 characters");
        }
        let id_ok = {
            let parts: Vec<&str> = self.id.split('.').collect();
            parts.len() >= 2
                && parts.iter().all(|p| {
                    !p.is_empty()
                        && p.chars()
                            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
                        && !p.starts_with('-')
                })
        };
        if !id_ok {
            bail!("plugin id '{}' is not a valid reverse-DNS identifier", self.id);
        }
        if self.name.is_empty() || self.name.chars().count() > 40 {
            bail!("plugin name must be 1 to 40 characters");
        }
        semver::Version::parse(&self.version)
            .map_err(|e| anyhow!("plugin version is not valid semver: {e}"))?;
        Tier::parse(&self.tier)?;
        if self.description.chars().count() > 200 {
            bail!("description exceeds 200 characters");
        }
        if let Some(h) = &self.homepage {
            if !h.starts_with("https://") {
                bail!("homepage must be an https URL");
            }
        }
        semver::Version::parse(&self.host_min)
            .map_err(|e| anyhow!("host_min is not valid semver: {e}"))?;

        // runtime
        match self.runtime.kind.as_str() {
            "process" => {}
            "wasm" => bail!("runtime.kind 'wasm' is reserved and not supported by this host"),
            other => bail!("unknown runtime.kind '{other}'"),
        }
        match self.runtime.transport.as_str() {
            "stdio" => {}
            "socket" => bail!("runtime.transport 'socket' is reserved and not supported by this host"),
            other => bail!("unknown runtime.transport '{other}'"),
        }
        let entry = &self.runtime.entry;
        if entry.is_empty()
            || entry.contains("..")
            || entry.starts_with('/')
            || entry.starts_with('\\')
            || entry.chars().nth(1) == Some(':')
        {
            bail!("runtime.entry must be a relative path inside the plugin directory");
        }

        // capabilities: unknown strings fail closed
        for e in &self.capabilities.events {
            if !KNOWN_EVENTS.contains(&e.as_str()) {
                bail!("unknown event capability '{e}' (requires a newer StreamNook?)");
            }
        }
        for m in &self.capabilities.host_methods {
            if !KNOWN_HOST_METHODS.contains(&m.as_str()) {
                bail!("unknown host method capability '{m}' (requires a newer StreamNook?)");
            }
        }
        for c in &self.capabilities.credentials {
            if !KNOWN_CREDENTIALS.contains(&c.as_str()) {
                bail!("unknown credential kind '{c}' (requires a newer StreamNook?)");
            }
        }
        match self.capabilities.network.as_str() {
            "none" | "external" => {}
            other => bail!("capabilities.network must be 'none' or 'external', got '{other}'"),
        }
        for u in &self.capabilities.ui {
            if !KNOWN_UI.contains(&u.as_str()) {
                bail!("unknown ui capability '{u}' (requires a newer StreamNook?)");
            }
        }
        Ok(())
    }

    /// Checks the running host version against the manifest's `host_min`.
    pub fn check_host_min(&self, host_version: &str) -> Result<()> {
        let min = semver::Version::parse(&self.host_min)?;
        let host = semver::Version::parse(host_version)
            .map_err(|e| anyhow!("host version '{host_version}' is not semver: {e}"))?;
        if host < min {
            bail!(
                "plugin requires StreamNook {} or newer (this is {})",
                self.host_min,
                host_version
            );
        }
        Ok(())
    }
}
