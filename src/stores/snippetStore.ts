// snippetStore — user-owned snippet data for the Ctrl+K palette.
//
// Three pieces of state, all persisted to localStorage and synced across
// windows (main + every MultiChat popout) via a Tauri event:
//
//   customSnippets  — user-authored entries layered on top of the built-in
//                     library. Same shape as built-in; their ids are
//                     prefixed `custom.` so they can't collide.
//   favoriteIds     — Set of snippet ids (built-in OR custom) the user has
//                     starred. Favorites float to the top of the Snippets
//                     section and get a small star icon.
//   aliases         — Map of snippet id → user-typed shortcut. Typing the
//                     alias in the palette boosts that snippet above normal
//                     title matches. Aliases are case-insensitive.
//
// Cross-window sync uses the same emit/listen idiom as
// `utils/settingsBroadcast.ts` — one event, every window re-reads
// localStorage on receipt. The originating window stamps a sender id so it
// can ignore its own broadcast.

import { create } from 'zustand';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Logger } from '../utils/logger';
import { BUILTIN_SNIPPET_IDS, type Snippet } from '../utils/commandPaletteCopypastas';

const STORAGE_CUSTOM = 'streamnook.snippets.custom.v1';
const STORAGE_FAVORITES = 'streamnook.snippets.favorites.v1';
const STORAGE_ALIASES = 'streamnook.snippets.aliases.v1';

const SNIPPETS_UPDATED_EVENT = 'streamnook-snippets-updated';

// Per-window-load random id, same pattern as settingsBroadcast SENDER_ID.
// Used to ignore broadcasts originating from this window.
const SENDER_ID =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type CustomSnippet = Snippet & { custom: true };

interface SnippetStoreState {
  customSnippets: CustomSnippet[];
  favoriteIds: Set<string>;
  aliases: Map<string, string>;

  addCustomSnippet: (input: { title: string; category: Snippet['category']; content: string; keywords?: string }) => string;
  updateCustomSnippet: (id: string, patch: Partial<Pick<Snippet, 'title' | 'content' | 'category' | 'keywords'>>) => void;
  removeCustomSnippet: (id: string) => void;

  toggleFavorite: (id: string) => void;
  isFavorite: (id: string) => boolean;

  setAlias: (id: string, alias: string) => void;
  clearAlias: (id: string) => void;
  getAlias: (id: string) => string | undefined;
}

// ---------- localStorage helpers --------------------------------------------

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    Logger.warn(`[snippetStore] read ${key} failed:`, err);
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    Logger.warn(`[snippetStore] write ${key} failed:`, err);
  }
}

function loadCustom(): CustomSnippet[] {
  const raw = readJSON<unknown>(STORAGE_CUSTOM, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is CustomSnippet =>
      !!s &&
      typeof s === 'object' &&
      typeof (s as CustomSnippet).id === 'string' &&
      typeof (s as CustomSnippet).title === 'string' &&
      typeof (s as CustomSnippet).content === 'string',
  );
}

function loadFavorites(): Set<string> {
  const raw = readJSON<unknown>(STORAGE_FAVORITES, []);
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.filter((x): x is string => typeof x === 'string'));
}

function loadAliases(): Map<string, string> {
  const raw = readJSON<unknown>(STORAGE_ALIASES, {});
  if (!raw || typeof raw !== 'object') return new Map();
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out.set(k, v.trim().toLowerCase());
  }
  return out;
}

function persistAll(state: Pick<SnippetStoreState, 'customSnippets' | 'favoriteIds' | 'aliases'>) {
  writeJSON(STORAGE_CUSTOM, state.customSnippets);
  writeJSON(STORAGE_FAVORITES, Array.from(state.favoriteIds));
  writeJSON(STORAGE_ALIASES, Object.fromEntries(state.aliases));
  void broadcastUpdate();
}

async function broadcastUpdate(): Promise<void> {
  try {
    await emit(SNIPPETS_UPDATED_EVENT, { source: SENDER_ID });
  } catch (err) {
    Logger.warn('[snippetStore] broadcast failed (non-fatal):', err);
  }
}

// ---------- Zustand store ---------------------------------------------------

