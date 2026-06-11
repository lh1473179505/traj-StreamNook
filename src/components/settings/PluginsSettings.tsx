import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Globe,
  KeyRound,
  Trash2,
} from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { SettingsSection } from './_primitives';
import { Tooltip } from '../ui/Tooltip';
import TierBadge from '../plugins/TierBadge';
import PluginConsentModal, { ConsentSubject } from '../plugins/PluginConsentModal';
import PluginPanelRenderer from '../plugins/PluginPanelRenderer';
import {
  capabilityLines,
  IndexEntry,
  PluginInfo,
  SourceInfo,
} from '../../types/plugins';
import { Logger } from '../../utils/logger';

const Toggle = ({ enabled, onChange }: { enabled: boolean; onChange: () => void }) => (
  <button
    type="button"
    onClick={onChange}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
      enabled ? 'bg-accent' : 'bg-gray-600'
    }`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        enabled ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

const PluginsSettings = () => {
  const addToast = useAppStore((s) => s.addToast);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [browse, setBrowse] = useState<{ url: string; entries: IndexEntry[] } | null>(null);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [confirmSourceUrl, setConfirmSourceUrl] = useState<string | null>(null);
  const [localDir, setLocalDir] = useState('');
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState<{
    subject: ConsentSubject;
    proceed: () => Promise<void>;
    abort?: () => Promise<void>;
  } | null>(null);
  const [confirmUninstall, setConfirmUninstall] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [pluginList, sourceList] = await Promise.all([
        invoke<PluginInfo[]>('plugins_list'),
        invoke<SourceInfo[]>('plugins_sources'),
      ]);
      setPlugins(pluginList);
      setSources(sourceList);
    } catch (err) {
      Logger.error('[Plugins] refresh failed:', err);
    }
  }, []);

  useEffect(() => {
    refresh();
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const setup = async () => {
      for (const eventName of ['plugin://state-changed', 'plugin://panels-changed']) {
        const un = await listen(eventName, () => refresh());
        if (disposed) un();
        else unlisteners.push(un);
      }
    };
    setup();
    return () => {
      disposed = true;
      unlisteners.forEach((un) => un());
    };
  }, [refresh]);

  const fail = (err: unknown) => {
    Logger.error('[Plugins] action failed:', err);
    addToast(String(err), 'error');
  };

  const setEnabled = async (plugin: PluginInfo, enabled: boolean) => {
    const apply = async () => {
      try {
        await invoke('plugins_set_enabled', { pluginId: plugin.id, enabled });
        await refresh();
      } catch (err) {
        fail(err);
      }
    };
    // Tier C never enables on a single click: the full risk dialog gates
    // every enable. A and B consent at install (index) or first enable
    // (local-dev folders, tracked per id and version).
    const devConsentKey = `plugin-consent:${plugin.id}@${plugin.version}`;
    const needsDialog =
      enabled &&
      (plugin.tier === 'C' ||
        (plugin.source === 'local-dev' && !localStorage.getItem(devConsentKey)));
    if (needsDialog) {
      setConsent({
        subject: {
          name: plugin.name,
          author: plugin.author,
          version: plugin.version,
          tier: plugin.tier,
          caps: plugin.granted,
          sourceName: plugin.source === 'local-dev' ? 'a local folder' : plugin.source,
          action: 'Enable',
        },
        proceed: async () => {
          localStorage.setItem(devConsentKey, '1');
          await apply();
        },
      });
    } else {
      await apply();
    }
  };

  const installFromSource = async (source: SourceInfo, entry: IndexEntry) => {
    // Two-step install: download, verify, and stage first; the consent
    // dialog then shows the actual manifest capabilities; commit registers.
    setBusy(true);
    try {
      const preview = await invoke<{ token: string; record: PluginInfo }>(
        'plugins_begin_install',
        { sourceUrl: source.url, pluginId: entry.id }
      );
      setConsent({
        subject: {
          name: preview.record.name,
          author: preview.record.author,
          version: preview.record.version,
          tier: preview.record.tier,
          caps: preview.record.granted,
          sourceName: source.name,
          action: 'Install',
        },
        proceed: async () => {
          try {
            await invoke<PluginInfo>('plugins_commit_install', { token: preview.token });
            addToast(`Installed ${entry.name} (disabled until you enable it)`, 'success');
            await refresh();
          } catch (err) {
            fail(err);
          }
        },
        abort: async () => {
          await invoke('plugins_cancel_install', { token: preview.token }).catch(() => {});
        },
      });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const installLocal = async () => {
    if (!localDir.trim()) return;
    setBusy(true);
    try {
      const plugin = await invoke<PluginInfo>('plugins_install_local', {
        dir: localDir.trim(),
      });
      addToast(`Registered ${plugin.name} from folder (disabled until you enable it)`, 'success');
      setLocalDir('');
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const addSource = async () => {
    if (!confirmSourceUrl) return;
    setBusy(true);
    try {
      const source = await invoke<SourceInfo>('plugins_add_source', { url: confirmSourceUrl });
      addToast(`Added source "${source.name}" (key ${source.fingerprint})`, 'success');
      setNewSourceUrl('');
      await refresh();
    } catch (err) {
      fail(err);
    } finally {
      setConfirmSourceUrl(null);
      setBusy(false);
    }
  };

  const uninstall = async (pluginId: string) => {
    try {
      await invoke('plugins_uninstall', { pluginId });
      setConfirmUninstall(null);
      await refresh();
    } catch (err) {
      fail(err);
    }
  };

  const doBrowse = async (source: SourceInfo) => {
    if (browse?.url === source.url) {
      setBrowse(null);
      return;
    }
    try {
      const entries = await invoke<IndexEntry[]>('plugins_browse_source', { url: source.url });
      setBrowse({ url: source.url, entries });
    } catch (err) {
      fail(err);
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection
        label="Installed plugins"
        description="Plugins are separate programs StreamNook starts and talks to. The app ships with none; everything here is something you chose to add, and each one only gets the capabilities shown on its card."
        bare
      >
        {plugins.length === 0 && (
          <div className="settings-card px-4 py-6 text-center text-[13px] text-textSecondary">
            No plugins installed.
          </div>
        )}
        {plugins.map((plugin) => {
          const isExpanded = expanded === plugin.id;
          return (
            <div key={plugin.id} className="settings-card px-4 py-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : plugin.id)}
                  className="text-textSecondary hover:text-textPrimary transition-colors"
                >
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-textPrimary truncate">
                      {plugin.name}
                    </span>
                    <TierBadge tier={plugin.tier} />
                    {plugin.source === 'local-dev' && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-sky-500/15 text-sky-300 border border-sky-400/20">
                        Local dev
                      </span>
                    )}
                    {plugin.running && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    )}
                  </div>
                  <p className="text-[12px] text-textSecondary truncate">
                    v{plugin.version} by {plugin.author} · {plugin.description}
                  </p>
                </div>
                <Tooltip content="Uninstall">
                  <button
                    type="button"
                    onClick={() => setConfirmUninstall(plugin.id)}
                    className="p-1.5 rounded-md text-textSecondary hover:text-red-300 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </Tooltip>
                <Toggle
                  enabled={plugin.enabled}
                  onChange={() => setEnabled(plugin, !plugin.enabled)}
                />
              </div>

              {confirmUninstall === plugin.id && (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-red-500/10 border border-red-400/20 px-3 py-2">
                  <span className="text-[12px] text-red-200">
                    Uninstall {plugin.name} and delete its local state?
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmUninstall(null)}
                      className="px-2.5 py-1 rounded text-[12px] text-textSecondary hover:text-textPrimary"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => uninstall(plugin.id)}
                      className="px-2.5 py-1 rounded text-[12px] font-medium bg-red-500/20 text-red-200 hover:bg-red-500/30"
                    >
                      Uninstall
                    </button>
                  </div>
                </div>
              )}

              {isExpanded && (
                <div className="mt-3 space-y-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-textMuted pb-1">
                      What it can do
                    </div>
                    {capabilityLines(plugin.granted).map((line) => (
                      <div
                        key={line.text}
                        className={`py-1 text-[12px] leading-relaxed ${
                          line.warning ? 'text-red-300' : 'text-textSecondary'
                        }`}
                      >
                        {line.text}
                      </div>
                    ))}
                  </div>

                  {plugin.granted.credentials.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-textMuted pb-1">
                        Credential access
                      </div>
                      {plugin.granted.credentials.map((kind) => {
                        const state = plugin.credential_consent[kind] ?? 'ask';
                        return (
                          <div key={kind} className="flex items-center justify-between py-1">
                            <span className="text-[12px] text-textSecondary flex items-center gap-1.5">
                              <KeyRound size={12} className="text-red-300" />
                              {kind} ·{' '}
                              {state === 'always'
                                ? 'allowed without asking'
                                : state === 'revoked'
                                  ? 'revoked'
                                  : 'asks each session'}
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await invoke(
                                    state === 'revoked'
                                      ? 'plugins_reset_credential_consent'
                                      : 'plugins_revoke_credential',
                                    { pluginId: plugin.id, kind }
                                  );
                                  await refresh();
                                } catch (err) {
                                  fail(err);
                                }
                              }}
                              className="px-2 py-0.5 rounded text-[11px] bg-white/5 hover:bg-white/10 border border-white/10 text-textSecondary hover:text-textPrimary transition-colors"
                            >
                              {state === 'revoked' ? 'Allow asking again' : 'Revoke'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {plugin.has_panel && plugin.enabled && (
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-textMuted pb-2">
                        Plugin settings
                      </div>
                      <PluginPanelRenderer pluginId={plugin.id} />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </SettingsSection>

      <SettingsSection
        label="Sources"
        description="Where plugins come from. StreamNook does not review, host, or endorse plugins from community sources; each source signs its listings and the key is pinned the first time you add it."
        bare
      >
        {sources.length === 0 && (
          <div className="settings-card px-4 py-4 text-[13px] text-textSecondary">
            No sources yet. The official StreamNook index is not live in this build;
            community sources can be added below.
          </div>
        )}
        {sources.map((source) => (
          <div key={source.url} className="settings-card px-4 py-3">
            <div className="flex items-center gap-3">
              <Globe size={14} className="text-textSecondary flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium text-textPrimary truncate">
                  {source.name}
                  {source.official && (
                    <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-emerald-500/15 text-emerald-300 border border-emerald-400/20">
                      Official
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-textSecondary truncate font-mono">
                  {source.url} · key {source.fingerprint}
                </p>
              </div>
              <button
                type="button"
                onClick={() => doBrowse(source)}
                className="px-2.5 py-1 rounded text-[12px] bg-white/5 hover:bg-white/10 border border-white/10 text-textSecondary hover:text-textPrimary transition-colors"
              >
                {browse?.url === source.url ? 'Hide' : 'Browse'}
              </button>
              {!source.official && (
                <Tooltip content="Remove source">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await invoke('plugins_remove_source', { url: source.url });
                        if (browse?.url === source.url) setBrowse(null);
                        await refresh();
                      } catch (err) {
                        fail(err);
                      }
                    }}
                    className="p-1.5 rounded-md text-textSecondary hover:text-red-300 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </Tooltip>
              )}
            </div>

            {browse?.url === source.url && (
              <div className="mt-3 space-y-2">
                {browse.entries.length === 0 && (
                  <p className="text-[12px] text-textSecondary">This source lists no plugins.</p>
                )}
                {browse.entries.map((entry) => {
                  const installed = plugins.some(
                    (p) => p.id === entry.id && p.version === entry.version
                  );
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] text-textPrimary truncate">
                            {entry.name}
                          </span>
                          <TierBadge tier={entry.tier} />
                        </div>
                        <p className="text-[11px] text-textSecondary truncate">
                          v{entry.version} by {entry.author.name} · {entry.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy || installed}
                        onClick={() => installFromSource(source, entry)}
                        className={`px-2.5 py-1 rounded text-[12px] border transition-colors ${
                          installed
                            ? 'bg-white/5 border-white/10 text-textMuted cursor-default'
                            : 'bg-accent/15 hover:bg-accent/25 border-accent/25 text-textPrimary'
                        }`}
                      >
                        {installed ? 'Installed' : 'Install'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        <div className="settings-card px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newSourceUrl}
              onChange={(e) => setNewSourceUrl(e.target.value)}
              placeholder="https://example.org/index.json"
              className="glass-input flex-1 px-3 py-1.5 text-[13px] text-textPrimary"
            />
            <button
              type="button"
              disabled={busy || !newSourceUrl.trim().startsWith('https://')}
              onClick={() => setConfirmSourceUrl(newSourceUrl.trim())}
              className="px-3 py-1.5 rounded-lg text-[13px] bg-white/5 hover:bg-white/10 border border-white/10 text-textSecondary hover:text-textPrimary transition-colors disabled:opacity-50"
            >
              Add source
            </button>
          </div>
          {confirmSourceUrl && (
            <div className="mt-3 rounded-lg bg-amber-500/10 border border-amber-400/20 px-3 py-2.5">
              <p className="text-[12px] leading-relaxed text-amber-200">
                Add a community plugin source? StreamNook does not review, host, or
                endorse plugins from this source. It may list software that violates
                Twitch's Terms of Service. The source's signing key is verified and
                pinned when it is added; future updates must be signed with the same
                key.
              </p>
              <p className="mt-1.5 text-[11px] font-mono text-amber-200/80 truncate">
                {confirmSourceUrl}
              </p>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmSourceUrl(null)}
                  className="px-2.5 py-1 rounded text-[12px] text-textSecondary hover:text-textPrimary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={addSource}
                  className="px-2.5 py-1 rounded text-[12px] font-medium bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                >
                  Add source
                </button>
              </div>
            </div>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        label="Develop"
        description="Register a plugin straight from a folder containing plugin.toml. No signature chain applies; the plugin is labeled local dev and gets the same capability and consent gates."
        bare
      >
        <div className="settings-card px-4 py-3">
          <div className="flex items-center gap-2">
            <FolderOpen size={14} className="text-textSecondary flex-shrink-0" />
            <input
              type="text"
              value={localDir}
              onChange={(e) => setLocalDir(e.target.value)}
              placeholder="C:\path\to\my-plugin"
              className="glass-input flex-1 px-3 py-1.5 text-[13px] text-textPrimary font-mono"
            />
            <button
              type="button"
              disabled={busy || !localDir.trim()}
              onClick={installLocal}
              className="px-3 py-1.5 rounded-lg text-[13px] bg-white/5 hover:bg-white/10 border border-white/10 text-textSecondary hover:text-textPrimary transition-colors disabled:opacity-50"
            >
              Register
            </button>
          </div>
        </div>
      </SettingsSection>

      <PluginConsentModal
        subject={consent?.subject ?? null}
        onCancel={async () => {
          const abort = consent?.abort;
          setConsent(null);
          if (abort) await abort();
        }}
        onConfirm={async () => {
          const proceed = consent?.proceed;
          setConsent(null);
          if (proceed) await proceed();
        }}
      />
    </div>
  );
};

export default PluginsSettings;
