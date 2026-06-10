//! Low-latency HLS origin for Twitch.
//!
//! Twitch low-latency channels ship chunked CMAF: each ~2s segment is ~19
//! `moof`+`mdat` fragment pairs (~105ms each), and the in-progress segment is
//! delivered progressively (the connection is held open while it encodes). The
//! `#EXT-X-TWITCH-PREFETCH` tag points at that in-progress segment.
//!
//! This module turns that into a real LL-HLS origin so hls.js (in `lowLatencyMode`)
//! can play ~2s from live instead of waiting a whole segment behind it (the ~5-6s
//! floor of whole-segment promotion). A background "edge reader" streams the
//! in-progress segment, splits it into parts the instant each `moof`+`mdat` lands,
//! and serves an LL-HLS playlist with `#EXT-X-PART` + blocking reload. hls.js fetches
//! each part as it appears.
//!
//! Verified hls.js 1.6.15 contract this implements:
//! - Low latency comes from BLOCKING the playlist reload (`_HLS_msn`/`_HLS_part`),
//!   then plain GETs of listed `#EXT-X-PART` URIs. `#EXT-X-PRELOAD-HINT` is ignored
//!   by hls.js, so we don't emit it.
//! - Only ever list a part whose bytes we already hold (a listed part that 404s with
//!   no alternate quality is a fatal, non-recovering freeze). Same for the blocking
//!   wait: bounded, then return the current playlist rather than hang.
//! - Always keep >=1 complete `#EXTINF` segment (an all-parts playlist trips
//!   "not enough fragments to start").
//! - Part URLs need not be stable across refreshes (parts match by (sn, partIndex)).
//!   The init segment (`#EXT-X-MAP`) is left as the stable absolute upstream URL.
//!
//! One `LlOrigin` instance serves one upstream stream. The solo relay uses the
//! shared module-level instance (facade functions at the bottom); MultiNook builds
//! one per tile so any number of low-latency grid tiles can run concurrently.

use log::{debug, info, warn};
use once_cell::sync::Lazy;
use reqwest::{Client, Response};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::Notify;
use tokio::task::JoinHandle;

/// Max segments retained in the live window (a few complete + the in-progress one).
const MAX_SEGMENTS: usize = 6;
/// Smaller live window for MultiNook tiles: the window is held entirely in memory
/// and multiplies across every tile of a grid, and tiles ride a slightly looser
/// cushion than solo so they never need the deeper history.
pub(crate) const TILE_MAX_SEGMENTS: usize = 4;
/// Declared `PART-TARGET` (max part duration). Generously above Twitch's ~0.105s
/// chunks so every real part is comfortably under it (spec requires that), and so
/// hls.js's edge clamp (`edge - partTarget`) leaves headroom.
const PART_TARGET: f64 = 0.5;
/// Advisory per-part duration in the playlist. hls.js derives real timing from the
/// fMP4 sample tables, not this, so a nominal value is fine.
const NOMINAL_PART_DUR: f64 = 0.1;
const TARGET_DURATION: u64 = 2;
/// How long a blocking reload waits for the requested part before returning the
/// current playlist anyway (hls.js then retries; never hang indefinitely). MUST
/// stay under hls.js's low-latency reload timeout, which it caps at
/// `max(PART-TARGET * 3, TARGETDURATION * 0.8)` = 1.6s for this origin (hls.js
/// dist ~36182, "the default of 10000ms is counter productive to blocking
/// playlist reload requests"); a 4s hold tripped `levelLoadTimeOut` on every
/// part drought. 1.4s leaves transit margin under that cap.
const BLOCK_TIMEOUT: Duration = Duration::from_millis(1400);
/// How long the reader waits for a preopened next-segment connection before
/// abandoning it for the poll path. Normally ready instantly (the previous
/// segment just finished, so the next is already producing).
const PREOPEN_WAIT: Duration = Duration::from_secs(4);
/// How many trailing published segments to backfill (fully) at start so the first
/// served playlist already has complete `#EXTINF` segments.
const BACKFILL_SEGMENTS: usize = 2;
/// Bound on one-shot fetches (probe, backfill, playlist polls). The streaming
/// in-progress GET is intentionally NOT bounded this way (it's long-lived); it uses a
/// per-chunk read timeout instead. Without these, a hung fetch could block stream
/// start or freeze the reader.
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);
/// Max wait for the next chunk of the in-progress segment before treating it as done.
const CHUNK_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone)]
struct Part {
    duration: f64,
    bytes: Arc<Vec<u8>>,
}

struct Segment {
    sn: u64,
    pdt: Option<String>,
    complete: bool,
    duration: f64,
    parts: Vec<Part>,
}

struct LiveEdge {
    init_url: String,
    target_duration: u64,
    part_target: f64,
    segments: VecDeque<Segment>,
}

/// One live-edge origin. Solo and MultiNook each route their relay traffic to an
/// instance of this; all state below is per-stream.
pub struct LlOrigin {
    live_edge: Mutex<Option<LiveEdge>>,
    /// Wakes blocked playlist reloads whenever the edge gains a part or segment.
    notify: Notify,
    reader_task: Mutex<Option<JoinHandle<()>>>,
    /// Generation counter: bumped on every start/stop so a lingering reader task can
    /// detect it has been superseded and exit even before its `abort()` lands.
    generation: AtomicU64,
    /// Live window size (complete segments + the in-progress one).
    max_segments: usize,
}

/// Hard kill switch: when true, no origin activates and the relays fall back to the
/// stable whole-segment path. Flip to disable LL-HLS without removing it. Global on
/// purpose: it exists to turn the feature off everywhere at once.
static DISABLED: AtomicBool = AtomicBool::new(false);

fn http_client() -> Client {
    Client::builder()
        .tcp_keepalive(Duration::from_secs(15))
        .pool_idle_timeout(Duration::from_secs(30))
        // No overall timeout: the in-progress segment GET is intentionally long-lived
        // (it streams for ~the segment duration). Per-read progress is what matters.
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .expect("ll_origin http client")
}

// ──────────────────────────── CMAF box chunker ────────────────────────────

