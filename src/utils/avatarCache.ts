import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

// Tiny avatar resolver: maps a Twitch login -> profile_image_url, fetched once
// via the existing get_user_by_login command and memoized process-wide. Used by
// the mod log to show channel + moderator pictures without re-fetching per row.

const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

export function getCachedAvatar(login?: string | null): string | null {
  if (!login) return null;
  return cache.get(login.toLowerCase()) ?? null;
}

export async function resolveAvatar(login?: string | null): Promise<string | null> {
  if (!login) return null;
  const key = login.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      const info = await invoke<{ profile_image_url?: string | null }>('get_user_by_login', { login: key });
      const url = info?.profile_image_url ?? null;
      cache.set(key, url);
      return url;
    } catch {
      cache.set(key, null);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Resolve a user's avatar by login. Returns null until resolved (cached after). */
export function useAvatar(login?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() => getCachedAvatar(login));
  useEffect(() => {
    let alive = true;
    if (!login) {
      setUrl(null);
      return;
    }
    const cached = getCachedAvatar(login);
    if (cached) setUrl(cached);
    void resolveAvatar(login).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [login]);
  return url;
}
