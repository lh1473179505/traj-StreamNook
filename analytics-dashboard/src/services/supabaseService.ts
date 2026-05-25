import { createClient, RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Client bootstrap
// ---------------------------------------------------------------------------

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const isConfigured = supabaseUrl && supabaseAnonKey &&
    supabaseUrl !== 'your_supabase_url_here' &&
    supabaseAnonKey !== 'your_supabase_anon_key_here';

let supabase: SupabaseClient | null = null;

if (isConfigured) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    console.log('[Supabase] Client initialized');
} else {
    console.warn('[Supabase] Not configured - analytics features disabled. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env');
}

export const getSupabaseClient = (): SupabaseClient | null => supabase;
export const isSupabaseConfigured = (): boolean => !!isConfigured;

// ---------------------------------------------------------------------------
// Presence
// ---------------------------------------------------------------------------

interface PresencePayload {
    user_id?: string;
    display_name?: string;
    app_version?: string;
    online_at: string;
}

export interface OnlineUser {
    user_id: string;
    display_name?: string;
    app_version?: string;
    online_at: string;
}

export interface OnlinePresenceSnapshot {
    authedUsers: OnlineUser[];
    anonKeyCount: number;
    /** Unique participants = authed users + anon sessions. */
    totalUnique: number;
}

let presenceChannel: RealtimeChannel | null = null;
let presenceReady = false;
const presenceSubscribers = new Set<(snap: OnlinePresenceSnapshot) => void>();

const emptySnapshot = (): OnlinePresenceSnapshot => ({
    authedUsers: [],
    anonKeyCount: 0,
    totalUnique: 0,
});

const computeSnapshot = (): OnlinePresenceSnapshot => {
    if (!presenceChannel) return emptySnapshot();
    const state = presenceChannel.presenceState<PresencePayload>();
    const byUserId = new Map<string, OnlineUser>();
    let anonKeyCount = 0;

    for (const key of Object.keys(state)) {
        const arr = state[key];
        if (!Array.isArray(arr) || arr.length === 0) continue;
        const fresh = arr.reduce((a, b) =>
            new Date(b.online_at).getTime() > new Date(a.online_at).getTime() ? b : a
        );
        if (fresh.user_id) {
            const existing = byUserId.get(fresh.user_id);
            if (!existing || new Date(fresh.online_at).getTime() > new Date(existing.online_at).getTime()) {
                byUserId.set(fresh.user_id, {
                    user_id: fresh.user_id,
                    display_name: fresh.display_name,
                    app_version: fresh.app_version,
                    online_at: fresh.online_at,
                });
            }
        } else {
            anonKeyCount++;
        }
    }

    return {
        authedUsers: Array.from(byUserId.values()).sort((a, b) =>
            new Date(b.online_at).getTime() - new Date(a.online_at).getTime()
        ),
        anonKeyCount,
        totalUnique: byUserId.size + anonKeyCount,
    };
};

const notifyPresenceSubscribers = () => {
    if (presenceSubscribers.size === 0) return;
    const snap = computeSnapshot();
    for (const cb of presenceSubscribers) {
        try { cb(snap); } catch (e) { console.error('[Supabase] Presence subscriber error:', e); }
    }
};

const ensurePresenceChannel = (): void => {
    if (!supabase || presenceChannel) return;

    presenceChannel = supabase.channel('global-presence', {
        config: {
            presence: {
                // Observer key prefix tells the main app we are not a real user.
                key: 'dashboard_observer_' + Date.now(),
            },
        },
    });

    presenceChannel
        .on('presence', { event: 'sync' }, () => {
            presenceReady = true;
            notifyPresenceSubscribers();
        })
        .on('presence', { event: 'join' }, () => notifyPresenceSubscribers())
        .on('presence', { event: 'leave' }, () => notifyPresenceSubscribers())
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
                console.log('[Supabase] Dashboard subscribed to presence');
                // Do NOT call track() — the dashboard is an observer.
                notifyPresenceSubscribers();
            }
        });
};

export const subscribeToOnlinePresence = (
    callback: (snap: OnlinePresenceSnapshot) => void
): (() => void) => {
    presenceSubscribers.add(callback);
    ensurePresenceChannel();
    try { callback(computeSnapshot()); } catch (e) { console.error('[Supabase] Presence subscriber error:', e); }
    return () => {
        presenceSubscribers.delete(callback);
        if (presenceSubscribers.size === 0 && presenceChannel) {
            presenceChannel.unsubscribe();
            presenceChannel = null;
            presenceReady = false;
        }
    };
};

