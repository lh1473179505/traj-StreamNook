import { useAppStore } from '../../stores/AppStore';
import { useState, useEffect } from 'react';
import { SettingsSection, SettingsRow } from './_primitives';

import { Logger } from '../../utils/logger';
const IntegrationsSettings = () => {
  const { settings, updateSettings } = useAppStore();
  const [ttvlolInstalledVersion, setTtvlolInstalledVersion] = useState<string | null>(null);

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

  useEffect(() => {
    const loadTtvlolVersion = async () => {
      if (!settings.ttvlol_plugin?.enabled) {
        setTtvlolInstalledVersion(null);
        return;
      }

      try {
        const { invoke } = await import('@tauri-apps/api/core');

        const installed = (await invoke('get_installed_ttvlol_version')) as string | null;
        setTtvlolInstalledVersion(installed);

        if (installed && installed !== settings.ttvlol_plugin.installed_version) {
          updateSettings({
            ...settings,
            ttvlol_plugin: { ...settings.ttvlol_plugin, installed_version: installed },
          });
        }
      } catch (error) {
        Logger.error('Failed to get TTV LOL plugin version:', error);
        setTtvlolInstalledVersion(null);
      }
    };

    loadTtvlolVersion();
  }, [settings.ttvlol_plugin?.enabled]);

  const handleTtvlolToggle = async () => {
    const enabled = !(settings.ttvlol_plugin?.enabled ?? false);

    if (enabled) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const installedVersion = (await invoke(
          'get_installed_ttvlol_version'
        )) as string | null;

        if (!installedVersion) {
          const { addToast } = useAppStore.getState();
          addToast('Downloading TTV LOL plugin...', 'info');

          try {
            const version = (await invoke(
              'download_and_install_ttvlol_plugin'
            )) as string;
            addToast(`TTV LOL plugin v${version} installed successfully!`, 'success');
            updateSettings({
              ...settings,
              ttvlol_plugin: { enabled: true, installed_version: version },
            });
          } catch (error) {
            Logger.error('Failed to download plugin:', error);
            addToast('Failed to download TTV LOL plugin: ' + error, 'error');
            return;
          }
        } else {
          updateSettings({
            ...settings,
            ttvlol_plugin: { ...settings.ttvlol_plugin, enabled: true },
          });
        }
      } catch (error) {
        Logger.error('Failed to check plugin:', error);
      }
    } else {
      updateSettings({
        ...settings,
        ttvlol_plugin: { ...settings.ttvlol_plugin, enabled: false },
      });
    }
  };

  return (
    <div className="space-y-8">
      <SettingsSection label="Discord">
        <SettingsRow
          title="Discord Rich Presence"
          description="Show what you're watching on Discord"
          control={
            <Toggle
              enabled={settings.discord_rpc_enabled}
              onChange={() => updateSettings({ ...settings, discord_rpc_enabled: !settings.discord_rpc_enabled })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection label="TTV LOL Ad Blocker Plugin">
        <SettingsRow
          title="Enable TTV LOL Plugin"
          description={
            settings.ttvlol_plugin?.enabled && ttvlolInstalledVersion
              ? `Block ads on Twitch streams using the TTV LOL plugin. Installed version: ${ttvlolInstalledVersion}`
              : 'Block ads on Twitch streams using the TTV LOL plugin'
          }
          control={
            <Toggle
              enabled={settings.ttvlol_plugin?.enabled ?? false}
              onChange={handleTtvlolToggle}
            />
          }
        />
      </SettingsSection>
    </div>
  );
};

export default IntegrationsSettings;
