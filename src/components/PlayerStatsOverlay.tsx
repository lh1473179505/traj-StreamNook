import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import type Hls from 'hls.js';
import { Activity, Radio, X } from 'lucide-react';

// Live playback telemetry overlay (the "behind live" + FPS readout). Reads hls.js
// and the <video> element directly each second while open, so it costs nothing
// when collapsed. The latency figure is measured to the live edge hls.js can see
// (the last fully-published segment). Twitch's prefetch segments sit ahead of that
// edge and hls.js doesn't consume them yet, so this reads to the published edge.
// It becomes true-live once the relay promotes prefetch segments.

interface AdSourceLike {
  mode?: string;
  entitled?: boolean;
  region?: string | null;
}

interface Metrics {
  latency: number | null;
  resolution: string | null;
  fps: number | null;
  bitrateMbps: number | null;
  bandwidthMbps: number | null;
  bufferSec: number | null;
  dropped: number;
  droppedPct: number | null;
}

const EMPTY: Metrics = {
  latency: null,
  resolution: null,
  fps: null,
  bitrateMbps: null,
  bandwidthMbps: null,
  bufferSec: null,
  dropped: 0,
  droppedPct: null,
};

function readMetrics(hls: Hls | null, video: HTMLVideoElement | null): Metrics {
  const m: Metrics = { ...EMPTY };

  if (video) {
    try {
      const b = video.buffered;
      if (b.length > 0) m.bufferSec = Math.max(0, b.end(b.length - 1) - video.currentTime);
    } catch {
      /* buffered can throw if the element is mid-teardown */
    }
    try {
      const q = video.getVideoPlaybackQuality?.();
      if (q) {
        m.dropped = q.droppedVideoFrames;
        if (q.totalVideoFrames > 0) {
          m.droppedPct = (q.droppedVideoFrames / q.totalVideoFrames) * 100;
        }
      }
    } catch {
      /* not all engines expose playback quality */
    }
  }

  if (hls) {
    const lvlIndex = hls.currentLevel >= 0 ? hls.currentLevel : hls.loadLevel;
    const lvl = lvlIndex >= 0 ? hls.levels?.[lvlIndex] : undefined;
    if (lvl) {
      if (lvl.height) m.resolution = `${lvl.height}p`;
      if (lvl.bitrate) m.bitrateMbps = lvl.bitrate / 1_000_000;
      const fr = (lvl.attrs as Record<string, string> | undefined)?.['FRAME-RATE'];
      const frn = fr ? parseFloat(fr) : NaN;
      if (Number.isFinite(frn)) m.fps = Math.round(frn);
    }
    if (typeof hls.bandwidthEstimate === 'number' && hls.bandwidthEstimate > 0) {
      m.bandwidthMbps = hls.bandwidthEstimate / 1_000_000;
    }
    // Prefer hls.js's own latency tracker; fall back to (live edge - playhead).
    let lat: number | null = null;
    if (typeof hls.latency === 'number' && hls.latency > 0) {
      lat = hls.latency;
    } else if (lvl?.details && video) {
      const edge = lvl.details.edge;
      if (Number.isFinite(edge)) lat = Math.max(0, edge - video.currentTime);
    }
    m.latency = lat;
  }

  return m;
}

function latencyClass(latency: number | null): string {
  if (latency == null) return 'text-textPrimary';
  if (latency <= 4) return 'text-emerald-400';
  if (latency <= 8) return 'text-amber-400';
  return 'text-red-400';
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-textSecondary">{label}</span>
      <span className={`font-medium tabular-nums ${valueClass ?? 'text-textPrimary'}`}>{value}</span>
    </div>
  );
}

interface Props {
  hlsRef: RefObject<Hls | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Whether the panel is open. Toggled from the Plyr settings menu's "Stats" item. */
  open: boolean;
  onToggle: () => void;
  onGoLive: () => void;
  adSource?: AdSourceLike | null;
}

const PlayerStatsOverlay = ({ hlsRef, videoRef, open, onToggle, onGoLive, adSource }: Props) => {
  const [metrics, setMetrics] = useState<Metrics>(EMPTY);

  useEffect(() => {
    if (!open) return;
    const tick = () => setMetrics(readMetrics(hlsRef.current, videoRef.current));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [open, hlsRef, videoRef]);

  // Opened from the Plyr settings menu ("Stats"); closed via the panel's X.
  if (!open) return null;

  const sourceLabel = adSource
    ? adSource.entitled
      ? adSource.mode === 'turbo'
        ? 'Turbo (direct)'
        : 'Sub (direct)'
      : adSource.mode === 'auth-only'
        ? 'Direct (ads)'
        : `Proxy${adSource.region ? ` ${adSource.region}` : ''}`
    : null;

  const showGoLive = metrics.latency != null && metrics.latency > 5;

  return (
    <div className="absolute bottom-16 left-4 z-50 w-52 pointer-events-auto">
      <div className="glass-panel rounded-lg border border-white/10 bg-background/85 backdrop-blur-md px-3 py-2.5 text-xs">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <Activity size={13} className="text-accent" />
            <span className="text-textPrimary font-semibold tracking-wide">Stream Stats</span>
          </div>
          <button onClick={onToggle} aria-label="Close stats" className="text-textSecondary hover:text-textPrimary transition-colors">
            <X size={13} />
          </button>
        </div>

        <div className="space-y-1">
          <Row
            label="Behind live"
            value={metrics.latency != null ? `${metrics.latency.toFixed(1)}s` : '-'}
            valueClass={latencyClass(metrics.latency)}
          />
          <Row
            label="Resolution"
            value={metrics.resolution ? `${metrics.resolution}${metrics.fps ? metrics.fps : ''}` : '-'}
          />
          <Row label="Dropped" value={`${metrics.dropped}${metrics.droppedPct != null ? ` (${metrics.droppedPct.toFixed(2)}%)` : ''}`} />
          <Row label="Video bitrate" value={metrics.bitrateMbps != null ? `${metrics.bitrateMbps.toFixed(1)} Mbps` : '-'} />
          <Row label="Bandwidth" value={metrics.bandwidthMbps != null ? `${metrics.bandwidthMbps.toFixed(1)} Mbps` : '-'} />
          <Row label="Buffer" value={metrics.bufferSec != null ? `${metrics.bufferSec.toFixed(1)}s` : '-'} />
          {sourceLabel && <Row label="Source" value={sourceLabel} />}
        </div>

        {showGoLive && (
          <button
            onClick={onGoLive}
            className="mt-2.5 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md glass-button text-white font-medium hover:bg-white/10 transition-colors"
            style={{ backdropFilter: 'blur(16px)' }}
          >
            <Radio size={13} className="text-red-400" />
            Go Live
          </button>
        )}
      </div>
    </div>
  );
};

export default PlayerStatsOverlay;