export const getOnlinePresenceSnapshot = (): OnlinePresenceSnapshot => computeSnapshot();
export const isPresenceReady = (): boolean => presenceReady;

// ---------------------------------------------------------------------------
// Users + stats
// ---------------------------------------------------------------------------

export interface TwitchUser {
    access_token: string;
    username: string;
    user_id: string;
    login?: string;
    display_name?: string;
    profile_image_url?: string;
    broadcaster_type?: string;
}

export interface SupabaseUser {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
    last_seen: string;
    created_at: string;
    app_version?: string;
}

export interface UserStats {
    user_id: string;
    channel_points_farmed: number;
    hours_watched: number;
    messages_sent: number;
    streams_watched: number;
    updated_at: string;
}

export interface UserWithStats extends SupabaseUser {
    stats?: UserStats;
}

export interface GlobalStats {
    total_channel_points: number;
    total_hours_watched: number;
    total_messages_sent: number;
    total_streams_watched: number;
}

export interface ActivitySummary {
    /** Active in the last 24h. */
    dau: number;
    /** Active in the last 7 days. */
    wau: number;
    /** Active in the last 30 days. */
    mau: number;
    /** Signed up in the last 24h. */
    newToday: number;
    /** Signed up in the last 7 days. */
    newThisWeek: number;
    /** Active in the last hour. */
    activeLastHour: number;
}

export interface VersionRow {
    version: string;
    count: number;
}

export const getAllUsers = async (): Promise<SupabaseUser[]> => {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .order('last_seen', { ascending: false });
        if (error) {
            console.error('[Supabase] Failed to get all users:', error);
            return [];
        }
        return (data as SupabaseUser[]) || [];
    } catch (error) {
        console.error('[Supabase] Failed to get all users:', error);
        return [];
    }
};

export const getGlobalStats = async (): Promise<GlobalStats> => {
    if (!supabase) {
        return { total_channel_points: 0, total_hours_watched: 0, total_messages_sent: 0, total_streams_watched: 0 };
    }
    try {
        const { data, error } = await supabase
            .from('user_stats')
            .select('channel_points_farmed, hours_watched, messages_sent, streams_watched');
        if (error) {
            console.error('[Supabase] Failed to get global stats:', error);
            return { total_channel_points: 0, total_hours_watched: 0, total_messages_sent: 0, total_streams_watched: 0 };
        }
        return (data || []).reduce((acc, row) => ({
            total_channel_points: acc.total_channel_points + (row.channel_points_farmed || 0),
            total_hours_watched: acc.total_hours_watched + (row.hours_watched || 0),
            total_messages_sent: acc.total_messages_sent + (row.messages_sent || 0),
            total_streams_watched: acc.total_streams_watched + (row.streams_watched || 0),
        }), { total_channel_points: 0, total_hours_watched: 0, total_messages_sent: 0, total_streams_watched: 0 });
    } catch (error) {
        console.error('[Supabase] Failed to get global stats:', error);
        return { total_channel_points: 0, total_hours_watched: 0, total_messages_sent: 0, total_streams_watched: 0 };
    }
};

export const getAllUsersWithStats = async (): Promise<UserWithStats[]> => {
    if (!supabase) return [];
    try {
        const { data: users, error: usersError } = await supabase
            .from('users')
            .select('*')
            .order('last_seen', { ascending: false });
        if (usersError) {
            console.error('[Supabase] Failed to get users:', usersError);
            return [];
        }

        const { data: stats, error: statsError } = await supabase
            .from('user_stats')
            .select('*');
        if (statsError && statsError.code !== 'PGRST116') {
            console.error('[Supabase] Failed to get stats:', statsError);
        }

        const statsMap = new Map<string, UserStats>();
        (stats || []).forEach((stat: UserStats) => { statsMap.set(stat.user_id, stat); });

        return (users || []).map((user: SupabaseUser) => ({
            ...user,
            stats: statsMap.get(user.id),
        }));
    } catch (error) {
        console.error('[Supabase] Failed to get users with stats:', error);
        return [];
    }
};