/// Splits a CMAF byte stream into parts, one per `moof`+`mdat` pair. Any boxes
/// before the first `moof` (e.g. a leading `emsg`/`styp`) ride with the next part.
/// Feed bytes incrementally; each `push` returns whatever parts completed.
struct BoxChunker {
    buf: Vec<u8>,
    current: Vec<u8>,
}

impl BoxChunker {
    fn new() -> Self {
        Self { buf: Vec::new(), current: Vec::new() }
    }

    fn push(&mut self, data: &[u8]) -> Vec<Vec<u8>> {
        self.buf.extend_from_slice(data);
        let mut parts = Vec::new();
        loop {
            if self.buf.len() < 8 {
                break;
            }
            let size32 = u32::from_be_bytes([self.buf[0], self.buf[1], self.buf[2], self.buf[3]]);
            let is_mdat = &self.buf[4..8] == b"mdat";
            let (box_len, header) = if size32 == 1 {
                if self.buf.len() < 16 {
                    break;
                }
                let large = u64::from_be_bytes(self.buf[8..16].try_into().unwrap()) as usize;
                (large, 16)
            } else {
                (size32 as usize, 8)
            };
            // size 0 ("to end of stream") or a corrupt tiny size: wait for flush().
            if box_len < header {
                break;
            }
            if self.buf.len() < box_len {
                break;
            }
            self.current.extend_from_slice(&self.buf[..box_len]);
            self.buf.drain(..box_len);
            if is_mdat {
                parts.push(std::mem::take(&mut self.current));
            }
        }
        parts
    }

    /// Stream ended: fold any leftover bytes into a final part.
    fn flush(&mut self) -> Option<Vec<u8>> {
        if !self.buf.is_empty() {
            let rest = std::mem::take(&mut self.buf);
            self.current.extend_from_slice(&rest);
        }
        if self.current.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.current))
        }
    }
}

// ──────────────────────────── upstream playlist parse ────────────────────────────

struct Upstream {
    init_url: Option<String>,
    /// (sn, pdt, absolute url) for published segments.
    published: Vec<(u64, Option<String>, String)>,
    /// Absolute prefetch URLs, oldest first (the first is the actively-producing one).
    prefetch: Vec<String>,
}

fn base_of(url: &str) -> String {
    let no_q = url.split('?').next().unwrap_or(url);
    match no_q.rfind('/') {
        Some(i) => no_q[..=i].to_string(),
        None => String::new(),
    }
}

fn absolutize(uri: &str, base: &str) -> String {
    if uri.starts_with("http://") || uri.starts_with("https://") {
        uri.to_string()
    } else {
        format!("{base}{uri}")
    }
}

fn parse_upstream(text: &str, base: &str) -> Upstream {
    let mut up = Upstream {
        init_url: None,
        published: Vec::new(),
        prefetch: Vec::new(),
    };
    let mut sn: u64 = 0;
    let mut pending_pdt: Option<String> = None;
    let mut expect_uri = false;
    for line in text.lines() {
        let t = line.trim();
        if let Some(v) = t.strip_prefix("#EXT-X-MEDIA-SEQUENCE:") {
            sn = v.trim().parse().unwrap_or(0);
        } else if let Some(rest) = t.strip_prefix("#EXT-X-MAP:") {
            // URI="..."
            if let Some(uri) = extract_attr(rest, "URI") {
                up.init_url = Some(absolutize(&uri, base));
            }
        } else if let Some(v) = t.strip_prefix("#EXT-X-PROGRAM-DATE-TIME:") {
            pending_pdt = Some(v.trim().to_string());
        } else if let Some(url) = t.strip_prefix("#EXT-X-TWITCH-PREFETCH:") {
            up.prefetch.push(absolutize(url.trim(), base));
        } else if t.starts_with("#EXTINF:") {
            expect_uri = true;
        } else if expect_uri && !t.is_empty() && !t.starts_with('#') {
            expect_uri = false;
            up.published.push((sn, pending_pdt.take(), absolutize(t, base)));
            sn += 1;
        }
    }
    up
}

