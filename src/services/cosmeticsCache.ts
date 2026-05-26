import { Logger } from '../utils/logger';
// Service for caching cosmetics - user lookups in memory, image files on disk
// User -> cosmetics mappings come from APIs fresh each time
// Image files are cached to disk by their respective services (seventvService, thirdPartyBadges)

interface CachedCosmetics {
  paints: any[];
  badges: any[];
  seventvUserId?: string;
}

// Full profile cache structure - includes all badge types
export interface CachedProfile {
  userId: string;
  username: string;
  channelId?: string;
  channelName?: string;
  twitchBadges: any[];
  seventvCosmetics: CachedCosmetics;
  thirdPartyBadges: any[];
  lastUpdated: number;
}

// Small bounded LRU. Touch-on-hit keeps recently-used entries warm; least-recently
// used falls off when size exceeds maxSize. Designed to match the Map subset this
// module needs (get / set / clear / size). Exported so other services (emojiService
// for one) can reuse the same shape rather than re-implementing it.
export class LruMap<K, V> {
  private map = new Map<K, V>();
  constructor(private maxSize: number) {}
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key)!;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }
  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
  has(key: K): boolean { return this.map.has(key); }
  clear(): void { this.map.clear(); }
  get size(): number { return this.map.size; }
}

// Caps sized for a heavy viewing session. Profile entries are the largest
// (badges + paints + IVR), so cap them tighter. Cosmetic / badge entries are
// smaller — 512 covers ~all active chatters in a busy channel.
const inMemoryCosmeticsCache = new LruMap<string, CachedCosmetics>(512);
const inMemoryThirdPartyBadgesCache = new LruMap<string, any[]>(512);
const inMemoryTwitchBadgesCache = new LruMap<string, any[]>(512);
const inMemoryProfileCache = new LruMap<string, CachedProfile>(256);

// Drop fields that no cached-side consumer reads. BadgeDetailOverlay uses the
// full Twitch badge shape, but it receives `badge` from BadgesOverlay's own
// catalog, not from these per-user caches — so clickAction/clickUrl can be
// dropped here. `link` on third-party badges is defined upstream but never read.
const compactTwitchBadges = (badges: any[]): any[] =>
  badges.map(({ clickAction: _ca, clickUrl: _cu, ...rest }) => rest);
const compactThirdPartyBadges = (badges: any[]): any[] =>
  badges.map(({ link: _link, ...rest }) => rest);

// Track pending requests to prevent duplicate fetches
const pendingCosmeticsRequests = new Map<string, Promise<CachedCosmetics>>();
const pendingThirdPartyBadgesRequests = new Map<string, Promise<any[]>>();
const pendingTwitchBadgesRequests = new Map<string, Promise<any[]>>();
const pendingProfileRequests = new Map<string, Promise<CachedProfile>>();

/**
 * Get cosmetics from synchronous in-memory cache (instant, no async)
 * Returns null if not in memory cache - use this for initial state
 */
export function getCosmeticsFromMemoryCache(userId: string): CachedCosmetics | null {
  return inMemoryCosmeticsCache.get(userId) || null;
}

/**
 * Get third-party badges from synchronous in-memory cache (instant, no async)
 * Returns null if not in memory cache - use this for initial state
 */
export function getThirdPartyBadgesFromMemoryCache(userId: string): any[] | null {
  return inMemoryThirdPartyBadgesCache.get(userId) || null;
}

/**
 * Get cosmetics for a user - memory cache -> API fetch with deduplication
 * Image caching is handled by the seventvService internally
 */
export async function getCosmeticsWithFallback(userId: string): Promise<CachedCosmetics> {
  // 1. Try in-memory cache first (instant, synchronous)
  const memoryCached = inMemoryCosmeticsCache.get(userId);
  if (memoryCached) {
    return memoryCached;
  }

  // 2. Check if there's already a pending request for this user (dedupe)
  const pendingRequest = pendingCosmeticsRequests.get(userId);
  if (pendingRequest) {
    return pendingRequest;
  }

  // 3. Create a new request and track it
  const request = (async (): Promise<CachedCosmetics> => {
    try {
      // Fetch from API (fresh data) - seventvService handles its own 5-minute memory caching
      const { getUserCosmetics } = await import('./seventvService');
      const cosmetics = await getUserCosmetics(userId);

      const result = cosmetics || { paints: [], badges: [] };

      // Store in memory cache for this session (synchronous access)
      inMemoryCosmeticsCache.set(userId, result);

      return result;
    } finally {
      pendingCosmeticsRequests.delete(userId);
    }
  })();

  pendingCosmeticsRequests.set(userId, request);
  return request;
}

/**
 * Get third-party badges for a user - memory cache -> API fetch
 * Third-party badges (FFZ, Chatterino, Homies) come from the unified Rust badge service
 * Note: This requires channelId/channelName context, so we use a simpler approach
 */
