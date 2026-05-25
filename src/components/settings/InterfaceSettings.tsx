import { useState, useEffect } from 'react';
import { Eye, EyeOff, Columns, X } from 'lucide-react';
import CompactViewSettings from './CompactViewSettings';
import { SettingsSection, SettingsRow } from './_primitives';

export type SidebarMode = 'expanded' | 'compact' | 'hidden' | 'disabled';

export const getSidebarSettings = () => {
    const mode = localStorage.getItem('sidebar-mode') as SidebarMode | null;
    const expandOnHover = localStorage.getItem('sidebar-expand-on-hover');

    return {
        mode: mode || 'compact',
        expandOnHover: expandOnHover ? JSON.parse(expandOnHover) : true
    };
};

export const saveSidebarSettings = (mode: SidebarMode, expandOnHover: boolean) => {
    localStorage.setItem('sidebar-mode', mode);
    localStorage.setItem('sidebar-expand-on-hover', JSON.stringify(expandOnHover));

    window.dispatchEvent(new CustomEvent('sidebar-settings-changed', {
        detail: { mode, expandOnHover }
    }));
};

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

const SIDEBAR_MODE_OPTIONS: { value: SidebarMode; label: string; hint: string; Icon: typeof Columns }[] = [
    { value: 'expanded', label: 'Expanded', hint: 'Always show full sidebar', Icon: Columns },
    { value: 'compact', label: 'Compact', hint: 'Show avatars only', Icon: Eye },
    { value: 'hidden', label: 'Hidden', hint: 'Show on hover only', Icon: EyeOff },
    { value: 'disabled', label: 'Disabled', hint: 'Completely hidden', Icon: X },
];

const InterfaceSettings = () => {
    const [sidebarMode, setSidebarMode] = useState<SidebarMode>('compact');
    const [expandOnHover, setExpandOnHover] = useState(true);

    useEffect(() => {
        const settings = getSidebarSettings();
        queueMicrotask(() => {
            setSidebarMode(settings.mode);
            setExpandOnHover(settings.expandOnHover);
        });
    }, []);

    const handleModeChange = (mode: SidebarMode) => {
        setSidebarMode(mode);
        saveSidebarSettings(mode, expandOnHover);
    };

    const handleExpandOnHoverChange = (enabled: boolean) => {
        setExpandOnHover(enabled);
        saveSidebarSettings(sidebarMode, enabled);
    };

    const modeDescription = (() => {
        switch (sidebarMode) {
            case 'expanded':
                return 'The sidebar is always fully visible showing streamer names, game categories, and viewer counts.';
            case 'compact':
                return `Shows only profile pictures. ${expandOnHover ? 'Hovers to reveal full details.' : 'Click the arrow to expand.'}`;
            case 'hidden':
                return 'The sidebar is completely hidden until you move your cursor to the left edge of the window. It will stay visible while your cursor is within the sidebar area.';
            case 'disabled':
                return 'The sidebar is completely disabled and will not appear at all. Use this option if you prefer a cleaner interface without the streams list.';
        }
    })();

    return (
        <div className="space-y-8">
            <SettingsSection id="settings-section-sidebar" label="Sidebar">
                <SettingsRow
                    title="Sidebar Display Mode"
                    description={modeDescription}
                >
                    <div className="grid grid-cols-4 gap-2">
                        {SIDEBAR_MODE_OPTIONS.map(({ value, label, hint, Icon }) => {
                            const isActive = sidebarMode === value;
                            return (
                                <button
                                    key={value}
                                    onClick={() => handleModeChange(value)}
                                    style={{ borderRadius: 8 }}
                                    className={`flex flex-col items-center gap-2 p-3 text-sm font-medium transition-all ${isActive
                                        ? 'glass-input text-textPrimary'
                                        : 'glass-button text-textSecondary hover:text-textPrimary'
                                        }`}
                                >
                                    <Icon size={24} />
                                    <span className="text-xs font-medium">{label}</span>
                                    <span className="text-[10px] text-textMuted text-center">{hint}</span>
                                </button>
                            );
                        })}
                    </div>
                </SettingsRow>

                {sidebarMode === 'compact' && (
                    <SettingsRow
                        title="Expand on Hover"
                        description="Sidebar expands when you hover over it"
                        control={
                            <Toggle
                                enabled={expandOnHover}
                                onChange={() => handleExpandOnHoverChange(!expandOnHover)}
                            />
                        }
                    />
                )}
            </SettingsSection>

            <div id="settings-section-compact">
                <CompactViewSettings />
            </div>
        </div>
    );
};

export default InterfaceSettings;
