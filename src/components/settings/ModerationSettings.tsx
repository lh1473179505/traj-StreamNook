import { useAppStore } from '../../stores/AppStore';
import { SettingsSection, SettingsRow } from './_primitives';
import { MOD_LOG_CATEGORIES, MOD_LOG_STYLES, highlightContainerStyle } from '../../utils/modLogCategories';
import { Tooltip } from '../ui/Tooltip';

const Toggle = ({ enabled, onChange }: { enabled: boolean; onChange: () => void }) => (
  <button
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

const ModerationSettings = () => {
  const { settings, updateSettings } = useAppStore();
  const mod = settings.moderation ?? {};

  const setMod = (patch: Partial<typeof mod>) =>
    updateSettings({ ...settings, moderation: { ...mod, ...patch } });

  return (
    <div className="space-y-8">
      <SettingsSection
        label="Mod Logs"
        description="Recent moderation activity surface."
      >
        <SettingsRow
          title="Show Mod Logs panel"
          description="Display the recent moderation actions sidebar inside chat (timeouts, bans, deletions)."
          control={
            <Toggle
              enabled={settings.show_mod_logs ?? false}
              onChange={() =>
                updateSettings({ ...settings, show_mod_logs: !(settings.show_mod_logs ?? false) })
              }
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        label="Message Visibility"
        description="Controls how moderation events appear in chat. Defaults preserve the existing strikethrough behavior."
      >
        <SettingsRow
          title="Announce mod actions inline"
          description="Add an extra system row to chat when a mod times someone out, bans, or deletes a message. Stacks on top of the strikethrough you already see."
          control={
            <Toggle
              enabled={mod.show_mod_messages ?? false}
              onChange={() => setMod({ show_mod_messages: !(mod.show_mod_messages ?? false) })}
            />
          }
        />
        <SettingsRow
          title="Hide strikethrough on removed messages"
          description="Suppress the strikethrough overlay on banned, timed-out, or deleted messages so your backlog stays pristine."
          control={
            <Toggle
              enabled={mod.ignore_clear_chat ?? false}
              onChange={() => setMod({ ignore_clear_chat: !(mod.ignore_clear_chat ?? false) })}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        label="Log Highlights"
        description="Color-code mod-log entries by severity. Choose how the highlight shows, then customize any category's color."
      >
        <SettingsRow
          title="Highlight style"
          description="How each entry is emphasized by severity. The previews use a sample event."
        >
          <div className="grid grid-cols-3 gap-2">
            {MOD_LOG_STYLES.map(({ key, label }) => {
              const active = (mod.mod_log_highlight_style ?? 'box') === key;
              const sample = '#e5484d'; // representative (ban) color
              return (
                <button
                  key={key}
                  onClick={() => setMod({ mod_log_highlight_style: key })}
                  className={`flex flex-col items-center gap-1.5 rounded-lg p-1.5 transition-all ${
                    active ? 'ring-1 ring-white/20 bg-glass/40' : 'opacity-60 hover:opacity-100'
                  }`}
                >
                  <div
                    className="w-full rounded-md px-2 py-1.5 bg-secondary/60 border border-borderSubtle text-left"
                    style={highlightContainerStyle(key, sample)}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="h-2 w-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: sample }}
                      />
                      <span
                        className={`text-[10px] font-semibold truncate ${key === 'box' ? 'text-text' : ''}`}
                        style={key === 'box' ? undefined : { color: sample }}
                      >
                        Banned
                      </span>
                    </div>
                  </div>
                  <span
                    className={`text-[11px] ${active ? 'text-text font-medium' : 'text-textSecondary'}`}
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </SettingsRow>
        {MOD_LOG_CATEGORIES.map((c) => {
          const current = mod.mod_log_colors?.[c.key] || c.defaultColor;
          const overridden = !!mod.mod_log_colors?.[c.key];
          return (
            <SettingsRow key={c.key} title={c.label}>
              <div className="flex items-center gap-2">
                <Tooltip content={`${c.label} color`}>
                <input
                  type="color"
                  value={current}
                  onChange={(e) =>
                    setMod({
                      mod_log_colors: { ...(mod.mod_log_colors ?? {}), [c.key]: e.target.value },
                    })
                  }
                  className="h-7 w-10 rounded cursor-pointer bg-transparent border border-borderSubtle"
                />
                </Tooltip>
                {overridden && (
                  <button
                    onClick={() => {
                      const next = { ...(mod.mod_log_colors ?? {}) };
                      delete next[c.key];
                      setMod({ mod_log_colors: next });
                    }}
                    className="text-[11px] text-textSecondary hover:text-text"
                  >
                    Reset
                  </button>
                )}
              </div>
            </SettingsRow>
          );
        })}
      </SettingsSection>

      <SettingsSection
        label="Mass Actions"
        description="Type these in any chat input. Mod-only — both commands no-op for non-mods."
      >
        <SettingsRow
          title="/nuke"
          description="Mass-action by phrase or /regex/flags. Pattern is the text to match. Action is delete, ban, or a duration like 10m. Past[:future] is the lookback window and an optional forward window that keeps matching new messages."
        >
          <div className="space-y-1.5 text-[12px] text-textSecondary leading-relaxed">
            <div>
              <code className="rounded bg-glass/50 px-1.5 py-0.5 font-mono text-textPrimary">
                /nuke spam ban 5m:1m
              </code>
              <span className="ml-2">Ban anyone whose recent 5 minutes contains &quot;spam&quot;, keep banning matches for the next minute.</span>
            </div>
            <div>
              <code className="rounded bg-glass/50 px-1.5 py-0.5 font-mono text-textPrimary">
                /nuke /raid|follow.?for.?follow/i 10m 10m
              </code>
              <span className="ml-2">10 minute timeout for raid/follow4follow patterns going back 10 minutes.</span>
            </div>
            <div>
              <code className="rounded bg-glass/50 px-1.5 py-0.5 font-mono text-textPrimary">
                /nuke bigotry delete 1h
              </code>
              <span className="ml-2">Delete every matching message in the last hour.</span>
            </div>
          </div>
        </SettingsRow>
        <SettingsRow
          title="/undo"
          description="Reverses the most recent /nuke on this channel. Bans and timeouts are reversible. Deletes are permanent — Twitch doesn't allow message un-delete."
        />
      </SettingsSection>
    </div>
  );
};

export default ModerationSettings;
