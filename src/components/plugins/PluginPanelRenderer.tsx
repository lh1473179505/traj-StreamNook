import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  PanelField,
  PanelSchema,
  PanelValues,
} from '../../types/plugins';
import { Logger } from '../../utils/logger';

interface Props {
  pluginId: string;
}

const fieldToggle = (
  enabled: boolean,
  onChange: () => void
) => (
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

/**
 * Renders a plugin's settings panel from the constrained schema it registered
 * over RPC (docs/plugins/PROTOCOL.md, register_panel). The plugin never gets
 * UI access; this is the host drawing a form. Value changes persist on the
 * host and reach the plugin as on_panel_change.
 */
const PluginPanelRenderer = ({ pluginId }: Props) => {
  const [schema, setSchema] = useState<PanelSchema | null>(null);
  const [values, setValues] = useState<PanelValues>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    invoke<{ schema: PanelSchema; values: PanelValues } | null>('plugins_get_panel', {
      pluginId,
    })
      .then((panel) => {
        if (!mounted) return;
        if (panel) {
          setSchema(panel.schema);
          setValues(panel.values ?? {});
        }
        setLoaded(true);
      })
      .catch((err) => {
        Logger.error('[Plugins] panel load failed:', err);
        if (mounted) setLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, [pluginId]);

  const commit = useCallback(
    (next: PanelValues) => {
      setValues(next);
      invoke('plugins_set_panel_values', { pluginId, values: next }).catch((err) =>
        Logger.error('[Plugins] panel save failed:', err)
      );
    },
    [pluginId]
  );

  if (!loaded) return null;
  if (!schema) {
    return (
      <p className="text-[12px] text-textSecondary px-1 py-2">
        This plugin has not registered its settings panel yet. Panels appear after
        the plugin starts.
      </p>
    );
  }

  const valueOf = (field: PanelField) => values[field.key] ?? field.default;

  const renderField = (field: PanelField) => {
    switch (field.type) {
      case 'toggle':
        return fieldToggle(Boolean(valueOf(field)), () =>
          commit({ ...values, [field.key]: !valueOf(field) })
        );
      case 'number':
        return (
          <input
            type="number"
            className="glass-input w-24 px-2 py-1 text-[13px] text-textPrimary"
            value={Number(valueOf(field) ?? 0)}
            min={field.min}
            max={field.max}
            onChange={(e) => commit({ ...values, [field.key]: Number(e.target.value) })}
          />
        );
      case 'text':
        return (
          <input
            type="text"
            className="glass-input w-48 px-2 py-1 text-[13px] text-textPrimary"
            value={String(valueOf(field) ?? '')}
            placeholder={field.placeholder}
            onChange={(e) => commit({ ...values, [field.key]: e.target.value })}
          />
        );
      case 'select':
        return (
          <select
            className="glass-input px-2 py-1 text-[13px] text-textPrimary bg-transparent"
            value={String(valueOf(field) ?? '')}
            onChange={(e) => commit({ ...values, [field.key]: e.target.value })}
          >
            {(field.options ?? []).map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-zinc-900">
                {opt.label}
              </option>
            ))}
          </select>
        );
      case 'string_list':
        return (
          <textarea
            className="glass-input w-full px-2 py-1 text-[13px] text-textPrimary font-mono"
            rows={3}
            value={(Array.isArray(valueOf(field)) ? (valueOf(field) as string[]) : []).join('\n')}
            placeholder="One entry per line"
            onChange={(e) =>
              commit({
                ...values,
                [field.key]: e.target.value.split('\n').filter((l) => l.trim().length > 0),
              })
            }
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-3">
      {schema.sections.map((section, i) => (
        <div key={section.label ?? i} className="rounded-lg bg-white/[0.02] py-1.5">
          {section.label && (
            <div className="px-3 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-textMuted">
              {section.label}
            </div>
          )}
          {section.description && (
            <p className="px-3 pb-1 text-[12px] leading-relaxed text-textSecondary">
              {section.description}
            </p>
          )}
          {section.fields.map((field) => (
            <div key={field.key} className="settings-row px-3 py-2.5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-textPrimary">{field.label}</div>
                  {field.description && (
                    <p className="mt-0.5 text-[12px] leading-relaxed text-textSecondary">
                      {field.description}
                    </p>
                  )}
                  {field.type === 'string_list' && <div className="mt-2">{renderField(field)}</div>}
                </div>
                {field.type !== 'string_list' && (
                  <div className="flex-shrink-0">{renderField(field)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

export default PluginPanelRenderer;
