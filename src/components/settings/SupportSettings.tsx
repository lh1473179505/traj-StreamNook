import { useState, useEffect } from 'react';
import { ExternalLink } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';
import { SettingsSection } from './_primitives';
import streamnookLogo from '../../assets/streamnook-logo.png';

import { Logger } from '../../utils/logger';

const COMMUNITY_DISCORD_INVITE_CODE = '2xvuF9TES7';
const COMMUNITY_DISCORD_INVITE = `https://discord.gg/${COMMUNITY_DISCORD_INVITE_CODE}`;

interface DiscordInviteData {
    guild?: {
        id: string;
        name: string;
        icon: string | null;
    };
    approximate_member_count?: number;
    approximate_presence_count?: number;
}

const SupportSettings = () => {
    const [serverData, setServerData] = useState<DiscordInviteData | null>(null);

    useEffect(() => {
        const fetchServerData = async () => {
            try {
                const response = await fetch(
                    `https://discord.com/api/v10/invites/${COMMUNITY_DISCORD_INVITE_CODE}?with_counts=true`
                );
                if (response.ok) {
                    setServerData(await response.json());
                }
            } catch (error) {
                Logger.error('Failed to fetch Discord server preview:', error);
            }
        };

        fetchServerData();
        const interval = setInterval(fetchServerData, 60000);
        return () => clearInterval(interval);
    }, []);

    const getServerIconUrl = (guildId: string, iconHash: string) => {
        const extension = iconHash.startsWith('a_') ? 'gif' : 'png';
        return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.${extension}?size=128`;
    };

    const handleJoinCommunity = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-shell');
            await open(COMMUNITY_DISCORD_INVITE);
        } catch (err) {
            Logger.error('Failed to open Discord invite:', err);
            window.open(COMMUNITY_DISCORD_INVITE, '_blank');
        }
    };

    return (
        <div className="space-y-8">
            <SettingsSection
                label="Community Discord"
                description="Join the StreamNook community for help, feature requests, updates, and chat with other users."
                bare
            >
                <div className="glass-panel p-4 rounded-lg">
                    <div className="flex items-center gap-4">
                        <div className="relative flex-shrink-0">
                            {serverData?.guild?.icon ? (
                                <img
                                    src={getServerIconUrl(serverData.guild.id, serverData.guild.icon)}
                                    alt={serverData.guild.name}
                                    className="w-12 h-12 rounded-full"
                                />
                            ) : (
                                <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center p-1.5">
                                    <img
                                        src={streamnookLogo}
                                        alt="StreamNook"
                                        className="w-full h-full object-contain"
                                    />
                                </div>
                            )}
                            {typeof serverData?.approximate_presence_count === 'number' && (
                                <Tooltip content={`${serverData.approximate_presence_count} online`} side="top">
                                    <div
                                        className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-[1.5px] border-background bg-green-500"
                                        style={{ animation: 'pulse-glow 2s ease-in-out infinite' }}
                                    />
                                </Tooltip>
                            )}
                        </div>

                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-textPrimary truncate">
                                {serverData?.guild?.name ?? 'StreamNook'}
                            </p>
                            {typeof serverData?.approximate_presence_count === 'number' &&
                             typeof serverData?.approximate_member_count === 'number' ? (
                                <p className="text-xs text-textSecondary">
                                    <span className="text-green-400">{serverData.approximate_presence_count} online</span>
                                    <span className="text-textMuted"> · {serverData.approximate_member_count} members</span>
                                </p>
                            ) : (
                                <p className="text-xs text-textSecondary truncate">
                                    discord.gg/{COMMUNITY_DISCORD_INVITE_CODE}
                                </p>
                            )}
                        </div>

                        <button
                            onClick={handleJoinCommunity}
                            className="glass-button px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium hover:bg-accent/20 transition-colors"
                        >
                            <ExternalLink className="w-4 h-4" />
                            Join the Discord
                        </button>
                    </div>
                </div>
            </SettingsSection>
        </div>
    );
};

export default SupportSettings;
