# Capabilities and Consent v1

Default deny: a plugin gets exactly what its manifest lists and the user grants, nothing else. The host enforces by not answering ungranted requests and never emitting unsubscribed events. Capabilities are deliberately coarse so the consent dialog can show them verbatim and a non-technical user can understand what they are agreeing to.

## Capability vocabulary and rendered consent strings

The consent dialog renders one line per granted capability, using exactly these strings.

### Events

| Capability | Rendered line |
|---|---|
| `events: on_stream_start`, `on_stream_stop`, `on_channel_change`, `on_watch_tick` | "Knows which channel you are watching" |
| `events: on_followed_live` | "Sees which channels you follow are live" |
| `events: on_chat_message` | "Sees chat messages in channels you open" |
| `events: on_settings_change` | "Is told when certain app settings change" |
| `events: on_panel_change` | Covered by the settings panel line below |

The four watch-related events render as a single combined line when any of them is granted, to avoid a wall of near-duplicates.

### Host methods

| Capability | Rendered line |
|---|---|
| `host_methods: get_followed_live` | "Can ask for your list of live followed channels" |
| `host_methods: set_upstream` | "Can supply the video source the player uses" |
| `host_methods: notify` | "Can show you notifications" |
| `host_methods: log` | Not rendered (local diagnostics only) |
| `host_methods: register_panel`, `get_panel_values` | "Adds a settings panel inside StreamNook" |

### Credentials

| Capability | Rendered line |
|---|---|
| `credentials: twitch.android` | "Can request your Twitch login token. With it, this plugin can act as your Twitch account" |

Credential lines render in warning color in every tier. Granting the capability at install does not hand over the credential; the first actual request triggers its own prompt (below).

### Network

| Capability | Rendered line |
|---|---|
| `network: external` | "Makes its own network connections, to Twitch and elsewhere. StreamNook does not see or control this traffic" |
| `network: none` | "Declares that it makes no network connections of its own" |

### UI

| Capability | Rendered line |
|---|---|
| `ui: panel` | "Adds a settings panel inside StreamNook" |

## Consent flow

One calm, capability-focused dialog for every plugin, regardless of tier. The tier is quiet curation metadata; it renders as a neutral capability-scope badge ("Standard", "Extended", "Advanced"), never a risk rating.

The install / enable dialog shows:

- The plugin name, author, version, and tier badge.
- One line: "This add-on runs as its own program alongside StreamNook. It can do the following:"
- The capability lines from the granted set (the login-access line, when present, is rendered with mild emphasis because it is the most powerful capability).
- For an add-on from a community source, one neutral note: "Community sources aren't reviewed by StreamNook. Install add-ons from sources you trust."
- Buttons: "Cancel" and "Install" (or "Enable").

No tier-specific warnings, no "account suspension" copy, no acknowledgment checkbox. The capability list is the contract: what the add-on can do is stated plainly and the user confirms. The separate first-credential-handover prompt (below) is the checkpoint for actually handing over the login token.

### First credential handover (any plugin)

Triggered by the plugin's first `get_credential` call for a kind in a session, independent of install-time grants:

> **{name} is asking to use your Twitch login.**
>
> If you allow this, the plugin receives a token that lets it act as your Twitch account: watching, claiming, and anything else that login can do. StreamNook records every time a credential is handed to a plugin.

Buttons: "Allow", "Allow and don't ask again", "Deny". "Deny" fails the call with `consent_denied`. "Allow and don't ask again" persists until revoked.

### Revocation

The plugins page lists each installed plugin with its tier badge, capability summary, an enable toggle, and a "Revoke credential access" action where applicable. Revocation takes effect immediately: subsequent `get_credential` calls fail with `consent_denied`. Disabling a plugin shuts its process down. The audit log of credential handovers is viewable per plugin.

## Adding a community source

Adding a source is itself a consented action:

> **Add a community plugin source?**
>
> {source URL}
>
> StreamNook doesn't review or host what community sources list, so add ones you trust. The source operator's key fingerprint is shown below; future updates from this source must be signed with the same key.
>
> {fingerprint}

Buttons: "Add source", "Cancel".

## Rules for the host implementation

- Render capability lines from the granted set, not the requested set, everywhere they appear after install.
- Keep the consent dialog calm and capability-focused; the tier badge is neutral, not a risk label.
- The consent dialog must show author, version, tier badge, and source for every install and every update that adds capabilities. An update that requests new capabilities re-runs the consent flow.
- Credential handovers are appended to a per-plugin audit log with timestamp and credential kind. The log is local and user-viewable.