export async function getThirdPartyBadgesWithFallback(userId: string): Promise<any[]> {
  // 1. Try in-memory cache first (instant, synchronous)
  const memoryCached = inMemoryThirdPartyBadgesCache.get(userId);
  if (memoryCached) {
    return memoryCached;
  }

  // Third-party badges are now fetched as part of the unified badge service
  // They'll be populated when getTwitchBadgesWithFallback is called
  // Return empty for now - the full profile fetch will populate this
  return [];
}

/**
 * Get Twitch badges from synchronous in-memory cache (instant, no async)
 * Returns null if not in memory cache - use this for initial state
 */
export function getTwitchBadgesFromMemoryCache(cacheKey: string): any[] | null {
  return inMemoryTwitchBadgesCache.get(cacheKey) || null;
}

/**
 * Get Twitch badges for a user - memory cache -> API fetch with deduplication
 */
export async function getTwitchBadgesWithFallback(
  userId: string,
  username: string,
  channelId: string,
  channelName: string
): Promise<any[]> {
  const cacheKey = `${userId}-${channelId}`;

  // 1. Try in-memory cache first (instant, synchronous)
  const memoryCached = inMemoryTwitchBadgesCache.get(cacheKey);
  if (memoryCached) {
    return memoryCached;
  }

  // 2. Check if there's already a pending request for this user (dedupe)
  const pendingRequest = pendingTwitchBadgesRequests.get(cacheKey);
  if (pendingRequest) {
    return pendingRequest;
  }

  // 3. Create a new request and track it
  const request = (async (): Promise<any[]> => {
    try {
      const { getAllUserBadges } = await import('./badgeService');
      const badgeData = await getAllUserBadges(userId, username, channelId, channelName);

      const uniqueBadges = new Map<string, any>();

      // Add display badges first
      badgeData.displayBadges.forEach((badge: any) => {
        uniqueBadges.set(badge.id, badge);
      });

      // Add earned badges that aren't already displayed
      badgeData.earnedBadges.forEach((badge: any) => {
        if (!uniqueBadges.has(badge.id)) {
          uniqueBadges.set(badge.id, badge);
        }
      });

      const result = compactTwitchBadges(Array.from(uniqueBadges.values()));

      Logger.debug(`[cosmeticsCache] Resolved ${result.length} total Twitch badges for ${username}`);

      // Store in memory cache for this session
      inMemoryTwitchBadgesCache.set(cacheKey, result);

      return result;
    } finally {
      pendingTwitchBadgesRequests.delete(cacheKey);
    }
  })();

  pendingTwitchBadgesRequests.set(cacheKey, request);
  return request;
}

/**
 * Get full profile from synchronous in-memory cache (instant, no async)
 * Returns null if not in memory cache
 */
export function getProfileFromMemoryCache(userId: string): CachedProfile | null {
  return inMemoryProfileCache.get(userId) || null;
}

/**
 * Get full profile data with cache-first strategy
 * Returns cached data immediately if available, then refreshes in background
 */
export async function getFullProfileWithFallback(
  userId: string,
  username: string,
  channelId?: string,
  channelName?: string
): Promise<CachedProfile> {
  // 1. Try in-memory cache first (instant, synchronous)
  const memoryCached = inMemoryProfileCache.get(userId);
  if (memoryCached) {
    return memoryCached;
  }

  // 2. Check if there's already a pending request for this user (dedupe)
  const pendingRequest = pendingProfileRequests.get(userId);
  if (pendingRequest) {
    return pendingRequest;
  }

  // 3. Create a new request and track it
  const request = (async (): Promise<CachedProfile> => {
    try {
      const effectiveChannelId = channelId || userId;
      const effectiveChannelName = channelName || username;

      // Fetch badge data from unified service and 7TV cosmetics in parallel
      // Use getAllUserBadgesWithEarned for profile overlays to get full earned badge collection
      const { getAllUserBadgesWithEarned } = await import('./badgeService');
      const [badgeData, seventvCosmetics] = await Promise.all([
        getAllUserBadgesWithEarned(userId, username, effectiveChannelId, effectiveChannelName),
        getCosmeticsWithFallback(userId)
      ]);

      // Merge display and earned Twitch badges, then strip cache-dead fields.
      const uniqueTwitchBadges = new Map<string, any>();
      badgeData.displayBadges.forEach((badge: any) => uniqueTwitchBadges.set(badge.id, badge));
      badgeData.earnedBadges.forEach((badge: any) => {
        if (!uniqueTwitchBadges.has(badge.id)) uniqueTwitchBadges.set(badge.id, badge);
      });
      const twitchBadges = compactTwitchBadges(Array.from(uniqueTwitchBadges.values()));

      // Third-party badges come from the unified service (FFZ, Chatterino, Homies)
      // They're already in the correct format with imageUrl from badgeService.ts
      const thirdPartyBadges = compactThirdPartyBadges(badgeData.thirdPartyBadges || []);

      Logger.debug(`[cosmeticsCache] Fetched ${twitchBadges.length} Twitch badges and ${thirdPartyBadges.length} third-party badges for ${username}`);

      const profile: CachedProfile = {
        userId,
        username,
        channelId: effectiveChannelId,
        channelName: effectiveChannelName,
        twitchBadges,
        seventvCosmetics,
        thirdPartyBadges,
        lastUpdated: Date.now()
      };

      // Also cache individual components
      const twitchCacheKey = `${userId}-${effectiveChannelId}`;
      inMemoryTwitchBadgesCache.set(twitchCacheKey, twitchBadges);
      inMemoryThirdPartyBadgesCache.set(userId, thirdPartyBadges);

      // Store in memory cache for this session
      inMemoryProfileCache.set(userId, profile);

      return profile;
    } finally {
      pendingProfileRequests.delete(userId);
    }
  })();

  pendingProfileRequests.set(userId, request);
  return request;
}