/// Extract `KEY="value"` from an attribute list fragment.
fn extract_attr(attrs: &str, key: &str) -> Option<String> {
    let needle = format!("{key}=\"");
    let start = attrs.find(&needle)? + needle.len();
    let rest = &attrs[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

// ──────────────────────────── lifecycle ────────────────────────────

pub fn set_disabled(disabled: bool) {
    DISABLED.store(disabled, Ordering::Relaxed);
}

impl LlOrigin {
    pub fn new(max_segments: usize) -> Arc<Self> {
        Arc::new(Self {
            live_edge: Mutex::new(None),
            notify: Notify::new(),
            reader_task: Mutex::new(None),
            generation: AtomicU64::new(0),
            max_segments,
        })
    }

    pub fn is_active(&self) -> bool {
        self.live_edge.lock().unwrap().is_some()
    }

    /// Stop any running reader and clear state. Called on stream stop / restart.
    pub fn stop(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Some(h) = self.reader_task.lock().unwrap().take() {
            h.abort();
        }
        *self.live_edge.lock().unwrap() = None;
        self.notify.notify_waiters();
    }

    /// Probe the upstream and, if it's a low-latency broadcast, build the initial live
    /// edge (backfilling a couple of complete segments) and spawn the streaming reader.
    /// Returns true if the origin activated (LL channel). Awaited from stream start so
    /// the player can read the result before constructing hls.js.
    pub async fn start(self: Arc<Self>, upstream_playlist_url: String) -> bool {
        self.stop();
        if DISABLED.load(Ordering::Relaxed) {
            return false;
        }
        let gen = self.generation.load(Ordering::SeqCst);
        let client = http_client();

        let text = match client.get(&upstream_playlist_url).timeout(FETCH_TIMEOUT).send().await {
            Ok(r) => r.text().await.unwrap_or_default(),
            Err(e) => {
                warn!("[LLOrigin] initial playlist fetch failed: {e}");
                return false;
            }
        };
        let base = base_of(&upstream_playlist_url);
        let up = parse_upstream(&text, &base);

        // Not a low-latency broadcast (no prefetch hints): leave the origin inactive so
        // the relay uses the stable whole-segment path.
        if up.prefetch.is_empty() || up.published.is_empty() {
            debug!("[LLOrigin] not a low-latency stream (no prefetch); origin inactive");
            return false;
        }
        let init_url = match up.init_url.clone() {
            Some(u) => u,
            None => {
                warn!("[LLOrigin] low-latency stream without EXT-X-MAP; origin inactive");
                return false;
            }
        };

        // Backfill the last few complete segments so the first playlist has #EXTINF.
        let mut segments: VecDeque<Segment> = VecDeque::new();
        let backfill: Vec<_> = up
            .published
            .iter()
            .rev()
            .take(BACKFILL_SEGMENTS)
            .rev()
            .cloned()
            .collect();
        for (sn, pdt, url) in backfill {
            match client.get(&url).timeout(FETCH_TIMEOUT).send().await.ok() {
                Some(resp) => {
                    let bytes = resp.bytes().await.map(|b| b.to_vec()).unwrap_or_default();
                    let parts = split_complete(&bytes);
                    if !parts.is_empty() {
                        segments.push_back(make_segment(sn, pdt, true, parts));
                    }
                }
                None => continue,
            }
        }
        if segments.is_empty() {
            warn!("[LLOrigin] backfill produced no complete segments; origin inactive");
            return false;
        }

        *self.live_edge.lock().unwrap() = Some(LiveEdge {
            init_url,
            // Declare the real ~2s segment size, NOT Twitch's inflated TARGETDURATION:6.
            // hls.js uses targetduration for reload cadence and tune-in goal math; an
            // inflated value makes it mis-time part requests.
            target_duration: TARGET_DURATION,
            part_target: PART_TARGET,
            segments,
        });
        info!("[LLOrigin] activated (low-latency origin) for {upstream_playlist_url}");

        let handle = tokio::spawn(run_reader(self.clone(), upstream_playlist_url, client, gen));
        *self.reader_task.lock().unwrap() = Some(handle);
        true
    }
}

fn make_segment(sn: u64, pdt: Option<String>, complete: bool, part_bytes: Vec<Vec<u8>>) -> Segment {
    let count = part_bytes.len().max(1);
    let dur = TARGET_DURATION as f64 / count as f64;
    let parts = part_bytes
        .into_iter()
        .map(|b| Part { duration: dur, bytes: Arc::new(b) })
        .collect();
    Segment {
        sn,
        pdt,
        complete,
        duration: TARGET_DURATION as f64,
        parts,
    }
}

/// Split a fully-downloaded segment into parts (one per moof+mdat).
fn split_complete(bytes: &[u8]) -> Vec<Vec<u8>> {
    let mut chunker = BoxChunker::new();
    let mut parts = chunker.push(bytes);
    if let Some(tail) = chunker.flush() {
        parts.push(tail);
    }
    parts
}

// ──────────────────────────── the streaming reader ────────────────────────────

async fn run_reader(origin: Arc<LlOrigin>, upstream_playlist_url: String, client: Client, gen: u64) {
    let base = base_of(&upstream_playlist_url);
    // Connection to the NEXT in-progress segment, opened by `preopen_next` while
    // the current one was still streaming. Consumed by the fast path below;
    // discarded whenever the world doesn't match (the poll path then re-syncs).
    let mut preopened: Option<(u64, JoinHandle<Option<(Response, Option<String>)>>)> = None;
    loop {
        if gen != origin.generation.load(Ordering::SeqCst) {
            return;
        }

        // Fast path: stream the preopened next segment. No playlist round trip, no
        // time-to-first-byte, no waiting for Twitch to publish the previous segment.
        // Without this the origin publishes NOTHING for the poll + publish-lag +
        // TTFB at every segment boundary (~1-2.5s), which is most of a 2s cushion:
        // the player drains right as it reaches the live edge and stalls (observed
        // live 2026-06-09, "Time since last fragment: 2423ms").
        if let Some((sn, mut handle)) = preopened.take() {
            let contiguous = {
                let g = origin.live_edge.lock().unwrap();
                match g.as_ref() {
                    Some(e) => e.segments.back().is_some_and(|s| s.sn + 1 == sn),
                    None => return,
                }
            };
            if contiguous {
                match tokio::time::timeout(PREOPEN_WAIT, &mut handle).await {
                    Ok(Ok(Some((resp, pdt)))) => match origin.push_shell(sn, pdt) {
                        Some(true) => {
                            origin.notify.notify_waiters();
                            let next = tokio::spawn(preopen_next(
                                client.clone(),
                                upstream_playlist_url.clone(),
                                sn + 1,
                            ));
                            stream_response(&origin, resp, sn, gen).await;
                            if !origin.finish_segment(sn) {
                                return;
                            }
                            origin.notify.notify_waiters();
                            preopened = Some((sn + 1, next));
                            continue;
                        }
                        Some(false) => {} // refused: the poll path re-syncs
                        None => return,
                    },
                    Ok(_) => {} // preopen failed (no hint / ad window): poll path
                    Err(_) => handle.abort(), // not ready in time: poll path
                }
            }
        }

        // Re-fetch the playlist to find the current in-progress segment.
        let text = match client.get(&upstream_playlist_url).timeout(FETCH_TIMEOUT).send().await {
            Ok(r) => r.text().await.unwrap_or_default(),
            Err(e) => {
                warn!("[LLOrigin] reader playlist fetch failed: {e}");
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }
        };
        let up = parse_upstream(&text, &base);
        let last_published_sn = match up.published.last() {
            Some((sn, _, _)) => *sn,
            None => {
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }
        };
        let inprogress_sn = last_published_sn + 1;
        let inprogress_url = match up.prefetch.first() {
            Some(u) => u.clone(),
            None => {
                // Lost low-latency hints (e.g. an ad window): step back and retry.
                tokio::time::sleep(Duration::from_millis(500)).await;
                continue;
            }
        };
        // The in-progress segment's wall-clock start is the LAST PUBLISHED segment's
        // PROGRAM-DATE-TIME plus one segment duration. Reusing the published PDT
        // verbatim would anchor the freshest content a full segment in the past and
        // skew any PDT-derived latency readout by ~2s. Re-derived from upstream on
        // every poll, so the nominal-vs-real duration error never accumulates. If the
        // timestamp doesn't parse the tag is omitted; hls.js extrapolates a missing
        // PDT from the previous segment, which is exactly right.
        let pdt = up
            .published
            .last()
            .and_then(|(_, p, _)| p.as_deref())
            .and_then(advance_pdt);

        // Skip if we've already ingested this sn.
        let already = {
            let g = origin.live_edge.lock().unwrap();
            g.as_ref()
                .map(|e| e.segments.iter().any(|s| s.sn >= inprogress_sn))
                .unwrap_or(true) // gone -> stop
        };
        if origin.live_edge.lock().unwrap().is_none() {
            return;
        }
        if already {
            tokio::time::sleep(Duration::from_millis(250)).await;
            continue;
        }

        // Bring the window up to date BEFORE opening the in-progress stream. The
        // rendered window must stay CONTIGUOUS: hls.js numbers segments by POSITION
        // from #EXT-X-MEDIA-SEQUENCE, so a hole shifts every later segment's number
        // away from its `seg/<sn>.ts` URI, and as the window slides the same URI
        // changes number across refreshes, which hls.js rejects as a fatal
        // "media sequence mismatch" (live freeze, seen 2026-06-09). A hole opens
        // whenever a segment finalizes outside the reader's sight: most commonly one
        // finalizing between the activation backfill and the first poll here (a
        // segment boundary falls inside that window on most stream starts), or any
        // poll/read hiccup that makes the reader skip ahead.
        let newest_in_window = {
            let g = origin.live_edge.lock().unwrap();
            match g.as_ref() {
                Some(e) => e.segments.back().map(|s| s.sn).unwrap_or(0),
                None => return,
            }
        };
        if newest_in_window + 1 < inprogress_sn {
            let oldest_published = match up.published.first() {
                Some((sn, _, _)) => *sn,
                None => unreachable!("published is non-empty (checked above)"),
            };
            let (rebuild, fetch) = plan_catch_up(
                newest_in_window,
                oldest_published,
                inprogress_sn,
                origin.max_segments,
            );
            // Fetch every missing segment BEFORE touching the window, so a blocking
            // reload can never observe an empty or partially rebuilt playlist.
            let mut fetched: Vec<Segment> = Vec::new();
            let mut filled = true;
            for sn in fetch {
                let found = up.published.iter().find(|(s, _, _)| *s == sn);
                let Some((_, seg_pdt, url)) = found else {
                    filled = false;
                    break;
                };
                match fetch_published(&client, sn, seg_pdt.clone(), url).await {
                    Some(seg) => fetched.push(seg),
                    None => {
                        filled = false;
                        break;
                    }
                }
            }
            if !filled {
                // A catch-up fetch failed; rendering a hole would freeze the player,
                // so retry the whole poll shortly instead.
                tokio::time::sleep(Duration::from_millis(300)).await;
                continue;
            }
            {
                let mut g = origin.live_edge.lock().unwrap();
                match g.as_mut() {
                    Some(edge) => {
                        if rebuild {
                            // The hole can't be filled adjacently (it predates the
                            // upstream window, or is deeper than ours): swap in a
                            // fresh backfill from the live edge. The MEDIA-SEQUENCE
                            // jump is a legal sliding-window advance; hls.js
                            // re-anchors via PROGRAM-DATE-TIME.
                            warn!(
                                "[LLOrigin] window resync: newest held {newest_in_window}, upstream starts at {oldest_published}, in-progress {inprogress_sn}"
                            );
                            edge.segments.clear();
                        }
                        edge.segments.extend(fetched);
                        while edge.segments.len() > origin.max_segments {
                            edge.segments.pop_front();
                        }
                    }
                    None => return,
                }
            }
            origin.notify.notify_waiters();
        }

        // Create the in-progress segment shell and stream its parts in, preopening
        // the following segment's connection so the next boundary is seamless.
        match origin.push_shell(inprogress_sn, pdt) {
            Some(true) => {}
            Some(false) => continue,
            None => return,
        }
        origin.notify.notify_waiters();

        let next = tokio::spawn(preopen_next(
            client.clone(),
            upstream_playlist_url.clone(),
            inprogress_sn + 1,
        ));
        stream_segment(&origin, &client, &inprogress_url, inprogress_sn, gen).await;

        if !origin.finish_segment(inprogress_sn) {
            return;
        }
        origin.notify.notify_waiters();
        preopened = Some((inprogress_sn + 1, next));
    }
}

/// While one in-progress segment streams, open the connection for the NEXT one.
/// Twitch advertises it as a later PREFETCH hint, and the CDN holds the request
/// until that segment starts producing, so by the time the previous segment ends
/// the response is ready to read with zero ramp-up. Also returns the
/// upstream-derived PROGRAM-DATE-TIME for `next_sn`, so the reader's fast path
/// re-anchors to the playlist every segment instead of compounding
/// nominal-duration drift.
async fn preopen_next(
    client: Client,
    playlist_url: String,
    next_sn: u64,
) -> Option<(Response, Option<String>)> {
    let base = base_of(&playlist_url);
    for _ in 0..6 {
        if let Ok(r) = client.get(&playlist_url).timeout(FETCH_TIMEOUT).send().await {
            let text = r.text().await.unwrap_or_default();
            let up = parse_upstream(&text, &base);
            if let Some((last_sn, last_pdt, _)) = up.published.last() {
                // Hints are consecutive after the last published segment, so the
                // hint index for next_sn follows from their sn distance.
                let Some(idx) = next_sn.checked_sub(last_sn + 1) else {
                    // Already published: the poll path fetches it whole instead.
                    return None;
                };
                if let Some(url) = up.prefetch.get(idx as usize) {
                    let steps = (next_sn - last_sn) as i64;
                    let pdt = last_pdt.as_deref().and_then(|p| advance_pdt_by(p, steps));
                    let resp = client.get(url).send().await.ok()?;
                    return Some((resp, pdt));
                }
                // Hint not advertised yet: poll again shortly.
            }
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    None
}

/// Advance an RFC3339 PROGRAM-DATE-TIME by one nominal segment duration.
fn advance_pdt(pdt: &str) -> Option<String> {
    advance_pdt_by(pdt, 1)
}

/// Advance an RFC3339 PROGRAM-DATE-TIME by `steps` nominal segment durations.
fn advance_pdt_by(pdt: &str, steps: i64) -> Option<String> {
    let t = chrono::DateTime::parse_from_rfc3339(pdt).ok()?;
    Some((t + chrono::Duration::seconds(TARGET_DURATION as i64 * steps))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

/// Decide how the reader brings a stale window up to date before the next
/// in-progress segment. Returns `(clear_window_first, sns_to_fetch)`. The fetch
/// range is always consecutive and ends at `inprogress_sn - 1`, and when not
/// rebuilding it starts right after `window_newest`, so appending the fetched
/// segments keeps the window contiguous at every intermediate render.
fn plan_catch_up(
    window_newest: u64,
    oldest_published: u64,
    inprogress_sn: u64,
    window_cap: usize,
) -> (bool, std::ops::Range<u64>) {
    let first_missing = window_newest + 1;
    let gap = inprogress_sn.saturating_sub(first_missing);
    if first_missing < oldest_published || gap > window_cap as u64 {
        // The hole predates the upstream window, or is deeper than ours would
        // retain anyway: rebuild from the live edge with a fresh backfill.
        let start = inprogress_sn
            .saturating_sub(BACKFILL_SEGMENTS as u64)
            .max(oldest_published);
        (true, start..inprogress_sn)
    } else {
        (false, first_missing..inprogress_sn)
    }
}

/// Fetch a published segment whole and build its complete window entry.
/// Returns None on any failure (caller retries the poll).
async fn fetch_published(
    client: &Client,
    sn: u64,
    pdt: Option<String>,
    url: &str,
) -> Option<Segment> {
    let resp = match client.get(url).timeout(FETCH_TIMEOUT).send().await {
        Ok(r) => r,
        Err(e) => {
            warn!("[LLOrigin] catch-up fetch failed for sn {sn}: {e}");
            return None;
        }
    };
    let bytes = match resp.bytes().await {
        Ok(b) => b.to_vec(),
        Err(e) => {
            warn!("[LLOrigin] catch-up body read failed for sn {sn}: {e}");
            return None;
        }
    };
    let parts = split_complete(&bytes);
    if parts.is_empty() {
        warn!("[LLOrigin] catch-up segment sn {sn} produced no parts");
        return None;
    }
    Some(make_segment(sn, pdt, true, parts))
}

/// Stream one in-progress segment, publishing each completed moof+mdat as a part.
async fn stream_segment(
    origin: &LlOrigin,
    client: &Client,
    url: &str,
    sn: u64,
    gen: u64,
) {
    let resp = match client.get(url).send().await {
        Ok(r) => r,
        Err(e) => {
            warn!("[LLOrigin] in-progress GET failed for sn {sn}: {e}");
            return;
        }
    };
    stream_response(origin, resp, sn, gen).await;
}

/// Read an already-open in-progress response, publishing parts as chunks land.
async fn stream_response(origin: &LlOrigin, mut resp: Response, sn: u64, gen: u64) {
    let mut chunker = BoxChunker::new();
    loop {
        if gen != origin.generation.load(Ordering::SeqCst) {
            return;
        }
        match tokio::time::timeout(CHUNK_TIMEOUT, resp.chunk()).await {
            Ok(Ok(Some(bytes))) => {
                for part in chunker.push(&bytes) {
                    if !origin.append_part(sn, part) {
                        return; // edge gone
                    }
                    origin.notify.notify_waiters();
                }
            }
            Ok(Ok(None)) => break, // segment complete
            Ok(Err(e)) => {
                warn!("[LLOrigin] in-progress read error for sn {sn}: {e}");
                break;
            }
            Err(_) => {
                warn!("[LLOrigin] in-progress read timed out for sn {sn}");
                break;
            }
        }
    }
    if let Some(tail) = chunker.flush() {
        if origin.append_part(sn, tail) {
            origin.notify.notify_waiters();
        }
    }
}

impl LlOrigin {
    /// Append the in-progress segment shell. Returns `None` if the edge is gone,
    /// `Some(false)` if appending would break window contiguity (refused; the
    /// reader's catch-up should make that impossible), `Some(true)` on success.
    fn push_shell(&self, sn: u64, pdt: Option<String>) -> Option<bool> {
        let mut g = self.live_edge.lock().unwrap();
        let edge = g.as_mut()?;
        if edge.segments.back().is_some_and(|s| s.sn + 1 != sn) {
            warn!("[LLOrigin] refusing non-contiguous shell sn {sn}");
            return Some(false);
        }
        edge.segments.push_back(Segment {
            sn,
            pdt,
            complete: false,
            duration: TARGET_DURATION as f64,
            parts: Vec::new(),
        });
        while edge.segments.len() > self.max_segments {
            edge.segments.pop_front();
        }
        Some(true)
    }

    /// Mark `sn` complete and normalize part durations now that the count is
    /// known. Returns false if the edge is gone.
    fn finish_segment(&self, sn: u64) -> bool {
        let mut g = self.live_edge.lock().unwrap();
        match g.as_mut() {
            Some(edge) => {
                if let Some(seg) = edge.segments.iter_mut().find(|s| s.sn == sn) {
                    seg.complete = true;
                    let count = seg.parts.len().max(1);
                    let dur = TARGET_DURATION as f64 / count as f64;
                    for p in seg.parts.iter_mut() {
                        p.duration = dur;
                    }
                }
                true
            }
            None => false,
        }
    }

    /// Append a part to the segment with `sn`. Returns false if the edge is gone.
    fn append_part(&self, sn: u64, bytes: Vec<u8>) -> bool {
        let mut g = self.live_edge.lock().unwrap();
        match g.as_mut() {
            Some(edge) => {
                if let Some(seg) = edge.segments.iter_mut().find(|s| s.sn == sn) {
                    seg.parts.push(Part {
                        duration: NOMINAL_PART_DUR,
                        bytes: Arc::new(bytes),
                    });
                }
                true
            }
            None => false,
        }
    }
}

// ──────────────────────────── serving ────────────────────────────

fn has_part_locked(edge: &LiveEdge, sn: u64, part: u64) -> bool {
    edge.segments
        .iter()
        .any(|s| s.sn == sn && (s.parts.len() as u64) > part)
}

/// Whether a blocking reload for `(sn, part)` can be released. Beyond the plain
/// "that part exists" case, the LL-HLS spec requires a request for a part index
/// past the final part of a COMPLETED segment to be treated as a request for part
/// 0 of the FOLLOWING segment. The client's boundary request (last seen sn, final
/// part index + 1) can only ever be satisfied through that rule; without it every
/// segment hand-off burned a full blocking hold.
fn blocking_satisfied(edge: &LiveEdge, sn: u64, part: u64) -> bool {
    if has_part_locked(edge, sn, part) {
        return true;
    }
    edge.segments
        .iter()
        .any(|s| s.sn == sn && s.complete && (s.parts.len() as u64) <= part)
        && has_part_locked(edge, sn + 1, 0)
}

impl LlOrigin {
    /// Serve the LL-HLS playlist, honoring a blocking reload for `(msn, part)`.
    pub async fn serve_playlist(&self, msn: Option<u64>, part: Option<u64>) -> Option<String> {
        if let (Some(m), Some(p)) = (msn, part) {
            let deadline = tokio::time::Instant::now() + BLOCK_TIMEOUT;
            loop {
                {
                    let g = self.live_edge.lock().unwrap();
                    match g.as_ref() {
                        Some(edge) if blocking_satisfied(edge, m, p) => break,
                        Some(_) => {}
                        None => return None,
                    }
                }
                // Register interest, then re-check (closes the notify race), then wait.
                let notified = self.notify.notified();
                {
                    let g = self.live_edge.lock().unwrap();
                    match g.as_ref() {
                        Some(edge) if blocking_satisfied(edge, m, p) => break,
                        Some(_) => {}
                        None => return None,
                    }
                }
                let now = tokio::time::Instant::now();
                if now >= deadline {
                    break;
                }
                if tokio::time::timeout(deadline - now, notified).await.is_err() {
                    break;
                }
            }
        }
        let g = self.live_edge.lock().unwrap();
        g.as_ref().map(render_locked)
    }
}

fn render_locked(edge: &LiveEdge) -> String {
    let mut s = String::with_capacity(2048);
    s.push_str("#EXTM3U\n#EXT-X-VERSION:9\n");
    s.push_str(&format!("#EXT-X-TARGETDURATION:{}\n", edge.target_duration));
    s.push_str(&format!("#EXT-X-PART-INF:PART-TARGET={:.3}\n", edge.part_target));
    s.push_str("#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.500\n");
    let media_seq = edge.segments.front().map(|s| s.sn).unwrap_or(0);
    s.push_str(&format!("#EXT-X-MEDIA-SEQUENCE:{media_seq}\n"));
    s.push_str(&format!("#EXT-X-MAP:URI=\"{}\"\n", edge.init_url));
    let n = edge.segments.len();
    for (i, seg) in edge.segments.iter().enumerate() {
        if let Some(pdt) = &seg.pdt {
            s.push_str(&format!("#EXT-X-PROGRAM-DATE-TIME:{pdt}\n"));
        }
        // List parts for the last THREE segments. A client can still be mid-way
        // through the previous segment's parts when the next one starts; removing
        // parts it hasn't fetched yet forces it to drop that tail on the floor
        // (observed live as a ~0.2-0.3s buffer hole + bufferSeekOverHole at segment
        // boundaries when only two were listed). Spec guidance: keep parts listed
        // until they are at least three target durations from the edge. Older
        // complete segments are fetched whole.
        if i + 3 >= n {
            for (k, p) in seg.parts.iter().enumerate() {
                // Only part 0 of a segment is independently decodable (Twitch segments
                // are GOP-aligned: part 0 carries the IDR keyframe, parts 1+ are
                // P-frames). Marking a P-frame part INDEPENDENT would let hls.js start
                // decoding mid-GOP — garbage frames, clock doesn't advance, looks like a
                // stall. With only part 0 marked, hls.js starts at a real keyframe.
                let independent = if k == 0 { ",INDEPENDENT=YES" } else { "" };
                s.push_str(&format!(
                    "#EXT-X-PART:DURATION={:.3},URI=\"part/{}/{}.mp4\"{}\n",
                    p.duration, seg.sn, k, independent
                ));
            }
        }
        // A complete segment renders its EXTINF only once a SUCCESSOR exists in the
        // window. Flipping a segment from in-progress to complete in the same
        // refresh that first reveals its final part lets the client decide the
        // segment is done before fetching that part and advance past it, leaving a
        // one-part (~85-105ms) hole in its buffer at the boundary (observed live
        // 2026-06-09 as repeating bufferStalledError + bufferSeekOverHole pairs).
        // Deferring the EXTINF guarantees at least one refresh in which the final
        // part is visible on a still-in-progress segment. The lone-segment
        // exception keeps a minimal window startable.
        if seg.complete && (i + 1 < n || n == 1) {
            s.push_str(&format!("#EXTINF:{:.3},live\nseg/{}.ts\n", seg.duration, seg.sn));
        }
    }
    s
}

impl LlOrigin {
    /// Bytes for a single part (`part/<sn>/<k>.mp4`).
    pub fn get_part(&self, sn: u64, idx: usize) -> Option<Arc<Vec<u8>>> {
        let g = self.live_edge.lock().unwrap();
        let edge = g.as_ref()?;
        let seg = edge.segments.iter().find(|s| s.sn == sn)?;
        seg.parts.get(idx).map(|p| p.bytes.clone())
    }

    /// Bytes for a complete segment (`seg/<sn>.ts`), assembled from its parts in memory.
    pub fn get_segment(&self, sn: u64) -> Option<Vec<u8>> {
        let g = self.live_edge.lock().unwrap();
        let edge = g.as_ref()?;
        let seg = edge.segments.iter().find(|s| s.sn == sn && s.complete)?;
        let total: usize = seg.parts.iter().map(|p| p.bytes.len()).sum();
        let mut out = Vec::with_capacity(total);
        for p in &seg.parts {
            out.extend_from_slice(&p.bytes);
        }
        Some(out)
    }
}

// ──────────────────────────── solo facade ────────────────────────────

/// The solo player's shared instance (one solo stream at a time). MultiNook tiles
/// each construct their own origin via `LlOrigin::new`; these functions keep the
/// solo relay's call sites on a single global origin.
static SOLO: Lazy<Arc<LlOrigin>> = Lazy::new(|| LlOrigin::new(MAX_SEGMENTS));

pub fn is_active() -> bool {
    SOLO.is_active()
}

pub fn stop() {
    SOLO.stop()
}

pub async fn start(upstream_playlist_url: String) -> bool {
    SOLO.clone().start(upstream_playlist_url).await
}

pub async fn serve_playlist(msn: Option<u64>, part: Option<u64>) -> Option<String> {
    SOLO.serve_playlist(msn, part).await
}

pub fn get_part(sn: u64, idx: usize) -> Option<Arc<Vec<u8>>> {
    SOLO.get_part(sn, idx)
}

pub fn get_segment(sn: u64) -> Option<Vec<u8>> {
    SOLO.get_segment(sn)
}

// ──────────────────────────── relay routing helpers ────────────────────────────
// Shared by both relays (`stream_server`, `multi_nook_server`) so their LL-HLS
// routes stay byte-identical.

/// Optional raw query-string filter: yields the query string, or empty if absent.
pub(crate) fn opt_raw_query() -> warp::filters::BoxedFilter<(String,)> {
    use warp::Filter;
    warp::query::raw()
        .or(warp::any().map(String::new))
        .unify()
        .boxed()
}

/// Parse a numeric LL-HLS directive (`_HLS_msn` / `_HLS_part`) from a raw query string.
pub(crate) fn parse_directive(query: &str, key: &str) -> Option<u64> {
    query.split('&').find_map(|pair| {
        let mut it = pair.splitn(2, '=');
        if it.next() == Some(key) {
            it.next().and_then(|v| v.parse().ok())
        } else {
            None
        }
    })
}

/// Parse `part/<sn>/<k>.mp4` -> (sn, k).
pub(crate) fn parse_part_path(rest: &str) -> Option<(u64, usize)> {
    let rest = rest.strip_suffix(".mp4").unwrap_or(rest);
    let mut it = rest.splitn(2, '/');
    let sn = it.next()?.parse().ok()?;
    let k = it.next()?.parse().ok()?;
    Some((sn, k))
}

pub(crate) fn media_response(bytes: Vec<u8>) -> warp::http::Response<Vec<u8>> {
    warp::http::Response::builder()
        .status(200)
        .header("Content-Type", "video/mp4")
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, OPTIONS")
        .header("Access-Control-Allow-Headers", "*")
        .header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
        .body(bytes)
        .unwrap()
}

pub(crate) fn playlist_response(bytes: Vec<u8>) -> warp::http::Response<Vec<u8>> {
    warp::http::Response::builder()
        .status(200)
        .header("Content-Type", "application/x-mpegURL")
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, OPTIONS")
        .header("Access-Control-Allow-Headers", "*")
        .header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
        .body(bytes)
        .unwrap()
}

pub(crate) fn empty_cors(status: u16) -> warp::http::Response<Vec<u8>> {
    warp::http::Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .body(vec![])
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a fake CMAF byte stream: a leading emsg, then `n` moof+mdat pairs.
    fn make_box(typ: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let size = (8 + payload.len()) as u32;
        let mut b = Vec::new();
        b.extend_from_slice(&size.to_be_bytes());
        b.extend_from_slice(typ);
        b.extend_from_slice(payload);
        b
    }

    fn fake_segment(n: usize) -> (Vec<u8>, Vec<Vec<u8>>) {
        let mut full = Vec::new();
        let emsg = make_box(b"emsg", b"meta");
        full.extend_from_slice(&emsg);
        let mut expected_parts: Vec<Vec<u8>> = Vec::new();
        for i in 0..n {
            let moof = make_box(b"moof", &[i as u8; 12]);
            let mdat = make_box(b"mdat", &[i as u8; 40]);
            let mut part = Vec::new();
            if i == 0 {
                part.extend_from_slice(&emsg); // leading emsg rides with the first part
            }
            part.extend_from_slice(&moof);
            part.extend_from_slice(&mdat);
            expected_parts.push(part);
            full.extend_from_slice(&moof);
            full.extend_from_slice(&mdat);
        }
        (full, expected_parts)
    }

    #[test]
    fn chunker_splits_on_moof_mdat_pairs() {
        let (full, expected) = fake_segment(19);
        let parts = split_complete(&full);
        assert_eq!(parts.len(), 19);
        assert_eq!(parts, expected);
        // Parts reassemble into the original byte stream exactly.
        let rejoined: Vec<u8> = parts.concat();
        assert_eq!(rejoined, full);
    }

    #[test]
    fn chunker_handles_split_across_feeds() {
        // Feed the stream one byte at a time; parts must still come out identical.
        let (full, expected) = fake_segment(5);
        let mut chunker = BoxChunker::new();
        let mut got: Vec<Vec<u8>> = Vec::new();
        for byte in &full {
            got.extend(chunker.push(&[*byte]));
        }
        if let Some(tail) = chunker.flush() {
            got.push(tail);
        }
        assert_eq!(got, expected);
    }

    #[test]
    fn parse_upstream_reads_segments_prefetch_and_map() {
        let pl = "#EXTM3U\n\
#EXT-X-TARGETDURATION:2\n\
#EXT-X-MEDIA-SEQUENCE:100\n\
#EXT-X-MAP:URI=\"https://cdn/init.mp4\"\n\
#EXT-X-PROGRAM-DATE-TIME:2026-06-09T03:02:33.166Z\n\
#EXTINF:2.000,live\nhttps://cdn/a100.mp4\n\
#EXTINF:2.000,live\nhttps://cdn/a101.mp4\n\
#EXT-X-TWITCH-PREFETCH:https://cdn/a102.mp4\n\
#EXT-X-TWITCH-PREFETCH:https://cdn/a103.mp4\n";
        let up = parse_upstream(pl, "https://cdn/");
        assert_eq!(up.init_url.as_deref(), Some("https://cdn/init.mp4"));
        assert_eq!(up.published.len(), 2);
        assert_eq!(up.published[0].0, 100);
        assert_eq!(up.published[1].0, 101);
        assert_eq!(up.published[0].1.as_deref(), Some("2026-06-09T03:02:33.166Z"));
        assert_eq!(up.prefetch, vec!["https://cdn/a102.mp4", "https://cdn/a103.mp4"]);
    }

    #[test]
    fn catch_up_fills_a_small_hole_adjacently() {
        // The startup race: backfill held ..8551, segment 8552 finalized before the
        // first poll, in-progress is 8553. The plan must fetch exactly 8552 without
        // clearing, so the window never renders a hole.
        let (rebuild, fetch) = plan_catch_up(8551, 8540, 8553, 6);
        assert!(!rebuild);
        assert_eq!(fetch.collect::<Vec<_>>(), vec![8552]);
    }

    #[test]
    fn catch_up_rebuilds_when_hole_is_unfillable_or_deep() {
        // Hole predates the upstream window: rebuild with a fresh backfill ending at
        // the in-progress segment.
        let (rebuild, fetch) = plan_catch_up(8500, 8540, 8553, 6);
        assert!(rebuild);
        assert_eq!(fetch.collect::<Vec<_>>(), vec![8551, 8552]);

        // Hole deeper than the window: rebuilding beats fetching doomed segments.
        let (rebuild, fetch) = plan_catch_up(8540, 8530, 8553, 6);
        assert!(rebuild);
        assert_eq!(fetch.collect::<Vec<_>>(), vec![8551, 8552]);

        // Empty window (newest sentinel 0) behaves like a rebuild too.
        let (rebuild, fetch) = plan_catch_up(0, 8546, 8553, 4);
        assert!(rebuild);
        assert_eq!(fetch.collect::<Vec<_>>(), vec![8551, 8552]);
    }

    #[test]
    fn newest_complete_segment_defers_extinf_until_successor() {
        // 101 is internally complete but has no successor yet: it must render as
        // still-in-progress (parts only), so a client never learns "complete" in
        // the same refresh that first shows the final part.
        let mut segs = VecDeque::new();
        segs.push_back(make_segment(100, None, true, vec![vec![1], vec![2]]));
        segs.push_back(make_segment(101, None, true, vec![vec![3], vec![4]]));
        let edge = LiveEdge {
            init_url: "https://cdn/init.mp4".into(),
            target_duration: 2,
            part_target: PART_TARGET,
            segments: segs,
        };
        let pl = render_locked(&edge);
        assert!(pl.contains("seg/100.ts"));
        assert!(!pl.contains("seg/101.ts"));
        assert!(pl.contains("part/101/1.mp4"));

        // A lone complete segment still renders EXTINF (a playlist with zero
        // complete segments cannot start playback).
        let mut lone = VecDeque::new();
        lone.push_back(make_segment(100, None, true, vec![vec![1]]));
        let edge = LiveEdge {
            init_url: "https://cdn/init.mp4".into(),
            target_duration: 2,
            part_target: PART_TARGET,
            segments: lone,
        };
        assert!(render_locked(&edge).contains("seg/100.ts"));
    }

    #[test]
    fn boundary_blocking_request_rolls_to_next_segment() {
        let mut segs = VecDeque::new();
        segs.push_back(make_segment(100, None, true, vec![vec![1], vec![2]]));
        segs.push_back(Segment {
            sn: 101,
            pdt: None,
            complete: false,
            duration: 2.0,
            parts: vec![Part { duration: 0.1, bytes: Arc::new(vec![3]) }],
        });
        let edge = LiveEdge {
            init_url: "https://cdn/init.mp4".into(),
            target_duration: 2,
            part_target: PART_TARGET,
            segments: segs,
        };
        // Plain existing-part requests.
        assert!(blocking_satisfied(&edge, 100, 1));
        assert!(blocking_satisfied(&edge, 101, 0));
        // Beyond the final part of COMPLETE 100: rolls to part 0 of 101 (spec rule).
        assert!(blocking_satisfied(&edge, 100, 2));
        // Beyond the newest part of the still-in-progress 101: must keep blocking.
        assert!(!blocking_satisfied(&edge, 101, 1));
    }

    #[test]
    fn render_always_has_extinf_and_lists_edge_parts() {
        let mut segs = VecDeque::new();
        segs.push_back(make_segment(99, Some("PDT9".into()), true, vec![vec![0], vec![9]]));
        segs.push_back(make_segment(100, Some("PDT0".into()), true, vec![vec![1], vec![2]]));
        segs.push_back(make_segment(101, Some("PDT1".into()), true, vec![vec![3], vec![4]]));
        // in-progress segment with 3 parts, not complete
        segs.push_back(Segment {
            sn: 102,
            pdt: Some("PDT2".into()),
            complete: false,
            duration: 2.0,
            parts: vec![
                Part { duration: 0.1, bytes: Arc::new(vec![5]) },
                Part { duration: 0.1, bytes: Arc::new(vec![6]) },
                Part { duration: 0.1, bytes: Arc::new(vec![7]) },
            ],
        });
        let edge = LiveEdge {
            init_url: "https://cdn/init.mp4".into(),
            target_duration: 2,
            part_target: PART_TARGET,
            segments: segs,
        };
        let pl = render_locked(&edge);
        assert!(pl.contains("#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES"));
        assert!(pl.contains("#EXT-X-PART-INF:PART-TARGET="));
        assert!(pl.contains("#EXT-X-MEDIA-SEQUENCE:99"));
        assert!(pl.contains("#EXT-X-MAP:URI=\"https://cdn/init.mp4\""));
        // At least one complete segment (avoids "not enough fragments").
        assert!(pl.contains("#EXTINF:"));
        assert!(pl.contains("seg/100.ts"));
        // The last THREE segments list parts (a client may still be mid-way through
        // the previous segment's parts when a new one starts); older ones do not.
        assert!(pl.contains("part/102/0.mp4"));
        assert!(pl.contains("part/101/0.mp4"));
        assert!(pl.contains("part/100/0.mp4"));
        assert!(!pl.contains("part/99/0.mp4"));
        // In-progress segment has no EXTINF yet.
        assert!(!pl.contains("seg/102.ts"));
        // has_part: the in-progress segment exposes its 3 parts.
        assert!(has_part_locked(&edge, 102, 2));
        assert!(!has_part_locked(&edge, 102, 3));
    }
}