export const useSnippetStore = create<SnippetStoreState>((set, get) => ({
  customSnippets: loadCustom(),
  favoriteIds: loadFavorites(),
  aliases: loadAliases(),

  addCustomSnippet: (input) => {
    // Custom ids are namespaced + random-suffixed so two snippets with the
    // same title don't collide and so they sort distinct from built-ins in
    // any id-keyed lookup.
    const id = `custom.${slugify(input.title)}.${Math.random().toString(36).slice(2, 6)}`;
    const snippet: CustomSnippet = {
      id,
      title: input.title.trim() || 'Untitled',
      category: input.category,
      content: input.content,
      keywords: input.keywords?.trim() || undefined,
      custom: true,
    };
    set((state) => {
      const next = { ...state, customSnippets: [...state.customSnippets, snippet] };
      persistAll(next);
      return { customSnippets: next.customSnippets };
    });
    return id;
  },

  updateCustomSnippet: (id, patch) => {
    set((state) => {
      const next = state.customSnippets.map((s) =>
        s.id === id
          ? {
              ...s,
              title: patch.title?.trim() || s.title,
              content: patch.content ?? s.content,
              category: patch.category ?? s.category,
              keywords: patch.keywords === undefined ? s.keywords : patch.keywords.trim() || undefined,
            }
          : s,
      );
      persistAll({ ...state, customSnippets: next });
      return { customSnippets: next };
    });
  },

  removeCustomSnippet: (id) => {
    set((state) => {
      const customSnippets = state.customSnippets.filter((s) => s.id !== id);
      // Tidy up favorite + alias rows that point at the deleted snippet so
      // they don't accumulate as ghost entries in storage.
      const favoriteIds = new Set(state.favoriteIds);
      favoriteIds.delete(id);
      const aliases = new Map(state.aliases);
      aliases.delete(id);
      persistAll({ customSnippets, favoriteIds, aliases });
      return { customSnippets, favoriteIds, aliases };
    });
  },

  toggleFavorite: (id) => {
    set((state) => {
      const favoriteIds = new Set(state.favoriteIds);
      if (favoriteIds.has(id)) favoriteIds.delete(id);
      else favoriteIds.add(id);
      persistAll({ ...state, favoriteIds });
      return { favoriteIds };
    });
  },

  isFavorite: (id) => get().favoriteIds.has(id),

  setAlias: (id, alias) => {
    const normalized = alias.trim().toLowerCase();
    set((state) => {
      const aliases = new Map(state.aliases);
      if (!normalized) aliases.delete(id);
      else aliases.set(id, normalized);
      persistAll({ ...state, aliases });
      return { aliases };
    });
  },

  clearAlias: (id) => {
    set((state) => {
      const aliases = new Map(state.aliases);
      aliases.delete(id);
      persistAll({ ...state, aliases });
      return { aliases };
    });
  },

  getAlias: (id) => get().aliases.get(id),
}));

// ---------- Cross-window sync ----------------------------------------------

/** Reload the store from localStorage. Used by the cross-window listener and
 *  exposed for any code that explicitly needs to refresh (e.g. settings
 *  import/export). */
export function reloadSnippetStore(): void {
  useSnippetStore.setState({
    customSnippets: loadCustom(),
    favoriteIds: loadFavorites(),
    aliases: loadAliases(),
  });
}

/** Mount once per window — subscribes this window's store to updates emitted
 *  by other windows. Mirrors the settingsBroadcast pattern. Returns an
 *  unlisten function for cleanup; in practice we mount it in App.tsx and
 *  MultiChatWindow.tsx and never unmount. */
export async function startSnippetSync(): Promise<UnlistenFn | undefined> {
  try {
    return await listen<{ source: string }>(SNIPPETS_UPDATED_EVENT, (event) => {
      if (event.payload?.source === SENDER_ID) return;
      reloadSnippetStore();
    });
  } catch (err) {
    Logger.warn('[snippetStore] startSnippetSync failed:', err);
    return undefined;
  }
}

// ---------- Helpers --------------------------------------------------------

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/** Helper for places that need the "is this ID built-in?" check without
 *  reaching into the copypasta module — re-exported here so the snippet
 *  settings page has one import surface for everything snippet-related. */
export { BUILTIN_SNIPPET_IDS };
