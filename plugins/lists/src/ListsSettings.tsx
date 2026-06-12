// The Lists plugin's own settings panel, mounted by the host on the plugin's
// card in the plugins page. Reuses the host's native controls so it reads as
// part of the app, not a bolted-on form.

import type { FC } from 'react';
import { ClipboardList } from 'lucide-react';
import { getApi } from './host';
import { useListsSettings, setTitleBarButton, openListsPanel } from './uiStore';

export const ListsSettings: FC = () => {
  const api = getApi();
  const { Tooltip } = api.components;
  const titleBarButton = useListsSettings((s) => s.titleBarButton);

  return (
    <div className="rounded-lg bg-white/[0.02] p-1">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <ClipboardList size={16} className="shrink-0 text-accent" />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-textPrimary">Title bar button</div>
            <div className="text-[11px] text-textMuted">
              Show a Lists button in the title bar to open the panel with one click.
            </div>
          </div>
        </div>
        <Tooltip
          content={titleBarButton ? 'Hide from the title bar' : 'Show in the title bar'}
          delay={300}
        >
          <button
            type="button"
            role="switch"
            aria-checked={titleBarButton}
            onClick={() => setTitleBarButton(!titleBarButton)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
              titleBarButton ? 'bg-accent' : 'bg-gray-600'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                titleBarButton ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </Tooltip>
      </div>

      {!titleBarButton && (
        <div className="px-3 pb-2.5 text-[11px] text-textMuted">
          You can still open Lists from the command palette, the{' '}
          <span className="text-textSecondary">Ctrl+Shift+L</span> shortcut, or{' '}
          <button
            type="button"
            onClick={() => openListsPanel()}
            className="text-accent hover:underline"
          >
            right here
          </button>
          .
        </div>
      )}
    </div>
  );
};

export default ListsSettings;