export const subscribeToStatsChanges = (
    callback: (users: UserWithStats[], globalStats: GlobalStats) => void
): (() => void) | null => {
    if (!supabase) return null;

    const fetchData = async () => {
        const users = await getAllUsersWithStats();
        const globalStats = await getGlobalStats();
        callback(users, globalStats);
    };

    fetchData();

    const channel = supabase
        .channel('stats-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_stats' }, () => { fetchData(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => { fetchData(); })
        .subscribe();

    return () => { channel.unsubscribe(); };
};

// ---------------------------------------------------------------------------
// Derived analytics: activity windows + version distribution
// ---------------------------------------------------------------------------

export const computeActivitySummary = (users: UserWithStats[]): ActivitySummary => {
    const now = Date.now();
    const hour = 3600_000;
    const day = 24 * hour;

    let activeLastHour = 0;
    let dau = 0;
    let wau = 0;
    let mau = 0;
    let newToday = 0;
    let newThisWeek = 0;

    for (const u of users) {
        const lastSeen = new Date(u.last_seen).getTime();
        const created = new Date(u.created_at).getTime();
        const seenAgo = now - lastSeen;
        const createdAgo = now - created;
        if (seenAgo <= hour) activeLastHour++;
        if (seenAgo <= day) dau++;
        if (seenAgo <= 7 * day) wau++;
        if (seenAgo <= 30 * day) mau++;
        if (createdAgo <= day) newToday++;
        if (createdAgo <= 7 * day) newThisWeek++;
    }

    return { dau, wau, mau, newToday, newThisWeek, activeLastHour };
};

/**
 * App version distribution across all known users. The `app_version` column
 * is populated on upsert + on every presence update, so this reflects the
 * latest reported version per user (not historical).
 */
export const computeVersionDistribution = (users: UserWithStats[]): VersionRow[] => {
    const counts = new Map<string, number>();
    for (const u of users) {
        const v = (u.app_version && u.app_version.trim()) || 'unknown';
        counts.set(v, (counts.get(v) || 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([version, count]) => ({ version, count }))
        .sort((a, b) => {
            if (a.version === 'unknown') return 1;
            if (b.version === 'unknown') return -1;
            // Sort versions descending, falling back to lexicographic.
            return b.version.localeCompare(a.version, undefined, { numeric: true });
        });
};

// ---------------------------------------------------------------------------
// Write-health probe
// ---------------------------------------------------------------------------

export type WriteHealth =
    | { status: 'ok'; checkedAt: string }
    | { status: 'rpc_missing'; checkedAt: string; detail: string }
    | { status: 'rls_denied'; checkedAt: string; detail: string }
    | { status: 'unknown_error'; checkedAt: string; detail: string }
    | { status: 'not_configured'; checkedAt: string };

/**
 * Verify the dashboard can READ stats. The dashboard runs under the anon key
 * so we never attempt a write — the goal is to detect "select returns nothing
 * because RLS denies it" vs "select succeeds, just zero rows", which would
 * make the entire dashboard appear broken even when the main app is healthy.
 */
export const runWriteHealthProbe = async (): Promise<WriteHealth> => {
    const checkedAt = new Date().toISOString();
    if (!supabase) return { status: 'not_configured', checkedAt };

    try {
        // Test 1: can we read user_stats at all?
        const { error: statsErr } = await supabase
            .from('user_stats')
            .select('user_id', { count: 'exact', head: true });

        if (statsErr) {
            if (statsErr.code === '42501') {
                return { status: 'rls_denied', checkedAt, detail: 'user_stats SELECT denied by RLS' };
            }
            return { status: 'unknown_error', checkedAt, detail: `${statsErr.code || ''} ${statsErr.message || ''}`.trim() };
        }

        // Test 2: is the increment_user_stat RPC defined? Call with bogus args;
        // we only care about distinguishing "function missing" from other errors.
        const { error: rpcErr } = await supabase.rpc('increment_user_stat', {
            p_user_id: '__health_probe__',
            p_stat: 'messages_sent',
            p_amount: 0,
        });

        if (rpcErr) {
            const rpcMissing = rpcErr.code === '42883'
                || rpcErr.code === 'PGRST202'
                || (typeof rpcErr.message === 'string' && rpcErr.message.toLowerCase().includes('function'));
            if (rpcMissing) {
                return { status: 'rpc_missing', checkedAt, detail: 'increment_user_stat RPC not defined - using manual upsert (slower, not atomic)' };
            }
            if (rpcErr.code === '42501') {
                return { status: 'rls_denied', checkedAt, detail: 'RPC denied by RLS' };
            }
            // RPC exists but rejected our probe payload — fine, RPC is reachable.
        }

        return { status: 'ok', checkedAt };
    } catch (error: any) {
        return { status: 'unknown_error', checkedAt, detail: String(error?.message || error) };
    }
};
