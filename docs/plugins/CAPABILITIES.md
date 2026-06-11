# Capabilities and Consent v1

Default deny: a plugin gets exactly what its manifest lists and the user grants, nothing else. The host enforces by not answering ungranted requests and never emitting unsubscribed events. Capabilities are deliberately coarse so the consent dialog can show them verbatim and a non-technical user can understand what they are agreeing to.

## Capability vocabulary and rendered consent strings

The consent dialog renders one line per granted capability, using exactly these strings.

### Events

| Capability | Rendered line |
|---|---|
| `events: on_stream_start`, `on_stream_stop`, `on_channel_change`, `on_watch_tick` | "Knows which channel you are watching" |
| `events: on_followed_live` | "Sees which channels you follow are live" |
| `events: on_ad_window` | "Knows when an ad break is detected" |
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

## Consent flows by tier

Tier badges in the plugins page and dialogs: Tier A renders as a green badge labeled "Safe", Tier B as an amber badge labeled "Unofficial interfaces", Tier C as a red badge labeled "Account risk".

### Tier A

Single dialog: plugin name, author, version, source index, the capability lines, buttons Install and Cancel. No risk language.

### Tier B

Same dialog as Tier A plus one fixed line above the capability list:

> "This add-on talks to Twitch or other services over interfaces they do not officially document, in the way a normal viewer would."

### Tier C

Full warning dialog. Fixed copy, with the capability lines rendered beneath it:

> **{name} can get your Twitch account suspended.**
>
> This add-on automates watching or claiming, or changes how ads are delivered. Twitch's Terms of Service prohibit this, and accounts that do it risk suspension and loss of drops, points, and entitlements.
>
> StreamNook does not include, ship, or endorse this behavior. You are choosing to install community software that runs as its own program, built by {author}, from a source you added ({source name}).

Below the capability list, a required checkbox:

> [ ] I understand this can get my Twitch account suspended, and I accept that risk.

The confirm button (label: "Install anyway") stays disabled until the checkbox is checked. A single click can never enable a Tier C plugin.

### First credential handover (any tier)

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
> StreamNook does not review, host, or endorse plugins from this source. It may list software that violates Twitch's Terms of Service. The source operator's key fingerprint is shown below; future updates from this source must be signed with the same key.
>
> {fingerprint}

Buttons: "Add source", "Cancel".

## Rules for the host implementation

- Render capability lines from the granted set, not the requested set, everywhere they appear after install.
- Never collapse the Tier C dialog into a generic confirm. The copy above is part of the frozen contract.
- The consent dialog must show author, version, tier badge, and source for every install, every update that adds capabilities, and every tier change. An update that requests new capabilities or a higher tier re-runs the full consent flow for its tier.
- Credential handovers are appended to a per-plugin audit log with timestamp and credential kind. The log is local and user-viewable.
