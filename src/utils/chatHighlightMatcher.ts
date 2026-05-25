import type { HighlightPhrase, HighlightUser, HighlightBadge } from '../types';
import type { SoundId } from './notificationSound';

export interface HighlightMatch {
  phrase_id: string;
  color: string;
  sound_id: SoundId | null;
  cooldown_ms: number;
}

interface CompiledPhrase {
  id: string;
  color: string;
  sound_id: SoundId | null;
  cooldown_ms: number;
  regex: RegExp | null;
}

const VALID_SOUND_IDS: ReadonlySet<SoundId> = new Set<SoundId>([
  'boop',
  'tick',
  'soft',
  'whisper',
  'gentle',
]);

function normalizeSoundId(raw: string | null | undefined): SoundId | null {
  if (!raw) return null;
  return VALID_SOUND_IDS.has(raw as SoundId) ? (raw as SoundId) : null;
}

const DEFAULT_COOLDOWN_SECONDS = 3;

// Compiled phrases are cached against the phrases-array reference. AppStore
// produces a new array on every settings update, so the cache invalidates
// naturally without needing explicit invalidation hooks.
const compileCache = new WeakMap<HighlightPhrase[], CompiledPhrase[]>();

const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;

function escapeForRegex(input: string): string {
  return input.replace(REGEX_ESCAPE, '\\$&');
}

function buildRegex(phrase: HighlightPhrase): RegExp | null {
  if (!phrase.pattern.trim()) return null;
  const flags = phrase.case_sensitive ? '' : 'i';
  try {
    if (phrase.is_regex) {
      return new RegExp(phrase.pattern, flags);
    }
    const escaped = escapeForRegex(phrase.pattern);
    const source = phrase.whole_word ? `\\b${escaped}\\b` : escaped;
    return new RegExp(source, flags);
  } catch {
    // Invalid user regex — phrase is silently inert. The settings UI surfaces
    // the error to the user; the parse path should never throw.
    return null;
  }
}

function compile(phrases: HighlightPhrase[]): CompiledPhrase[] {
  const cached = compileCache.get(phrases);
  if (cached) return cached;
  const compiled: CompiledPhrase[] = phrases.map((p) => ({
    id: p.id,
    color: p.color,
    sound_id: normalizeSoundId(p.sound_id),
    cooldown_ms: Math.max(0, (p.cooldown_seconds ?? DEFAULT_COOLDOWN_SECONDS) * 1000),
    regex: p.enabled ? buildRegex(p) : null,
  }));
  compileCache.set(phrases, compiled);
  return compiled;
}

// Returns the first matching phrase by list order (so users can prioritize
// rules by reordering them). Returns null if no phrase matches.
export function matchHighlightPhrase(
  content: string,
  phrases: HighlightPhrase[] | undefined,
): HighlightMatch | null {
  if (!phrases || phrases.length === 0) return null;
  const compiled = compile(phrases);
  for (const c of compiled) {
    if (!c.regex) continue;
    if (c.regex.test(content)) {
      return {
        phrase_id: c.id,
        color: c.color,
        sound_id: c.sound_id,
        cooldown_ms: c.cooldown_ms,
      };
    }
  }
  return null;
}

// Match the message's author login against any enabled user-highlight rule.
// Returns the first match by list order (so the user can prioritize rules).
export function matchHighlightUser(
  login: string | null | undefined,
  users: HighlightUser[] | undefined,
): HighlightMatch | null {
  if (!login || !users || users.length === 0) return null;
  const lowered = login.toLowerCase();
  for (const u of users) {
    if (!u.enabled) continue;
    if (u.username.toLowerCase() === lowered) {
      return {
        phrase_id: u.id,
        color: u.color,
        sound_id: normalizeSoundId(u.sound_id),
        cooldown_ms: Math.max(0, (u.cooldown_seconds ?? DEFAULT_COOLDOWN_SECONDS) * 1000),
      };
    }
  }
  return null;
}

// Match any of the message's badges against the enabled badge-highlight
// rules. badge_key in the rule supports a `name/*` form that matches any
// version of the badge (e.g. "subscriber/*" matches subscriber/0, /3, /24).
export function matchHighlightBadge(
  badgeKeys: string[] | null | undefined,
  badges: HighlightBadge[] | undefined,
): HighlightMatch | null {
  if (!badgeKeys || badgeKeys.length === 0 || !badges || badges.length === 0) return null;
  for (const b of badges) {
    if (!b.enabled) continue;
    const key = b.badge_key.toLowerCase();
    const isWildcard = key.endsWith('/*');
    const prefix = isWildcard ? key.slice(0, -1) : null; // includes trailing slash
    for (const userBadge of badgeKeys) {
      const ub = userBadge.toLowerCase();
      if (isWildcard ? ub.startsWith(prefix!) : ub === key) {
        return {
          phrase_id: b.id,
          color: b.color,
          sound_id: normalizeSoundId(b.sound_id),
          cooldown_ms: Math.max(0, (b.cooldown_seconds ?? DEFAULT_COOLDOWN_SECONDS) * 1000),
        };
      }
    }
  }
  return null;
}

// Surfaces compile errors for the settings UI. Returns the error message, or
// null if the phrase compiles cleanly (or is non-regex, which never fails).
export function validateHighlightPhrase(phrase: HighlightPhrase): string | null {
  if (!phrase.is_regex) return null;
  if (!phrase.pattern.trim()) return null;
  try {
    new RegExp(phrase.pattern, phrase.case_sensitive ? 'g' : 'gi');
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid regular expression';
  }
}
