import { useState, useEffect } from 'react';
import { Eye, EyeOff, Columns, X, Sparkles, Gauge, Zap } from 'lucide-react';
import CompactViewSettings from './CompactViewSettings';
import { SettingsSection, SettingsRow } from './_primitives';
import { useAppStore } from '../../stores/AppStore';
import type { MotionMode } from '../../types';

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

const MOTION_MODE_OPTIONS: { value: MotionMode; label: string; hint: string; Icon: typeof Columns }[] = [
    { value: 'full', label: 'Full', hint: 'All animations', Icon: Sparkles },
    { value: 'reduced', label: 'Reduced', hint: 'Fades only', Icon: Gauge },
    { value: 'off', label: 'Off', hint: 'Instant, snappy', Icon: Zap },
];

const InterfaceSettings = () => {
    const { settings, updateSettings } = useAppStore();
    const [sidebarMode, setSidebarMode] = useState<SidebarMode>('compact');
    const [expandOnHover, setExpandOnHover] = useState(true);

    // Compact (centered window) is the default; turning it off grows Settings
    // to a full-page layout that fills the entire app.
    const compactSettingsWindow = settings.compact_settings_window !== false;
    const handleCompactSettingsWindowChange = (enabled: boolean) => {
        void updateSettings({ ...settings, compact_settings_window: enabled });
    };

    // Full (default) animates everything; Reduced keeps fades but drops
    // movement; Off makes the UI instant and snappy (best on low-end PCs).
    const motionMode: MotionMode = settings.motion_mode ?? 'full';
    const handleMotionModeChange = (mode: MotionMode) => {
        void updateSettings({ ...settings, motion_mode: mode });
    };
    const motionDescription = (() => {
        switch (motionMode) {
            case 'full':
                return 'All animations and transitions play normally.';
            case 'reduced':
                return 'Keeps quick fades but removes sliding, scaling, and bouncing motion. Easier on the eyes and lighter on slower machines.';
            case 'off':
                return 'Turns animations off for an instant, snappy feel. Best on low-end PCs, since the frosted-glass blur is expensive to animate. Loading spinners still spin.';
        }
    })();

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

            <SettingsSection id="settings-section-motion" label="Motion">
                <SettingsRow
                    title="Animations"
                    description={motionDescription}
                >
                    <div className="grid grid-cols-3 gap-2">
                        {MOTION_MODE_OPTIONS.map(({ value, label, hint, Icon }) => {
                            const isActive = motionMode === value;
                            return (
                                <button
                                    key={value}
                                    onClick={() => handleMotionModeChange(value)}
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
            </SettingsSection>

            <SettingsSection id="settings-section-settings-window" label="Settings Window">
                <SettingsRow
                    title="Compact settings window"
                    description="Show settings in a centered window. Turn this off to open settings as a full page that fills the entire app, giving long tabs more room so you can see all the options at once with less scrolling."
                    control={
                        <Toggle
                            enabled={compactSettingsWindow}
                            onChange={() => handleCompactSettingsWindowChange(!compactSettingsWindow)}
                        />
                    }
                />
            </SettingsSection>

            <div id="settings-section-compact">
                <CompactViewSettings />
            </div>
        </div>
    );
};

export default InterfaceSettings;
