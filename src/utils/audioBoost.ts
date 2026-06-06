// Optional audio processing for the stream player. The graph is:
//
//   <video> -> MediaElementSource -> DynamicsCompressor -> Gain -> destination
//
// The compressor levels out loud and quiet moments; the gain stage then pushes
// the whole signal louder than the source without the harsh clipping you'd get
// from simply raising volume past 100% (the peaks are already tamed). When the
// feature is off, the element routes straight through (source -> destination),
// which is sonically transparent.
//
// Two hard rules of the Web Audio API shape this module:
//   1. An element can be tapped exactly once for its lifetime. A second
//      createMediaElementSource() on the same element throws, so the per-element
//      graph is memoized and reused (see `graphs`).
//   2. Once an element is tapped, it only makes sound if the source reaches the
//      destination. So "off" is an explicit source -> destination passthrough,
//      not a disconnect.
//
// Because of rule 1, the element is never tapped until the feature has been
// enabled at least once: while it has always been off, this module leaves
// playback completely untouched.

import { Logger } from './logger';
import type { AudioBoostSettings } from '../types';
import { DEFAULT_AUDIO_BOOST } from '../types';

interface MediaGraph {
  source: MediaElementAudioSourceNode;
  compressor: DynamicsCompressorNode;
  gain: GainNode;
}

// One shared context for stream-audio processing across the app's lifetime.
// Browsers cap the number of AudioContexts, and there is only ever one stream
// element to process at a time, so we never spin up a context per stream.
let sharedCtx: AudioContext | null = null;

// Per-element graphs, keyed weakly so a discarded element can be collected.
const graphs = new WeakMap<HTMLMediaElement, MediaGraph>();

const clamp = (v: number, min: number, max: number) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min;

function getCtx(): AudioContext | null {
  if (sharedCtx) return sharedCtx;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedCtx = new Ctor();
  } catch (e) {
    Logger.warn('[AudioBoost] Could not create AudioContext:', e);
    return null;
  }
  return sharedCtx;
}

function getOrCreateGraph(video: HTMLMediaElement): MediaGraph | null {
  const existing = graphs.get(video);
  if (existing) return existing;

  const ctx = getCtx();
  if (!ctx) return null;

  let source: MediaElementAudioSourceNode;
  try {
    source = ctx.createMediaElementSource(video);
  } catch (e) {
    // Already tapped, or the element can't be routed. Leave playback untouched.
    Logger.warn('[AudioBoost] createMediaElementSource failed:', e);
    return null;
  }

  const graph: MediaGraph = {
    source,
    compressor: ctx.createDynamicsCompressor(),
    gain: ctx.createGain(),
  };
  graphs.set(video, graph);
  return graph;
}

// Fill in any missing fields from the defaults so callers can pass a possibly
// partial / undefined settings object straight from persisted state.
export function resolveAudioBoost(
  cfg: AudioBoostSettings | undefined | null,
): AudioBoostSettings {
  return { ...DEFAULT_AUDIO_BOOST, ...(cfg ?? {}) };
}

/**
 * Route the player's audio through the compressor + makeup-gain chain when
 * enabled, or straight through when not. Idempotent: safe to call on every
 * settings change and after every stream swap (the <video> element persists, so
 * its one-time tap stays valid). A no-op while the feature has never been on.
 */
export function applyAudioBoost(
  video: HTMLMediaElement | null,
  cfg: AudioBoostSettings,
): void {
  if (!video) return;
  // Do no harm until the feature has actually been turned on at least once.
  if (!cfg.enabled && !graphs.has(video)) return;

  const graph = getOrCreateGraph(video);
  if (!graph) return;
  const ctx = sharedCtx;
  if (!ctx) return;

  // A suspended context outputs silence (autoplay policy). This runs from a
  // settings toggle or a play event, both user gestures, so resume succeeds.
  if (ctx.state === 'suspended') void ctx.resume();

  const { source, compressor, gain } = graph;
  const t = ctx.currentTime;
  compressor.threshold.setValueAtTime(clamp(cfg.threshold, -100, 0), t);
  compressor.knee.setValueAtTime(clamp(cfg.knee, 0, 40), t);
  compressor.ratio.setValueAtTime(clamp(cfg.ratio, 1, 20), t);
  compressor.attack.setValueAtTime(clamp(cfg.attack, 0, 1), t);
  compressor.release.setValueAtTime(clamp(cfg.release, 0, 1), t);
  gain.gain.setValueAtTime(clamp(cfg.gain, 0, 4), t);

  // Rewire from scratch so toggling never stacks duplicate connections.
  try {
    source.disconnect();
  } catch {
    /* not connected yet */
  }
  try {
    compressor.disconnect();
  } catch {
    /* not connected yet */
  }
  try {
    gain.disconnect();
  } catch {
    /* not connected yet */
  }

  if (cfg.enabled) {
    source.connect(compressor);
    compressor.connect(gain);
    gain.connect(ctx.destination);
  } else {
    // Transparent passthrough (see rule 2 above).
    source.connect(ctx.destination);
  }
}

