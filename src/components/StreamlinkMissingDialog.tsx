import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip } from './ui/Tooltip';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
    AlertTriangle,
    ExternalLink,
    FolderOpen,
    HardDrive,
    Loader2,
    Package,
    X,
} from 'lucide-react';
import { useAppStore } from '../stores/AppStore';
import { Logger } from '../utils/logger';

interface DetectedStreamlinkInstall {
    label: string;
    path: string;
    version: string | null;
    is_bundled: boolean;
}

const DOWNLOAD_URL = 'https://streamlink.github.io/install.html#windows-portable';

// Mirrors the bevels used in SettingsDialog's hero/tile recipe so the modal
// reads as a child of the same surface family.
const HERO_BEVEL =
    'inset 1px 1px 0 0 rgba(255,255,255,0.14), inset -1px -1px 0 0 rgba(0,0,0,0.22), 0 4px 10px rgba(0,0,0,0.18)';
const TILE_BEVEL =
    'inset 1px 1px 0 0 rgba(255,255,255,0.10), inset -1px -1px 0 0 rgba(0,0,0,0.18)';
const ALERT_TINT = 'rgba(210, 140, 140, 0.22)';

const StreamlinkMissingDialog = () => {
    const {
        showStreamlinkMissing,
        pendingStreamChannel,
        pendingStreamInfo,
        settings,
        updateSettings,
        startStream,
        addToast,
    } = useAppStore();

    const [detected, setDetected] = useState<DetectedStreamlinkInstall[] | null>(null);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [isBrowsing, setIsBrowsing] = useState(false);
    const [isConfirming, setIsConfirming] = useState(false);

    useEffect(() => {
        if (!showStreamlinkMissing) return;
        setDetected(null);
        setSelectedPath(null);
        invoke<DetectedStreamlinkInstall[]>('detect_streamlink_installs')
            .then((installs) => setDetected(installs.filter((i) => !i.is_bundled)))
            .catch((e) => {
                Logger.error('Failed to detect Streamlink installs:', e);
                setDetected([]);
            });
    }, [showStreamlinkMissing]);

    const handleBrowse = async () => {
        try {
            setIsBrowsing(true);
            const selected = await open({
                multiple: false,
                filters: [{ name: 'streamlinkw.exe', extensions: ['exe'] }],
                title: 'Select streamlinkw.exe',
            });
            if (selected && typeof selected === 'string') {
                setSelectedPath(selected);
            }
        } catch (error) {
            Logger.error('Failed to open file picker:', error);
            addToast('Failed to open file picker', 'error');
        } finally {
            setIsBrowsing(false);
        }
    };

    const handleOpenDownload = async () => {
        try {
            await invoke('open_browser_url', { url: DOWNLOAD_URL });
        } catch (e) {
            Logger.error('open_browser_url failed:', e);
        }
    };

    const closeDialog = () => {
        useAppStore.setState({
            showStreamlinkMissing: false,
            pendingStreamChannel: null,
            pendingStreamInfo: null,
        });
    };

    const handleConfirm = async () => {
        if (!selectedPath) {
            addToast('Pick a Streamlink install first', 'warning');
            return;
        }
        setIsConfirming(true);

        const streamlinkDefaults = {
            low_latency_enabled: true,
            hls_live_edge: 3,
            stream_timeout: 60,
            retry_streams: 3,
            disable_hosting: true,
            skip_ssl_verify: false,
            use_proxy: true,
            proxy_playlist:
                '--twitch-proxy-playlist=https://lb-na.cdn-perfprod.com,https://eu.luminous.dev --twitch-proxy-playlist-fallback',
        };
        const currentStreamlink = settings.streamlink || streamlinkDefaults;

        await updateSettings({
            ...settings,
            streamlink: {
                ...currentStreamlink,
                custom_streamlink_path: selectedPath,
            },
        });
        addToast('Streamlink path saved', 'success');

        const channel = pendingStreamChannel;
        const info = pendingStreamInfo;
        closeDialog();

        if (channel) {
            setTimeout(() => startStream(channel, info || undefined), 400);
        }
    };

    const handleOpenSettings = () => {
        useAppStore.setState({
            showStreamlinkMissing: false,
            pendingStreamChannel: null,
            pendingStreamInfo: null,
            isSettingsOpen: true,
            settingsInitialTab: 'Player',
        });
    };

    if (!showStreamlinkMissing) return null;

    const customPathSelected =
        selectedPath !== null && !detected?.some((d) => d.path === selectedPath);

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-2xl"
                onClick={closeDialog}
            >
                <motion.div
                    initial={{ opacity: 0, scale: 0.97, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97, y: 10 }}
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                    onClick={(e) => e.stopPropagation()}
                    className="liquid-glass-panel flex w-full max-w-lg mx-4 max-h-[88vh] flex-col overflow-hidden"
                >
                    <div className="flex items-center justify-end px-3 pt-3">
                        <button
                            onClick={closeDialog}
                            className="rounded p-1.5 text-textMuted transition-colors hover:bg-white/[0.06] hover:text-textPrimary"
                            aria-label="Close"
                        >
                            <X size={16} />
                        </button>
                    </div>

                    <div className="flex items-center gap-3 px-6 pb-4 pt-0">
                        <span
                            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                            style={{
                                background: ALERT_TINT,
                                boxShadow: HERO_BEVEL,
                                border: '1px solid transparent',
                            }}
                        >
                            <AlertTriangle
                                size={18}
                                strokeWidth={2}
                                className="text-textPrimary"
                            />
                        </span>
                        <div className="min-w-0">
                            <h2 className="text-[15px] font-semibold leading-tight text-textPrimary">
                                Streamlink isn't responding
                            </h2>
                            <p className="mt-0.5 truncate text-[11px] text-textMuted">
                                Pick an install on this system to continue
                            </p>
                        </div>
                    </div>

                    <div className="scrollbar-thin flex-1 space-y-6 overflow-y-auto px-6 pb-6">
                        <section>
                            <div className="px-1 pb-2.5">
                                <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-textMuted">
                                    Detected installs
                                </h3>
                                <p className="mt-1 text-[12px] leading-relaxed text-textSecondary">
                                    Other Streamlink installs found on this machine.
                                </p>
                            </div>
                            <div className="settings-card overflow-hidden">
                                {detected === null ? (
                                    <div className="flex items-center justify-center gap-2 px-4 py-6">
                                        <Loader2
                                            size={14}
                                            className="animate-spin text-textMuted"
                                        />
                                        <span className="text-[12px] text-textSecondary">
                                            Scanning...
                                        </span>
                                    </div>
                                ) : detected.length === 0 ? (
                                    <div className="px-4 py-6 text-center">
                                        <span
                                            className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg"
                                            style={{
                                                background: 'rgba(180, 180, 195, 0.10)',
                                                boxShadow: TILE_BEVEL,
                                                border: '1px solid transparent',
                                            }}
                                        >
                                            <Package
                                                size={16}
                                                className="text-textMuted"
                                            />
                                        </span>
                                        <p className="text-[12px] text-textSecondary">
                                            None found. Download Streamlink, or point at a custom location below.
                                        </p>
                                        <button
                                            onClick={handleOpenDownload}
                                            className="mt-2 inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
                                        >
                                            streamlink.github.io
                                            <ExternalLink size={11} />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="px-4">
                                        {detected.map((install) => {
                                            const isSelected = selectedPath === install.path;
                                            return (
                                                <button
                                                    key={install.path}
                                                    onClick={() => setSelectedPath(install.path)}
                                                    className="settings-row -mx-4 w-full px-4 py-3 text-left"
                                                >
                                                    <div className="flex items-center justify-between gap-4">
                                                        <div className="flex min-w-0 flex-1 items-center gap-3">
                                                            <span
                                                                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md"
                                                                style={{
                                                                    background:
                                                                        'rgba(150, 170, 185, 0.18)',
                                                                    boxShadow: TILE_BEVEL,
                                                                    border:
                                                                        '1px solid transparent',
                                                                }}
                                                            >
                                                                <HardDrive
                                                                    size={13}
                                                                    strokeWidth={2.25}
                                                                    className="text-textPrimary"
                                                                />
                                                            </span>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[13px] font-medium text-textPrimary">
                                                                        {install.label}
                                                                    </span>
                                                                    {install.version && (
                                                                        <span className="glass-badge rounded-full px-1.5 py-0.5 text-[10px] text-textSecondary">
                                                                            {install.version.replace(
                                                                                /^streamlink\s+/i,
                                                                                'v'
                                                                            )}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <Tooltip content={install.path}>
                                                                <p
                                                                    className="mt-0.5 truncate font-mono text-[11px] text-textMuted"
                                                                >
                                                                    {install.path}
                                                                </p>
                                                                </Tooltip>
                                                            </div>
                                                        </div>
                                                        <div
                                                            className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                                                                isSelected
                                                                    ? 'border-accent'
                                                                    : 'border-textMuted/40'
                                                            }`}
                                                        >
                                                            {isSelected && (
                                                                <div className="h-2 w-2 rounded-full bg-accent" />
                                                            )}
                                                        </div>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </section>

                        <section>
                            <div className="px-1 pb-2.5">
                                <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-textMuted">
                                    Custom location
                                </h3>
                                <p className="mt-1 text-[12px] leading-relaxed text-textSecondary">
                                    Point at <code className="text-accent">streamlinkw.exe</code> directly.
                                </p>
                            </div>
                            <div className="settings-card px-4">
                                {customPathSelected && (
                                    <div className="settings-row -mx-4 px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <span
                                                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md"
                                                style={{
                                                    background: 'rgba(150, 170, 185, 0.18)',
                                                    boxShadow: TILE_BEVEL,
                                                    border: '1px solid transparent',
                                                }}
                                            >
                                                <FolderOpen
                                                    size={13}
                                                    strokeWidth={2.25}
                                                    className="text-textPrimary"
                                                />
                                            </span>
                                            <Tooltip content={selectedPath!}>
                                            <p
                                                className="min-w-0 flex-1 truncate font-mono text-[12px] text-textPrimary"
                                            >
                                                {selectedPath}
                                            </p>
                                            </Tooltip>
                                            <div className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border-2 border-accent">
                                                <div className="h-2 w-2 rounded-full bg-accent" />
                                            </div>
                                        </div>
                                    </div>
                                )}
                                <div className="-mx-4 px-4 py-3">
                                    <button
                                        onClick={handleBrowse}
                                        disabled={isBrowsing}
                                        className="glass-button inline-flex items-center gap-2 rounded px-3 py-2 text-[12px] text-textPrimary disabled:opacity-50"
                                    >
                                        <FolderOpen size={13} strokeWidth={2.25} />
                                        {isBrowsing
                                            ? 'Selecting...'
                                            : customPathSelected
                                              ? 'Pick a different streamlinkw.exe'
                                              : 'Browse for streamlinkw.exe'}
                                    </button>
                                </div>
                            </div>
                        </section>

                        <details className="px-1 text-[12px] text-textSecondary">
                            <summary className="cursor-pointer select-none text-[11px] uppercase tracking-[0.12em] text-textMuted transition-colors hover:text-textPrimary">
                                Why am I seeing this?
                            </summary>
                            <p className="mt-2 leading-relaxed">
                                The bundled Streamlink executable couldn't be found. This usually
                                means the folder was moved, antivirus quarantined it, or you're
                                running a development build without bundled binaries.
                                Reinstalling StreamNook restores the bundled copy; pointing at
                                another install on this machine also works.
                            </p>
                        </details>
                    </div>

                    <div className="flex items-center justify-between border-t border-white/[0.06] px-6 py-3">
                        <button
                            onClick={handleOpenSettings}
                            className="text-[12px] text-textSecondary transition-colors hover:text-textPrimary"
                        >
                            Open Settings
                        </button>
                        <div className="flex gap-2">
                            <button
                                onClick={closeDialog}
                                className="rounded px-3 py-1.5 text-[13px] text-textSecondary transition-colors hover:bg-white/[0.04] hover:text-textPrimary"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirm}
                                disabled={!selectedPath || isConfirming}
                                className="glass-button inline-flex items-center gap-2 rounded px-4 py-1.5 text-[13px] font-medium text-textPrimary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {isConfirming && (
                                    <Loader2 size={13} className="animate-spin" />
                                )}
                                Use this install
                            </button>
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};

export default StreamlinkMissingDialog;
