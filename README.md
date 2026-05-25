<div align="center">

<img src="src-tauri/images/logo.png" alt="StreamNook" width="200" />

# StreamNook

A native Twitch desktop client.

<p>
  <a href="https://github.com/winters27/StreamNook"><img src="https://img.shields.io/badge/Project-Page-00d9ff?style=for-the-badge&logo=github&logoColor=white&labelColor=1a1a2e" alt="Project page" /></a>
  <a href="https://github.com/winters27/StreamNook/stargazers"><img src="https://img.shields.io/github/stars/winters27/StreamNook?color=00d9ff&style=for-the-badge&logo=star&logoColor=white&labelColor=1a1a2e" alt="Stars" /></a>
  <a href="https://github.com/winters27/StreamNook/releases/latest"><img src="https://img.shields.io/github/v/release/winters27/StreamNook?color=ff6b6b&style=for-the-badge&logo=github&logoColor=white&labelColor=1a1a2e" alt="Latest release" /></a>
</p>

<p>
  <img src="https://img.shields.io/badge/Rust-orange?style=for-the-badge&logo=rust&logoColor=white&labelColor=1a1a2e" alt="Rust" />
  <img src="https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=white&labelColor=1a1a2e" alt="React" />
  <img src="https://img.shields.io/badge/Tauri-FFC131?style=for-the-badge&logo=tauri&logoColor=white&labelColor=1a1a2e" alt="Tauri" />
</p>

<p>
  <a href="https://github.com/winters27/StreamNook/issues"><img src="https://img.shields.io/badge/Issues-ff6b6b?style=for-the-badge&logo=github&logoColor=white&labelColor=1a1a2e" alt="Issues" /></a>
  <a href="https://github.com/winters27/StreamNook/discussions"><img src="https://img.shields.io/badge/Discussions-4ecdc4?style=for-the-badge&logo=github&logoColor=white&labelColor=1a1a2e" alt="Discussions" /></a>
</p>

</div>

---

## The problem

Let's be honest: you're grinding through your 47th hour of that indie roguelike, talking to yourself about optimal build paths, when you realize *I need human voices*. But opening Twitch in a browser? That's like inviting a resource-hungry elephant to sit on your CPU. Your fans spin up, your frame rate tanks, and suddenly you're choosing between watching streams and actually playing games.

**StreamNook** is the answer to this very specific but deeply relatable problem.

Built from the ground up with Rust and React, StreamNook delivers a buttery-smooth Twitch experience that sips resources instead of chugging them. It's the cozy corner of the internet where you can watch streams, chat with communities, and track your favorite streamers, all without turning your PC into a space heater.

<div align="center">
  <img src="src-tauri/images/watching_stream.gif" alt="Watching a stream in StreamNook" width="800" />
</div>

---

## What you get

### Ad-free streaming up to 4K

StreamNook bundles Streamlink and routes playback through a local HTTP splice server. Anonymous viewers get ad-free 1080p through the integrated TTV-LOL PRO proxy. Signed-in viewers also get 1440p and 2160p variants spliced in from an authenticated master playlist, so the high-quality tiers stay ad-free too. A first-run auto-optimizer picks the fastest proxy region, and a built-in latency dashboard lets you switch regions any time.

Plyr and HLS.js handle playback. Picture-in-picture, theater mode, configurable compact-view presets for multi-monitor setups, jump-to-live-edge on load, and an auto-switch when the current stream ends.

### Chat that does more than Twitch's

Twitch IRC with smooth virtualized rendering, plus 7TV, BetterTTV, and FrankerFaceZ emote support including animation and zero-width overlays. 7TV paints and cosmetic badges render alongside Twitch sub, mod, VIP, founder, and bits badges. Apple-style emoji rendering and a native emoji picker.

Live overlays surface the moments other clients flatten into lines of text:

- **Predictions** with voting outcomes, your channel points balance, a countdown, and win/loss resolution.
- **Hype Trains** with progress, contribution stats, and celebration animations.
- **Watch Streaks** and **Resubs** as in-chat banners you can share.
- **Pinned messages** polled live from GQL.

Customizations the official chat doesn't have:

- Highlight phrases with custom colors and sounds.
- Per-user nickname and color overrides set from a profile card.
- User-defined slash commands and text triggers.
- Local-only `/clearmessages` and `/usercard <name>`.
- Moderator tools (ban, timeout, clear, mod, VIP) with a moderator log pane, slash-command autocomplete, mention autocomplete, and reply threads.

<div align="center">
  <img src="src-tauri/images/sidebar.png" alt="Sidebar" width="800" />
</div>

### Drops and channel points without sitting there

Automated Twitch Drops farming with campaign tracking, priority-channel selection, and an inventory viewer. Channel points auto-mine across every channel you watch, with a leaderboard for cross-streamer balances. Quick mining toggle inside the chat widget. Raid auto-follow keeps your follow list current when a streamer raids out.

