import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users, Activity, RefreshCw, Clock, Search, ExternalLink,
  MessageSquare, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  TrendingUp, Wifi, WifiOff, AlertTriangle, CheckCircle2,
  ArrowUp, ArrowDown, UserPlus, Package, Radio,
} from 'lucide-react';
import {
  isSupabaseConfigured,
  subscribeToOnlinePresence,
  isPresenceReady,
  getAllUsersWithStats,
  subscribeToStatsChanges,
  getGlobalStats,
  computeActivitySummary,
  computeVersionDistribution,
  runWriteHealthProbe,
  type UserWithStats,
  type GlobalStats,
  type OnlinePresenceSnapshot,
  type ActivitySummary,
  type VersionRow,
  type WriteHealth,
  type OnlineUser,
} from './services/supabaseService';

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

const formatRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMs < 30000) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

const formatNumber = (num: number): string => {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toLocaleString();
};

const formatHours = (hours: number): string => {
  if (hours >= 1000) return (hours / 1000).toFixed(1) + 'k';
  if (hours < 1) return hours.toFixed(2);
  return hours.toFixed(1);
};

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent: string;
}

const StatCard = ({ title, value, subtitle, icon: Icon, accent }: StatCardProps) => (
  <div className="glass-card rounded-2xl p-5 relative overflow-hidden">
    <div className="flex items-center justify-between mb-3">
      <div className={`p-2.5 rounded-lg ${accent}`}>
        <Icon size={18} />
      </div>
    </div>
    <div className="text-3xl font-semibold text-white tracking-tight tabular-nums">{value}</div>
    <div className="text-sm font-medium text-zinc-400 mt-1">{title}</div>
    {subtitle && <div className="text-xs text-zinc-500 mt-1">{subtitle}</div>}
  </div>
);

const HealthBadge = ({ health, presenceReady }: { health: WriteHealth | null; presenceReady: boolean }) => {
  if (!health) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-800/60 border border-white/5">
        <RefreshCw size={12} className="text-zinc-400 animate-spin" />
        <span className="text-xs text-zinc-400 font-medium">Checking</span>
      </div>
    );
  }

  if (health.status === 'ok' && presenceReady) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
        <CheckCircle2 size={12} className="text-emerald-400" />
        <span className="text-xs font-semibold text-emerald-400">All systems reporting</span>
      </div>
    );
  }

  if (health.status === 'ok' && !presenceReady) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20">
        <Wifi size={12} className="text-amber-400" />
        <span className="text-xs font-semibold text-amber-400">Connecting presence</span>
      </div>
    );
  }

  const labels: Record<WriteHealth['status'], string> = {
    ok: 'OK',
    rpc_missing: 'RPC missing',
    rls_denied: 'RLS denied',
    unknown_error: 'Database error',
    not_configured: 'Not configured',
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20">
      <WifiOff size={12} className="text-red-400" />
      <span className="text-xs font-semibold text-red-400">{labels[health.status]}</span>
    </div>
  );
};

const HealthBanner = ({ health }: { health: WriteHealth | null }) => {
  if (!health || health.status === 'ok') return null;
  const messages: Record<WriteHealth['status'], string> = {
    ok: '',
    rpc_missing: 'The increment_user_stat RPC is not defined in Supabase. Stat writes fall back to a manual non-atomic upsert. Define the RPC for accurate concurrent writes.',
    rls_denied: 'Supabase RLS is denying access. Check the policies on the users and user_stats tables.',
    unknown_error: 'Supabase returned an unexpected error.',
    not_configured: 'Supabase credentials are missing.',
  };
  return (
    <div className="mb-6 glass-panel rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 flex items-start gap-3">
      <AlertTriangle className="text-amber-400 mt-0.5 flex-shrink-0" size={18} />
      <div className="flex-1">
        <div className="text-sm font-semibold text-amber-300 mb-1">Health check warning</div>
        <div className="text-xs text-amber-200/80 mb-1">{messages[health.status]}</div>
        {'detail' in health && health.detail && (
          <div className="text-xs text-amber-200/50 font-mono mt-1">{health.detail}</div>
        )}
      </div>
    </div>
  );
};