// ---------------------------------------------------------------------------
// UI descriptors. Kept here (not in the .tsx that renders them) so the shared
// fader component file only exports components. One descriptor per adjustable
// parameter, in display order: Boost (makeup gain) first, then the five
// compressor controls. `value`/`display` are pre-converted for the UI
// (attack/release shown in ms) and `apply` converts back to storage.
// ---------------------------------------------------------------------------

export interface AudioBoostFaderDef {
  key: keyof AudioBoostSettings;
  label: string;
  display: string;
  value: number;
  min: number;
  max: number;
  step: number;
  hint: string;
  apply: (v: number) => Partial<AudioBoostSettings>;
}

export const audioBoostFaderDefs = (b: AudioBoostSettings): AudioBoostFaderDef[] => [
  {
    key: 'gain',
    label: 'Boost',
    value: b.gain,
    display: `${Math.round(b.gain * 100)}%`,
    min: 1,
    max: 3,
    step: 0.05,
    hint: 'How much louder to make the stream after compression. 100% is no extra boost; higher is louder.',
    apply: (v) => ({ gain: v }),
  },
  {
    key: 'threshold',
    label: 'Threshold',
    value: b.threshold,
    display: `${Math.round(b.threshold)} dB`,
    min: -100,
    max: 0,
    step: 1,
    hint: 'The level where compression kicks in. Lower catches more of the audio.',
    apply: (v) => ({ threshold: v }),
  },
  {
    key: 'ratio',
    label: 'Ratio',
    value: b.ratio,
    display: `${b.ratio.toFixed(1)}:1`,
    min: 1,
    max: 20,
    step: 0.5,
    hint: 'How hard to compress once over the threshold. Higher is more aggressive leveling.',
    apply: (v) => ({ ratio: v }),
  },
  {
    key: 'knee',
    label: 'Knee',
    value: b.knee,
    display: `${Math.round(b.knee)} dB`,
    min: 0,
    max: 40,
    step: 1,
    hint: 'How gradually compression eases in around the threshold. Higher is smoother.',
    apply: (v) => ({ knee: v }),
  },
  {
    key: 'attack',
    label: 'Attack',
    value: Math.round(b.attack * 1000),
    display: `${Math.round(b.attack * 1000)} ms`,
    min: 0,
    max: 200,
    step: 1,
    hint: 'How quickly it clamps down on a sudden loud sound.',
    apply: (v) => ({ attack: v / 1000 }),
  },
  {
    key: 'release',
    label: 'Release',
    value: Math.round(b.release * 1000),
    display: `${Math.round(b.release * 1000)} ms`,
    min: 0,
    max: 1000,
    step: 10,
    hint: 'How quickly it eases back off once things get quieter.',
    apply: (v) => ({ release: v / 1000 }),
  },
];

// All adjustable params (Boost + the five compressor controls) reset to
// defaults; the on/off state is left as-is.
export const audioBoostResetPatch = (): Partial<AudioBoostSettings> => ({
  gain: DEFAULT_AUDIO_BOOST.gain,
  threshold: DEFAULT_AUDIO_BOOST.threshold,
  knee: DEFAULT_AUDIO_BOOST.knee,
  ratio: DEFAULT_AUDIO_BOOST.ratio,
  attack: DEFAULT_AUDIO_BOOST.attack,
  release: DEFAULT_AUDIO_BOOST.release,
});