Drops authentication runs in a secure embedded browser window. No external miner, no other apps.

<div align="center">
  <img src="src-tauri/images/drops_farming.png" alt="Drops farming dashboard" width="800" />
</div>

### Many streams or many chats at once

**MultiNook** is a multi-stream grid view. Dock, undock, drag-rearrange, and switch audio focus between tiles. The unified chat panel follows the active tile.

**MultiChat** is a separate, chat-only window that holds 1 to N channels in tabs or 2/3/4-column splits. Run as many MultiChat windows as you want, one per monitor if you like. Pop a chat out from an active stream, or open MultiChat empty from the system tray and fill it as you go. MultiChat keeps running when the main window is hidden to the tray.

### A community layer on top of Twitch

Every StreamNook user gets a permanent rank number based on signup order. A small StreamNook badge sits in front of your name in any Twitch chat, visible only to other StreamNook viewers. Hover it for a cypher-decode animation that resolves to a tier card (Ethereal, Mythic, Ascendant, Founder, Member) with a Fraunces-italic rank number. A handful of culturally-significant numbers carry hidden labels for the people who land on them.

Profile cards pull each streamer's full channel banner art via GQL (not just the offline placeholder), follow age, panels, and social links.

<div align="center">
  <img src="src-tauri/images/twitch_global_badges.png" alt="Badges overlay" width="49%" />
  <img src="src-tauri/images/badge_info.gif" alt="Badge details" width="49%" />
</div>

### Lives where you work

- **Dynamic Island** notification center surfaces live alerts, drops progress, channel points, and update availability without taking over the screen.
- **System tray** keeps MultiChat windows alive when the main window is hidden.
- **Native desktop notifications** with stream thumbnails, custom sounds, and one-click launch.
- **Discord Rich Presence** shows what you're watching.
- **Whispers** with full GQL history retrieval and an import tool for prior Twitch whisper exports.
- **24 built-in themes** (Winters' Glass, Dracula, Nord, Gruvbox, Tokyo Night, Catppuccin, and more) plus a custom theme creator with color picker and live preview.

<div align="center">
  <img src="src-tauri/images/dynamic_island.png" alt="Dynamic Island notification center" width="800" />
</div>

<div align="center">
  <img src="src-tauri/images/native_whispers.png" alt="Native whispers" width="800" />
</div>

<div align="center">
  <img src="src-tauri/images/theme_switcher.png" alt="Theme switcher" width="800" />
</div>

### More

Cross-window settings sync. Stream context menus with "Pop out chat". Streamer About panel with channel info and social links. Browse categories with sub-tabs for live streams, clips, and videos. Universal two-tier cache backed by a daily GitHub Actions refresh for badge metadata. Bundled Streamlink, automatic updates with optional auto-install, and a first-run setup wizard.

<div align="center">
  <img src="src-tauri/images/browsing_categories.png" alt="Browse categories" width="800" />
</div>

<div align="center">
  <img src="src-tauri/images/following.png" alt="Following list" width="800" />
</div>

---

## Built on

Rust + Tauri 2 native shell. React 18 + TypeScript + Vite + Tailwind frontend. Plyr, HLS.js, and Streamlink for playback. Tokio and Reqwest for async networking. Talks to Twitch via Helix, GQL, IRC, EventSub, and PubSub. Supabase backs the identity registry. 7TV, BetterTTV, and FrankerFaceZ APIs supply extended emotes and cosmetics. Discord-RPC for rich presence.

---

## Install

1. Download the latest build from the [Releases page](https://github.com/winters27/StreamNook/releases/latest).
2. Extract and run.
3. Follow the setup wizard to sign in with your Twitch account.

Streamlink and TTV-LOL PRO are bundled. There is nothing else to install.

---

## Roadmap

| Feature | Description |
|---|---|
| VOD playback | Past broadcasts with synchronized chat replay |
| Clip creation | Create, manage, and share clips from inside the app |

---

## Contributing

Bug reports, feature requests, docs, and code changes are all welcome. Open an issue or a discussion on GitHub and dive in.

---

## Credits

StreamNook stands on the shoulders of giants:

- [Streamlink](https://github.com/streamlink/streamlink), the backbone of stream resolution and playback.
- [Tauri](https://tauri.app/), the native desktop framework.
- [Plyr](https://plyr.io/), the video player.
- [HLS.js](https://github.com/video-dev/hls.js), HLS streaming support.
- [7TV](https://7tv.app/), extended emote and cosmetic support.
- [Twitch](https://dev.twitch.tv/), for the platform and APIs.

Thanks to everyone in the open-source community making projects like this possible.

---

## License

MIT. See [LICENSE](LICENSE) for details.

---

<div align="center">
  <sub>StreamNook is not affiliated with Twitch Interactive, Inc.</sub>
</div>