const VersionDistribution = ({ rows, total }: { rows: VersionRow[]; total: number }) => {
  if (rows.length === 0) return <div className="text-sm text-zinc-500">No version data yet.</div>;
  const max = rows[0]?.count || 1;
  return (
    <div className="space-y-3">
      {rows.slice(0, 8).map((r) => {
        const pct = total > 0 ? (r.count / total) * 100 : 0;
        const widthPct = (r.count / max) * 100;
        return (
          <div key={r.version}>
            <div className="flex justify-between text-xs mb-1">
              <span className="font-mono text-zinc-300">{r.version}</span>
              <span className="text-zinc-500">
                {r.count} <span className="text-zinc-600">({pct.toFixed(0)}%)</span>
              </span>
            </div>
            <div className="h-1.5 bg-zinc-800/60 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500/80 to-cyan-500/80 rounded-full transition-all"
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const LiveUsersPanel = ({ snapshot, presenceReady }: { snapshot: OnlinePresenceSnapshot; presenceReady: boolean }) => {
  if (!presenceReady) {
    return (
      <div className="text-sm text-zinc-500 flex items-center gap-2">
        <RefreshCw size={14} className="animate-spin" />
        Connecting to presence channel...
      </div>
    );
  }
  if (snapshot.totalUnique === 0) {
    return <div className="text-sm text-zinc-500">No one is online right now.</div>;
  }
  return (
    <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
      {snapshot.authedUsers.map((u: OnlineUser) => (
        <div key={u.user_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.02] transition-colors">
          <div className="relative flex-shrink-0">
            <div className="h-2 w-2 rounded-full bg-emerald-500"></div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-zinc-200 truncate">
              {u.display_name || u.user_id}
            </div>
            <div className="text-xs text-zinc-500">
              online {formatRelativeTime(u.online_at)}
            </div>
          </div>
          {u.app_version && (
            <span className="text-[10px] font-mono text-zinc-400 bg-zinc-800/60 px-2 py-0.5 rounded border border-white/5 flex-shrink-0">
              {u.app_version}
            </span>
          )}
        </div>
      ))}
      {snapshot.anonKeyCount > 0 && (
        <div className="flex items-center gap-3 p-2 text-sm text-zinc-500">
          <div className="h-2 w-2 rounded-full bg-zinc-600 flex-shrink-0"></div>
          <span>+ {snapshot.anonKeyCount} anonymous session{snapshot.anonKeyCount === 1 ? '' : 's'}</span>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// User table
// ---------------------------------------------------------------------------

type SortKey = 'last_seen' | 'display_name' | 'messages_sent' | 'hours_watched' | 'channel_points_farmed' | 'created_at';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE = 25;

interface UserTableProps {
  users: UserWithStats[];
  onlineUserIds: Set<string>;
  liveInfoById: Map<string, OnlineUser>;
}

const UserTable = ({ users, onlineUserIds, liveInfoById }: UserTableProps) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [tab, setTab] = useState<'all' | 'online'>('all');
  const [versionFilter, setVersionFilter] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('last_seen');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(0);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const v = versionFilter.toLowerCase().trim();
    return users.filter((u) => {
      if (q && !u.display_name.toLowerCase().includes(q) && !u.username.toLowerCase().includes(q)) return false;
      if (tab === 'online' && !onlineUserIds.has(u.id)) return false;
      if (v) {
        const live = liveInfoById.get(u.id)?.app_version;
        const ver = (live || u.app_version || '').toLowerCase();
        if (!ver.includes(v)) return false;
      }
      return true;
    });
  }, [users, searchQuery, tab, versionFilter, onlineUserIds, liveInfoById]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      const av = (() => {
        switch (sortKey) {
          case 'last_seen': return new Date(a.last_seen).getTime();
          case 'created_at': return new Date(a.created_at).getTime();
          case 'display_name': return a.display_name.toLowerCase();
          case 'messages_sent': return a.stats?.messages_sent || 0;
          case 'hours_watched': return a.stats?.hours_watched || 0;
          case 'channel_points_farmed': return a.stats?.channel_points_farmed || 0;
        }
      })();
      const bv = (() => {
        switch (sortKey) {
          case 'last_seen': return new Date(b.last_seen).getTime();
          case 'created_at': return new Date(b.created_at).getTime();
          case 'display_name': return b.display_name.toLowerCase();
          case 'messages_sent': return b.stats?.messages_sent || 0;
          case 'hours_watched': return b.stats?.hours_watched || 0;
          case 'channel_points_farmed': return b.stats?.channel_points_farmed || 0;
        }
      })();
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageRows = sorted.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'display_name' ? 'asc' : 'desc');
    }
    setPage(0);
  };

  const SortHeader = ({ label, k, align }: { label: string; k: SortKey; align?: 'right' }) => (
    <th
      onClick={() => onSort(k)}
      className={`px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider cursor-pointer select-none hover:text-zinc-300 ${align === 'right' ? 'text-right' : ''}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === k && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </span>
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <Users size={20} className="text-violet-400" />
          User Directory
          <span className="text-sm font-normal text-zinc-500">({sorted.length})</span>
        </h2>

        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Search name..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(0); }}
              className="bg-zinc-900/50 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-violet-500/50 w-52"
            />
          </div>
          <input
            type="text"
            placeholder="Version filter..."
            value={versionFilter}
            onChange={(e) => { setVersionFilter(e.target.value); setPage(0); }}
            className="bg-zinc-900/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-violet-500/50 w-32 font-mono"
          />
          <div className="flex bg-zinc-900/50 rounded-lg p-1 border border-white/10">
            <button
              onClick={() => { setTab('all'); setPage(0); }}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${tab === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
            >All</button>
            <button
              onClick={() => { setTab('online'); setPage(0); }}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${tab === 'online' ? 'bg-zinc-800 text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'}`}
            >Online</button>
          </div>
        </div>
      </div>

      <div className="glass-panel rounded-2xl overflow-hidden border border-white/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/[0.02]">
                <th className="px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider w-12">Live</th>
                <SortHeader label="User" k="display_name" />
                <th className="px-6 py-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider">Version</th>
                <SortHeader label="Messages" k="messages_sent" align="right" />
                <SortHeader label="Hours" k="hours_watched" align="right" />
                <SortHeader label="Points" k="channel_points_farmed" align="right" />
                <SortHeader label="Last Seen" k="last_seen" />
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-zinc-500">
                    No users match these filters.
                  </td>
                </tr>
              ) : pageRows.map((user) => {
                const isOnline = onlineUserIds.has(user.id);
                const isExpanded = expandedUserId === user.id;
                const live = liveInfoById.get(user.id);
                const displayVersion = (isOnline && live?.app_version) ? live.app_version : user.app_version;
                return (
                  <UserRow
                    key={user.id}
                    user={user}
                    isOnline={isOnline}
                    isExpanded={isExpanded}
                    displayVersion={displayVersion}
                    onToggle={() => setExpandedUserId(isExpanded ? null : user.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-white/5 flex items-center justify-between text-sm">
            <div className="text-zinc-500">
              Page {currentPage + 1} of {totalPages} ({sorted.length} users)
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(Math.max(0, currentPage - 1))}
                disabled={currentPage === 0}
                className="p-1.5 rounded-md hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} className="text-zinc-400" />
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, currentPage + 1))}
                disabled={currentPage >= totalPages - 1}
                className="p-1.5 rounded-md hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={16} className="text-zinc-400" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const UserRow = ({ user, isOnline, isExpanded, displayVersion, onToggle }: {
  user: UserWithStats;
  isOnline: boolean;
  isExpanded: boolean;
  displayVersion?: string;
  onToggle: () => void;
}) => (
  <>
    <tr
      onClick={onToggle}
      className={`border-t border-white/5 group cursor-pointer transition-colors ${isExpanded ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'}`}
    >
      <td className="px-6 py-3">
        <div className="flex justify-center">
          {isOnline ? (
            <div className="h-2 w-2 rounded-full bg-emerald-500"></div>
          ) : (
            <div className="h-2 w-2 rounded-full bg-zinc-700"></div>
          )}
        </div>
      </td>
      <td className="px-6 py-3">
        <div className="flex items-center gap-3">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full ring-1 ring-white/10" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400 ring-1 ring-white/10">
              {user.display_name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-medium text-zinc-200 group-hover:text-white transition-colors truncate">{user.display_name}</div>
            <div className="text-xs text-zinc-500 truncate">@{user.username}</div>
          </div>
        </div>
      </td>
      <td className="px-6 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium border border-white/5 ${isOnline && displayVersion ? 'bg-emerald-900/30 text-emerald-400' : 'bg-zinc-800/60 text-zinc-400'}`}>
          {displayVersion || 'unknown'}
        </span>
      </td>
      <td className="px-6 py-3 text-right text-sm font-mono text-zinc-300 tabular-nums">{user.stats ? formatNumber(user.stats.messages_sent) : '0'}</td>
      <td className="px-6 py-3 text-right text-sm font-mono text-zinc-300 tabular-nums">{user.stats ? formatHours(user.stats.hours_watched) : '0'}</td>
      <td className="px-6 py-3 text-right text-sm font-mono text-zinc-400 tabular-nums">{user.stats ? formatNumber(user.stats.channel_points_farmed) : '0'}</td>
      <td className="px-6 py-3 text-sm text-zinc-500">{formatRelativeTime(user.last_seen)}</td>
      <td className="px-6 py-3 text-right">
        {isExpanded ? <ChevronUp size={16} className="text-zinc-500" /> : <ChevronDown size={16} className="text-zinc-600 group-hover:text-zinc-400" />}
      </td>
    </tr>
    {isExpanded && (
      <tr className="bg-zinc-900/30">
        <td colSpan={8} className="px-6 py-0">
          <div className="py-5 pl-16 grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Identity</h4>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-zinc-400"><span>ID</span> <span className="font-mono text-zinc-500">{user.id}</span></div>
                <div className="flex justify-between text-zinc-400"><span>Joined</span> <span>{new Date(user.created_at).toLocaleDateString()}</span></div>
                <div className="flex justify-between text-zinc-400"><span>Last seen</span> <span>{new Date(user.last_seen).toLocaleString()}</span></div>
              </div>
            </div>
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Engagement</h4>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-zinc-400"><span>Streams watched</span> <span className="text-zinc-200 tabular-nums">{user.stats?.streams_watched || 0}</span></div>
                <div className="flex justify-between text-zinc-400"><span>Messages sent</span> <span className="text-zinc-200 tabular-nums">{user.stats?.messages_sent || 0}</span></div>
                <div className="flex justify-between text-zinc-400"><span>Hours watched</span> <span className="text-zinc-200 tabular-nums">{formatHours(user.stats?.hours_watched || 0)}</span></div>
                <div className="flex justify-between text-zinc-400"><span>Points farmed</span> <span className="text-zinc-200 tabular-nums">{formatNumber(user.stats?.channel_points_farmed || 0)}</span></div>
              </div>
            </div>
            <div className="flex items-end justify-end">
              <a
                href={`https://twitch.tv/${user.username}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-2 px-4 py-2 bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 rounded-lg text-sm font-medium transition-colors border border-violet-500/20"
              >
                <ExternalLink size={14} />
                Open on Twitch
              </a>
            </div>
          </div>
        </td>
      </tr>
    )}
  </>
);

// ---------------------------------------------------------------------------
// Recent signups feed
// ---------------------------------------------------------------------------

const RecentSignups = ({ users }: { users: UserWithStats[] }) => {
  const recent = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 3600_000;
    return [...users]
      .filter((u) => new Date(u.created_at).getTime() >= cutoff)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 6);
  }, [users]);

  if (recent.length === 0) return <div className="text-sm text-zinc-500">No new users in the last 14 days.</div>;
  return (
    <div className="space-y-2">
      {recent.map((u) => (
        <div key={u.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.02] transition-colors">
          {u.avatar_url ? (
            <img src={u.avatar_url} alt="" className="w-7 h-7 rounded-full ring-1 ring-white/10 flex-shrink-0" />
          ) : (
            <div className="w-7 h-7 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400 ring-1 ring-white/10 flex-shrink-0">
              {u.display_name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm text-zinc-200 truncate">{u.display_name}</div>
            <div className="text-xs text-zinc-500">joined {formatRelativeTime(u.created_at)}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const configured = isSupabaseConfigured();

  const [presenceSnapshot, setPresenceSnapshot] = useState<OnlinePresenceSnapshot>({
    authedUsers: [], anonKeyCount: 0, totalUnique: 0,
  });
  const [presenceReady, setPresenceReady] = useState(false);
  const [users, setUsers] = useState<UserWithStats[]>([]);
  const [globalStats, setGlobalStats] = useState<GlobalStats>({
    total_channel_points: 0, total_hours_watched: 0, total_messages_sent: 0, total_streams_watched: 0,
  });
  const [isLoading, setIsLoading] = useState(configured);
  const [health, setHealth] = useState<WriteHealth | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const onlineUserIds = useMemo(
    () => new Set(presenceSnapshot.authedUsers.map((u) => u.user_id)),
    [presenceSnapshot]
  );
  const liveInfoById = useMemo(() => {
    const m = new Map<string, OnlineUser>();
    for (const u of presenceSnapshot.authedUsers) m.set(u.user_id, u);
    return m;
  }, [presenceSnapshot]);

  const activity: ActivitySummary = useMemo(() => computeActivitySummary(users), [users]);
  const versions: VersionRow[] = useMemo(() => computeVersionDistribution(users), [users]);

  const refreshHealth = useCallback(async () => {
    const result = await runWriteHealthProbe();
    setHealth(result);
  }, []);

  useEffect(() => {
    if (!configured) return;

    let cancelled = false;
    const fetchInitial = async () => {
      setIsLoading(true);
      const usersList = await getAllUsersWithStats();
      const stats = await getGlobalStats();
      if (!cancelled) {
        setUsers(usersList);
        setGlobalStats(stats);
        setIsLoading(false);
      }
    };
    fetchInitial();
    refreshHealth();

    const unsubPresence = subscribeToOnlinePresence((snap) => {
      setPresenceSnapshot(snap);
      setPresenceReady(isPresenceReady());
    });

    const unsubStats = subscribeToStatsChanges((usersList, stats) => {
      setUsers(usersList);
      setGlobalStats(stats);
    });

    // Re-probe health every 60 seconds so a transient outage clears itself.
    const healthInterval = setInterval(refreshHealth, 60_000);

    return () => {
      cancelled = true;
      if (unsubPresence) unsubPresence();
      if (unsubStats) unsubStats();
      clearInterval(healthInterval);
    };
  }, [configured, refreshKey, refreshHealth]);

  const handleRefresh = async () => {
    if (!configured) return;
    setIsLoading(true);
    setRefreshKey((k) => k + 1);
    const usersList = await getAllUsersWithStats();
    const stats = await getGlobalStats();
    setUsers(usersList);
    setGlobalStats(stats);
    await refreshHealth();
    setIsLoading(false);
  };

  if (!configured) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="glass-panel p-12 rounded-2xl max-w-lg w-full text-center">
          <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-6">
            <Activity className="text-red-500 w-10 h-10" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Configuration Required</h1>
          <p className="text-zinc-400">
            VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing from .env. Check the analytics-dashboard directory.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen font-sans text-zinc-200 pb-20">
      <nav className="sticky top-0 z-50 glass-panel border-b border-white/5 backdrop-blur-xl">
        <div className="max-w-[1920px] mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
              <Activity className="text-violet-300 w-4 h-4" />
            </div>
            <span className="font-semibold text-lg tracking-tight text-white">
              StreamNook<span className="text-zinc-500 font-normal"> Analytics</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <HealthBadge health={health} presenceReady={presenceReady} />
            <button
              onClick={handleRefresh}
              className={`p-2 rounded-lg hover:bg-white/5 transition-colors ${isLoading ? 'animate-spin' : ''}`}
              title="Refresh"
            >
              <RefreshCw size={16} className="text-zinc-400 hover:text-white" />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-[1920px] mx-auto px-6 py-8">
        <HealthBanner health={health} />

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <StatCard
            title="Online now"
            value={presenceReady ? presenceSnapshot.totalUnique : '...'}
            subtitle={presenceReady
              ? `${presenceSnapshot.authedUsers.length} signed in${presenceSnapshot.anonKeyCount > 0 ? `, ${presenceSnapshot.anonKeyCount} anon` : ''}`
              : 'connecting'}
            icon={Radio}
            accent="bg-emerald-500/15 text-emerald-300"
          />
          <StatCard
            title="Active (1h)"
            value={activity.activeLastHour}
            icon={Clock}
            accent="bg-amber-500/15 text-amber-300"
          />
          <StatCard
            title="DAU"
            value={activity.dau}
            subtitle="last 24h"
            icon={TrendingUp}
            accent="bg-violet-500/15 text-violet-300"
          />
          <StatCard
            title="WAU"
            value={activity.wau}
            subtitle="last 7 days"
            icon={TrendingUp}
            accent="bg-cyan-500/15 text-cyan-300"
          />
          <StatCard
            title="Total users"
            value={formatNumber(users.length)}
            subtitle={`+${activity.newThisWeek} this week`}
            icon={Users}
            accent="bg-pink-500/15 text-pink-300"
          />
          <StatCard
            title="Messages"
            value={formatNumber(globalStats.total_messages_sent)}
            subtitle={`${formatHours(globalStats.total_hours_watched)} hours`}
            icon={MessageSquare}
            accent="bg-blue-500/15 text-blue-300"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <UserTable
              users={users}
              onlineUserIds={onlineUserIds}
              liveInfoById={liveInfoById}
            />
          </div>

          <div className="space-y-6">
            <section className="glass-panel p-5 rounded-2xl">
              <h3 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
                <Radio size={16} className="text-emerald-400" />
                Live right now
              </h3>
              <LiveUsersPanel snapshot={presenceSnapshot} presenceReady={presenceReady} />
            </section>

            <section className="glass-panel p-5 rounded-2xl">
              <h3 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
                <Package size={16} className="text-cyan-400" />
                Version distribution
              </h3>
              <VersionDistribution rows={versions} total={users.length} />
            </section>

            <section className="glass-panel p-5 rounded-2xl">
              <h3 className="text-sm font-semibold text-zinc-300 mb-4 flex items-center gap-2">
                <UserPlus size={16} className="text-pink-400" />
                Recent signups
              </h3>
              <RecentSignups users={users} />
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