/**
 * Refresh profile data in background and update cache
 * This fetches fresh data without blocking
 */
export async function refreshProfileInBackground(
  userId: string,
  username: string,
  channelId?: string,
  channelName?: string
): Promise<void> {
  const effectiveChannelId = channelId || userId;
  const effectiveChannelName = channelName || username;
  const twitchCacheKey = `${userId}-${effectiveChannelId}`;

  Logger.debug('[CosmeticsCache] Refreshing profile in background for:', username);

  try {
    // Fetch badge data from unified service and 7TV cosmetics in parallel
    // Use getAllUserBadgesWithEarned for profile overlays to get full earned badge collection
    const { getAllUserBadgesWithEarned } = await import('./badgeService');
    const [badgeDataResult, seventvCosmeticsResult] = await Promise.allSettled([
      getAllUserBadgesWithEarned(userId, username, effectiveChannelId, effectiveChannelName),
      (async () => {
        const { getUserCosmetics } = await import('./seventvService');
        return await getUserCosmetics(userId) || { paints: [], badges: [] };
      })()
    ]);

    // Process badge data if successful
    let twitchBadges: any[] = [];
    let thirdPartyBadges: any[] = [];
    
    if (badgeDataResult.status === 'fulfilled') {
      const badgeData = badgeDataResult.value;
      
      // Merge display and earned badges
      const uniqueBadges = new Map<string, any>();
      badgeData.displayBadges.forEach((badge: any) => uniqueBadges.set(badge.id, badge));
      badgeData.earnedBadges.forEach((badge: any) => {
        if (!uniqueBadges.has(badge.id)) uniqueBadges.set(badge.id, badge);
      });
      twitchBadges = compactTwitchBadges(Array.from(uniqueBadges.values()));

      // Transform third-party badges. `link` intentionally omitted — no
      // consumer reads it; compactThirdPartyBadges would strip it anyway.
      thirdPartyBadges = (badgeData.thirdPartyBadges || []).map((b: any) => ({
        id: b.id,
        title: b.title,
        imageUrl: b.imageUrl,
        provider: b.provider,
      }));
    }

    // Update individual caches with fresh data
    if (twitchBadges.length > 0) {
      inMemoryTwitchBadgesCache.set(twitchCacheKey, twitchBadges);
    }
    if (seventvCosmeticsResult.status === 'fulfilled') {
      inMemoryCosmeticsCache.set(userId, seventvCosmeticsResult.value);
    }
    if (thirdPartyBadges.length > 0) {
      inMemoryThirdPartyBadgesCache.set(userId, thirdPartyBadges);
    }

    // Update full profile cache
    const profile: CachedProfile = {
      userId,
      username,
      channelId: effectiveChannelId,
      channelName: effectiveChannelName,
      twitchBadges: twitchBadges.length > 0 ? twitchBadges : inMemoryTwitchBadgesCache.get(twitchCacheKey) || [],
      seventvCosmetics: seventvCosmeticsResult.status === 'fulfilled' ? seventvCosmeticsResult.value : inMemoryCosmeticsCache.get(userId) || { paints: [], badges: [] },
      thirdPartyBadges: thirdPartyBadges.length > 0 ? thirdPartyBadges : inMemoryThirdPartyBadgesCache.get(userId) || [],
      lastUpdated: Date.now()
    };

    inMemoryProfileCache.set(userId, profile);
    Logger.debug('[CosmeticsCache] Profile refreshed for:', username, `(${twitchBadges.length} Twitch, ${thirdPartyBadges.length} third-party badges)`);
  } catch (error) {
    Logger.error('[CosmeticsCache] Failed to refresh profile:', error);
  }
}

/**
 * Clear in-memory caches (useful for testing or channel switch)
 */
export function clearCosmeticsMemoryCache(): void {
  inMemoryCosmeticsCache.clear();
  pendingCosmeticsRequests.clear();
  inMemoryThirdPartyBadgesCache.clear();
  pendingThirdPartyBadgesRequests.clear();
  inMemoryTwitchBadgesCache.clear();
  pendingTwitchBadgesRequests.clear();
  inMemoryProfileCache.clear();
  pendingProfileRequests.clear();
  Logger.debug('[CosmeticsCache] All memory caches cleared');
}
