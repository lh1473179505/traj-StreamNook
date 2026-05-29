import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FolderOpen,
  HardDrive,
  Package,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { Tooltip } from '../ui/Tooltip';
import ProxyHealthChecker from './ProxyHealthChecker';
import { SettingsSection, SettingsRow, SegmentedSelect } from './_primitives';

import { Logger } from '../../utils/logger';

interface StreamlinkValidation {
  resolved_path: string;
  exists: boolean;
  version: string | null;
  error: string | null;
}

interface DetectedStreamlinkInstall {
  label: string;
  path: string;
  version: string | null;
  is_bundled: boolean;
}


const Toggle = ({ enabled, onChange }: { enabled: boolean; onChange: () => void }) => (
  <button
    onClick={onChange}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-accent' : 'bg-gray-600'
      }`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'
        }`}
    />
  </button>
);

const PlayerSettings = () => {
  const { settings, updateSettings } = useAppStore();

  const streamlinkDefaults = {
    low_latency_enabled: true,
    hls_live_edge: 3,
    stream_timeout: 60,
    retry_streams: 3,
    disable_hosting: true,
    skip_ssl_verify: false,
    use_proxy: true,
    proxy_playlist: '--twitch-proxy-playlist=https://lb-na.cdn-perfprod.com,https://eu.luminous.dev --twitch-proxy-playlist-fallback',
    custom_streamlink_path: undefined,
    last_applied_proxy_id: undefined,
    proxy_auto_optimized: true,
    proxy_optimized_once: false,
    enhanced_codecs: true,
  };

  const streamlink = settings.streamlink || streamlinkDefaults;
  const autoSwitch = settings.auto_switch;
  const autoSwitchEnabled = autoSwitch?.enabled ?? true;
  const autoSwitchMode = autoSwitch?.mode ?? 'same_category';
  const autoSwitchNotification = autoSwitch?.show_notification ?? true;
  const autoSwitchRaid = autoSwitch?.auto_redirect_on_raid ?? true;
  const autoSwitchOfflineChat = autoSwitch?.stay_in_offline_chat ?? false;
  const videoPlayer = settings.video_player;

  const [validation, setValidation] = useState<StreamlinkValidation | null>(null);
  const [detectedInstalls, setDetectedInstalls] = useState<DetectedStreamlinkInstall[] | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const runValidation = useCallback(async (path: string | undefined) => {
    try {
      const result = await invoke<StreamlinkValidation>('validate_streamlink_install', {
        path: path || null,
      });
      setValidation(result);
    } catch (e) {
      Logger.error('Failed to validate Streamlink install:', e);
      setValidation({ resolved_path: '', exists: false, version: null, error: String(e) });
    }
  }, []);

  useEffect(() => {
    runValidation(streamlink.custom_streamlink_path);
  }, [streamlink.custom_streamlink_path, runValidation]);

  useEffect(() => {
    if (validation && (validation.error || !validation.exists)) {
      setAdvancedOpen(true);
    }
  }, [validation]);

  useEffect(() => {
    if (!advancedOpen || detectedInstalls !== null) return;
    invoke<DetectedStreamlinkInstall[]>('detect_streamlink_installs')
      .then(setDetectedInstalls)
      .catch((e) => {
        Logger.error('Failed to detect Streamlink installs:', e);
        setDetectedInstalls([]);
      });
  }, [advancedOpen, detectedInstalls]);

  const handleSelectStreamlinkFolder = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'streamlinkw.exe', extensions: ['exe'] }],
        title: 'Select streamlinkw.exe',
      });

      if (selected && typeof selected === 'string') {
        updateSettings({
          ...settings,
          streamlink: { ...streamlink, custom_streamlink_path: selected },
        });
      }
    } catch (error) {
      Logger.error('Failed to open file picker:', error);
    }
  };

  const handleSelectInstall = (install: DetectedStreamlinkInstall) => {
    updateSettings({
      ...settings,
      streamlink: {
        ...streamlink,
        custom_streamlink_path: install.is_bundled ? undefined : install.path,
      },
    });
  };

  const handleClearStreamlinkPath = () => {
    updateSettings({
      ...settings,
      streamlink: { ...streamlink, custom_streamlink_path: undefined },
    });
  };

  const setAutoSwitch = (patch: Partial<NonNullable<typeof autoSwitch>>) => {
    updateSettings({
      ...settings,
      auto_switch: {
        enabled: autoSwitchEnabled,
        mode: autoSwitchMode,
        show_notification: autoSwitchNotification,
        auto_redirect_on_raid: autoSwitchRaid,
        stay_in_offline_chat: autoSwitchOfflineChat,
        ...patch,
      },
    });
  };

  return (
    <div className="space-y-8">
      <p className="text-sm text-textSecondary px-1">
        Most player controls (volume, quality, playback speed) are available directly in the video player.
        These settings control advanced streaming behavior.
      </p>

      <SettingsSection
        id="settings-section-auto-switch"
        label="Auto-Switch"
        description="When a stream goes offline, automatically switch to another stream."
      >
        <SettingsRow
          title="Enable Auto-Switch"
          description="Automatically switch when current stream goes offline"
          control={
            <Toggle
              enabled={autoSwitchEnabled}
              onChange={() => setAutoSwitch({ enabled: !autoSwitchEnabled })}
            />
          }
        />

        <SettingsRow
          title="Switch To"
          description={
            autoSwitchMode === 'same_category'
              ? 'Switch to the highest viewer stream in the same game/category'
              : 'Switch to one of your live followed streamers'
          }
          disabled={!autoSwitchEnabled}
        >
          <SegmentedSelect
            value={autoSwitchMode}
            onChange={(mode) => setAutoSwitch({ mode })}
            options={[
              { value: 'same_category', label: 'Same Category' },
              { value: 'followed_streams', label: 'Followed Streams' },
            ]}
          />
        </SettingsRow>

        <SettingsRow
          title="Show Notification"
          description="Display a toast when auto-switching streams"
          disabled={!autoSwitchEnabled}
          control={
            <Toggle
              enabled={autoSwitchNotification}
              onChange={() => setAutoSwitch({ show_notification: !autoSwitchNotification })}
            />
          }
        />

        <SettingsRow
          title="Auto-Redirect on Raid"
          description="Automatically follow raids to the target channel (requires login)"
          control={
            <Toggle
              enabled={autoSwitchRaid}
              onChange={() => setAutoSwitch({ auto_redirect_on_raid: !autoSwitchRaid })}
            />
          }
        />

        <SettingsRow
          title="Stay in Offline Chat"
          description="Don't auto-switch when stream ends, stay in the chat room instead"
          control={
            <Toggle
              enabled={autoSwitchOfflineChat}
              onChange={() => setAutoSwitch({ stay_in_offline_chat: !autoSwitchOfflineChat })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        id="settings-section-streamlink-location"
        label="Streamlink"
        bare
      >
        {validation && (!validation.exists || validation.error) && (
          <div className="glass-panel rounded-lg p-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-red-500/10 flex-shrink-0">
                <AlertTriangle size={16} className="text-red-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-textPrimary">Streamlink isn't responding</p>
                <p className="text-xs text-textSecondary mt-1.5 break-words font-mono leading-relaxed">
                  {validation.error || `Not found at: ${validation.resolved_path}`}
                </p>
                <p className="text-xs text-textSecondary mt-2">
                  Pick a different install below, or reinstall StreamNook to repair the bundled copy.
                </p>
              </div>
            </div>
          </div>
        )}

        {streamlink.custom_streamlink_path && validation && !validation.error && validation.exists && (
          <div className="glass-panel rounded-lg p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-accent/10 flex-shrink-0">
              <CheckCircle2 size={16} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[10px] font-semibold text-textSecondary uppercase tracking-wider">
                  Custom install
                </p>
                {validation.version && (
                  <span className="glass-badge px-2 py-0.5 text-[10px] text-textSecondary rounded-full">
                    {validation.version.replace(/^streamlink\s+/i, 'v')}
                  </span>
                )}
              </div>
              <Tooltip content={validation.resolved_path}>
              <p
                className="text-xs text-textPrimary truncate font-mono mt-0.5"
              >
                {validation.resolved_path}
              </p>
              </Tooltip>
            </div>
            <button
              onClick={handleClearStreamlinkPath}
              className="glass-button px-3 py-1.5 text-xs text-textPrimary rounded flex-shrink-0"
            >
              Use bundled
            </button>
          </div>
        )}

        <details
          open={advancedOpen}
          onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}
          className="group glass-panel px-4 py-2"
        >
          <summary className="cursor-pointer list-none flex items-center gap-1.5 py-1 text-sm font-medium text-textSecondary hover:text-textPrimary select-none transition-colors">
            <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
            Advanced
          </summary>
          <div className="mt-3 space-y-3 pb-2">
            <p className="text-xs text-textSecondary leading-relaxed">
              Most users don't need to change this. Use a different Streamlink install only if you maintain your own.
            </p>

            {detectedInstalls === null ? (
              <div className="rounded-lg p-4 text-center bg-glass">
                <p className="text-xs text-textSecondary italic">Scanning for installs...</p>
              </div>
            ) : detectedInstalls.length === 0 ? (
              <div className="rounded-lg p-5 text-center bg-glass">
                <Package size={20} className="text-textSecondary/40 mx-auto mb-2" />
                <p className="text-xs text-textSecondary">No Streamlink installs detected on this system.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {detectedInstalls.map((install) => {
                  const isSelected = install.is_bundled
                    ? !streamlink.custom_streamlink_path
                    : streamlink.custom_streamlink_path === install.path;
                  const Icon = install.is_bundled ? Package : HardDrive;
                  return (
                    <button
                      key={install.path}
                      onClick={() => handleSelectInstall(install)}
                      className={`w-full rounded-lg p-3 text-left transition-all bg-glass ${
                        isSelected ? 'ring-1 ring-accent/40' : 'hover:bg-glass-hover'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`p-2 rounded-lg flex-shrink-0 transition-colors ${
                            isSelected ? 'bg-accent/15' : 'bg-glass'
                          }`}
                        >
                          <Icon
                            size={14}
                            className={isSelected ? 'text-accent' : 'text-textSecondary'}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-textPrimary">{install.label}</p>
                            {install.version && (
                              <span className="glass-badge px-1.5 py-0.5 text-[10px] text-textSecondary rounded-full">
                                {install.version.replace(/^streamlink\s+/i, 'v')}
                              </span>
                            )}
                          </div>
                          <Tooltip content={install.path}>
                          <p
                            className="text-xs text-textSecondary truncate font-mono mt-0.5"
                          >
                            {install.path}
                          </p>
                          </Tooltip>
                        </div>
                        <div
                          className={`mt-1 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                            isSelected ? 'border-accent' : 'border-textSecondary/40'
                          }`}
                        >
                          {isSelected && <div className="w-2 h-2 rounded-full bg-accent" />}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <button
              onClick={handleSelectStreamlinkFolder}
              className="glass-button px-3 py-2 text-xs text-textPrimary rounded flex items-center gap-2"
            >
              <FolderOpen size={14} />
              Browse for streamlinkw.exe
            </button>
          </div>
        </details>
      </SettingsSection>

      <SettingsSection
        id="settings-section-streamlink-optimization"
        label="Streamlink Optimization"
      >
        <SettingsRow
          title="Twitch Low Latency Mode"
          description="Uses Twitch's low latency streaming (forces --twitch-low-latency)"
          control={
            <Toggle
              enabled={streamlink.low_latency_enabled}
              onChange={() =>
                updateSettings({
                  ...settings,
                  streamlink: { ...streamlink, low_latency_enabled: !streamlink.low_latency_enabled },
                })
              }
            />
          }
        />

        <SettingsRow
          title="Allow h265 + AV1 codecs"
          description="Request AV1 and HEVC stream variants in addition to h264. Some Twitch channels ship more efficient encodings at the same resolution. Turn off if you see decode errors on older hardware."
          control={
            <Toggle
              enabled={streamlink.enhanced_codecs ?? true}
              onChange={() =>
                updateSettings({
                  ...settings,
                  streamlink: { ...streamlink, enhanced_codecs: !(streamlink.enhanced_codecs ?? true) },
                })
              }
            />
          }
        />

        <SettingsRow
          title={`HLS Live Edge: ${streamlink.hls_live_edge} segments`}
          description="How many segments from the live edge to stay (lower = less latency, less stability)"
        >
          <input
            type="range"
            min="1"
            max="10"
            step="1"
            value={streamlink.hls_live_edge}
            onChange={(e) =>
              updateSettings({
                ...settings,
                streamlink: { ...streamlink, hls_live_edge: parseInt(e.target.value) },
              })
            }
            className="w-full accent-accent cursor-pointer"
          />
        </SettingsRow>

        <SettingsRow
          title={`Stream Timeout: ${streamlink.stream_timeout}s`}
          description="How long to wait for stream response before timing out"
        >
          <input
            type="range"
            min="30"
            max="120"
            step="5"
            value={streamlink.stream_timeout}
            onChange={(e) =>
              updateSettings({
                ...settings,
                streamlink: { ...streamlink, stream_timeout: parseInt(e.target.value) },
              })
            }
            className="w-full accent-accent cursor-pointer"
          />
        </SettingsRow>

        <SettingsRow
          title={`Auto-Retry Count: ${streamlink.retry_streams}`}
          description="Number of times to automatically retry on stream errors (0 = no retry)"
        >
          <input
            type="range"
            min="0"
            max="5"
            step="1"
            value={streamlink.retry_streams}
            onChange={(e) =>
              updateSettings({
                ...settings,
                streamlink: { ...streamlink, retry_streams: parseInt(e.target.value) },
              })
            }
            className="w-full accent-accent cursor-pointer"
          />
        </SettingsRow>

        <SettingsRow
          title="Disable Hosting"
          description="Skip streams that are hosting other channels"
          control={
            <Toggle
              enabled={streamlink.disable_hosting}
              onChange={() =>
                updateSettings({
                  ...settings,
                  streamlink: { ...streamlink, disable_hosting: !streamlink.disable_hosting },
                })
              }
            />
          }
        />

        <SettingsRow
          title="Use Proxy Routing"
          description="Route playlists through CDN proxies (recommended for ad-blocking)"
          control={
            <Toggle
              enabled={streamlink.use_proxy}
              onChange={() =>
                updateSettings({
                  ...settings,
                  streamlink: { ...streamlink, use_proxy: !streamlink.use_proxy },
                })
              }
            />
          }
        >
          {streamlink.use_proxy && (
            <div className="space-y-4">
              <ProxyHealthChecker />

              <details className="group">
                <summary className="cursor-pointer text-sm font-medium text-textSecondary hover:text-textPrimary transition-colors flex items-center gap-2">
                  <span className="transform transition-transform group-open:rotate-90">▶</span>
                  Advanced: Manual Proxy Configuration
                </summary>
                <div className="mt-3 p-3 bg-glass rounded-lg">
                  <label className="block text-sm font-medium text-textPrimary mb-2">
                    Proxy Arguments
                  </label>
                  <input
                    type="text"
                    value={streamlink.proxy_playlist}
                    onChange={(e) =>
                      updateSettings({
                        ...settings,
                        streamlink: { ...streamlink, proxy_playlist: e.target.value },
                      })
                    }
                    className="w-full glass-input text-textPrimary text-sm px-3 py-2 font-mono"
                    placeholder="--twitch-proxy-playlist=https://..."
                  />
                  <p className="text-xs text-textSecondary mt-1">
                    Custom proxy playlist arguments. Use the health checker above to auto-generate optimal settings,
                    or manually specify proxy URLs here.
                  </p>
                </div>
              </details>
            </div>
          )}
        </SettingsRow>

        <SettingsRow
          title="Skip SSL Verification"
          description="Only enable if you have connection issues (not recommended)"
          control={
            <Toggle
              enabled={streamlink.skip_ssl_verify}
              onChange={() =>
                updateSettings({
                  ...settings,
                  streamlink: { ...streamlink, skip_ssl_verify: !streamlink.skip_ssl_verify },
                })
              }
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        id="settings-section-video-player"
        label="Video Player"
      >
        <SettingsRow
          title="Autoplay"
          description="Automatically play stream when loaded"
          control={
            <Toggle
              enabled={videoPlayer?.autoplay ?? true}
              onChange={() =>
                updateSettings({
                  ...settings,
                  video_player: { ...videoPlayer, autoplay: !(videoPlayer?.autoplay ?? true) },
                })
              }
            />
          }
        />

        <SettingsRow
          title="Low Latency Mode"
          description="Reduce stream delay for live content (may affect stability)"
          control={
            <Toggle
              enabled={videoPlayer?.low_latency_mode ?? true}
              onChange={() =>
                updateSettings({
                  ...settings,
                  video_player: { ...videoPlayer, low_latency_mode: !(videoPlayer?.low_latency_mode ?? true) },
                })
              }
            />
          }
        />

        <SettingsRow
          title={`Max Buffer Length: ${videoPlayer?.max_buffer_length ?? 120}s`}
          description="Maximum amount of video to buffer ahead (higher = more stable, but more delay)"
        >
          <input
            type="range"
            min="3"
            max="300"
            step="1"
            value={videoPlayer?.max_buffer_length ?? 120}
            onChange={(e) =>
              updateSettings({
                ...settings,
                video_player: {
                  ...videoPlayer,
                  max_buffer_length: parseInt(e.target.value),
                },
              })
            }
            className="w-full accent-accent cursor-pointer"
          />
        </SettingsRow>

        <SettingsRow
          title="Default Stream Quality"
          description="Quality to use when starting streams (you can change quality anytime using the player controls)"
        >
          <select
            value={settings.quality}
            onChange={(e) =>
              updateSettings({
                ...settings,
                quality: e.target.value,
              })
            }
            className="w-full glass-input text-textPrimary text-sm px-3 py-2"
          >
            {/* Quality strings match Twitch's player UI. The Rust closest-match
                picker + equivalence rule reconcile naming with whatever string
                Streamlink actually returns for the channel (`480p` vs `480p30`
                etc., both show up in the wild). */}
            <option value="best">Auto (Source)</option>
            <option value="1440p60">1440p60</option>
            <option value="1080p60">1080p60</option>
            <option value="720p60">720p60</option>
            <option value="480p30">480p30</option>
            <option value="360p30">360p30</option>
            <option value="160p30">160p30</option>
            <option value="audio_only">Audio Only</option>
          </select>
        </SettingsRow>

        <SettingsRow
          title="Lock Aspect Ratio (16:9)"
          description="Prevent letterboxing by constraining window resize to maintain video aspect ratio"
          control={
            <Toggle
              enabled={videoPlayer?.lock_aspect_ratio ?? false}
              onChange={() =>
                updateSettings({
                  ...settings,
                  video_player: { ...videoPlayer, lock_aspect_ratio: !(videoPlayer?.lock_aspect_ratio ?? false) },
                })
              }
            />
          }
        />

        <SettingsRow
          title="Start Muted"
          description="Begin playback with audio muted"
          control={
            <Toggle
              enabled={videoPlayer?.muted ?? false}
              onChange={() =>
                updateSettings({
                  ...settings,
                  video_player: { ...videoPlayer, muted: !(videoPlayer?.muted ?? false) },
                })
              }
            />
          }
        />

        <SettingsRow
          title={`Default Volume: ${Math.round((videoPlayer?.volume ?? 1.0) * 100)}%`}
          description="Initial volume level when starting playback"
        >
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={videoPlayer?.volume ?? 1.0}
            onChange={(e) =>
              updateSettings({
                ...settings,
                video_player: { ...videoPlayer, volume: parseFloat(e.target.value) },
              })
            }
            className="w-full accent-accent cursor-pointer"
          />
        </SettingsRow>
      </SettingsSection>
    </div>
  );
};

export default PlayerSettings;
