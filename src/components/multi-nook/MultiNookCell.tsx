import React, { useEffect, useState, useCallback } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { MultiNookSlot } from '../../types';
import { useMultiNookPlayer } from './useMultiNookPlayer';
import { usemultiNookStore } from '../../stores/multiNookStore';
import { useChannelSocial } from '../../hooks/useChannelSocial';
import StreamTitleWithEmojis from '../StreamTitleWithEmojis';
import { Tooltip } from '../ui/Tooltip';
import { GripHorizontal, Undo2, Loader2 } from 'lucide-react';
import { Heart, HeartBreak, X as XIcon } from 'phosphor-react';
import { Logger } from '../../utils/logger';

interface MultiNookCellProps {
  slot: MultiNookSlot;
  cssOrder?: number;
  gridSpanClass?: string;
  customStyle?: React.CSSProperties;
}

export const MultiNookCell: React.FC<MultiNookCellProps> = ({ slot, cssOrder, gridSpanClass = '', customStyle = {} }) => {
  const { id, channelLogin, channelName, channelId, volume, muted, isFocused, streamUrl, isMinimized = false } = slot;
  const { toggleFocusSlot, dockSlot, removeSlot, changeSlotQuality } = usemultiNookStore();

  const isLoading = !streamUrl;

  const { videoRef, playerRef, isPlaying, isBuffering, error } = useMultiNookPlayer({
    streamUrl,
    streamId: id,
    volume,
    muted,
    isMinimized,
  });

  // Follow + subscribe controls. Only the focused, non-docked tile activates the
  // hook so we make one follow/subscription lookup at a time instead of one per
  // tile across the whole grid.
  const socialEnabled = isFocused && !isMinimized;
  const {
    isFollowing,
    followLoading,
    checkingFollowStatus,
    heartDropAnimation,
    handleFollowClick,
    isSubscribed,
    hasSubHistory,
    cumulativeMonths,
    subscriberBadgeUrl,
    handleSubscribeClick,
  } = useChannelSocial({
    userId: channelId,
    userLogin: channelLogin,
    userName: channelName,
    enabled: socialEnabled,
  });

  // Available Streamlink qualities for the focused tile's gear menu
  const [availableQualities, setAvailableQualities] = useState<string[]>([]);
  useEffect(() => {
    if (!socialEnabled) return;
    let cancelled = false;
    invoke<string[]>('get_stream_qualities', { url: `https://twitch.tv/${channelLogin}` })
      .then((qs) => {
        if (!cancelled && qs?.length) setAvailableQualities(qs);
      })
      .catch((e) => Logger.warn(`[MultiNook] Failed to fetch qualities for ${channelLogin}`, e));
    return () => {
      cancelled = true;
    };
  }, [socialEnabled, channelLogin]);

  // Inject a Quality submenu into this tile's Plyr settings gear — mirrors the
  // single player. Selecting a quality restarts only this tile's proxy via
  // changeSlotQuality (which briefly reloads the cell at the new quality).
  const updateQualityMenu = useCallback(() => {
    const player = playerRef.current as unknown as { elements?: { container?: HTMLElement } } | null;
    const container = player?.elements?.container;
    if (!container || availableQualities.length === 0) return;

    const settingsMenu = container.querySelector('.plyr__menu');
    if (!settingsMenu) return;

    // Remove any previously injected quality menu/button before re-adding
    settingsMenu.querySelector('[data-quality-menu]')?.remove();
    settingsMenu.querySelector('[data-plyr="quality"]')?.remove();

    const settingsHome = settingsMenu.querySelector('[role="menu"]');
    if (!settingsHome) return;

    const displayedQuality = slot.quality || 'best';
    const cap = (q: string) => q.charAt(0).toUpperCase() + q.slice(1);

    const qualityMenuItem = document.createElement('button');
    qualityMenuItem.className = 'plyr__control';
    qualityMenuItem.setAttribute('data-plyr', 'quality');
    qualityMenuItem.setAttribute('type', 'button');
    qualityMenuItem.setAttribute('role', 'menuitem');
    qualityMenuItem.innerHTML = `<span>Quality<span class="plyr__menu__value">${cap(displayedQuality)}</span></span>`;
    qualityMenuItem.addEventListener('click', () => {
      const submenu = settingsMenu.querySelector('[data-quality-menu]');
      if (submenu) {
        settingsHome.setAttribute('hidden', '');
        submenu.removeAttribute('hidden');
      }
    });

    const speedOption = settingsHome.querySelector('[data-plyr="speed"]');
    if (speedOption) {
      settingsHome.insertBefore(qualityMenuItem, speedOption);
    } else {
      settingsHome.appendChild(qualityMenuItem);
    }

    const qualitySubmenu = document.createElement('div');
    qualitySubmenu.setAttribute('role', 'menu');
    qualitySubmenu.setAttribute('data-quality-menu', '');
    qualitySubmenu.setAttribute('hidden', '');
    qualitySubmenu.innerHTML = `
      <button class="plyr__control plyr__control--back" type="button" data-plyr="back">
        <span>Quality</span>
      </button>
      ${availableQualities
        .map(
          (quality) => `
        <button
          class="plyr__control"
          type="button"
          data-quality="${quality}"
          role="menuitemradio"
          aria-checked="${quality.toLowerCase() === displayedQuality.toLowerCase() ? 'true' : 'false'}"
        >
          <span>${cap(quality)}</span>
        </button>`
        )
        .join('')}
    `;

    const menuContainer = settingsMenu.querySelector('.plyr__menu__container');
    menuContainer?.appendChild(qualitySubmenu);

    qualitySubmenu.querySelector('[data-plyr="back"]')?.addEventListener('click', () => {
      qualitySubmenu.setAttribute('hidden', '');
      settingsHome.removeAttribute('hidden');
    });

    qualitySubmenu.querySelectorAll('[data-quality]').forEach((btn) => {
      if (btn.getAttribute('data-plyr') === 'back') return;
      btn.addEventListener('click', () => {
        const selected = btn.getAttribute('data-quality');
        if (!selected) return;

        qualitySubmenu.querySelectorAll('[data-quality]').forEach((b) => {
          if (b.getAttribute('data-plyr') !== 'back') b.setAttribute('aria-checked', 'false');
        });
        btn.setAttribute('aria-checked', 'true');

        const valueSpan = settingsHome.querySelector('[data-plyr="quality"] .plyr__menu__value');
        if (valueSpan) valueSpan.textContent = cap(selected);

        qualitySubmenu.setAttribute('hidden', '');
        settingsHome.removeAttribute('hidden');

        changeSlotQuality(id, selected);
      });
    });
  }, [availableQualities, slot.quality, id, changeSlotQuality, playerRef]);

  // Add the quality submenu when focused; strip it back out when not (so
  // non-focused tiles keep just the default playback gear).
  useEffect(() => {
    const player = playerRef.current as unknown as { elements?: { container?: HTMLElement } } | null;
    const container = player?.elements?.container;
    if (!container) return;

    let timer: number | undefined;
    if (socialEnabled && availableQualities.length > 0) {
      // Defer so Plyr has finished rendering its menu DOM
      timer = window.setTimeout(() => updateQualityMenu(), 200);
    } else {
      const menu = container.querySelector('.plyr__menu');
      menu?.querySelector('[data-quality-menu]')?.remove();
      menu?.querySelector('[data-plyr="quality"]')?.remove();
    }
    return () => {
      if (timer) window.clearTimeout(timer);
    };
    // isPlaying/streamUrl re-trigger after the player (re)initialises
  }, [socialEnabled, availableQualities, updateQualityMenu, isPlaying, streamUrl, playerRef]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useSortable({ id });

  // Map dnd-kit's drag offset cleanly to Framer Motion's coordinate space
  const x = transform ? Math.round(transform.x) : 0;
  const y = transform ? Math.round(transform.y) : 0;
  const scale = transform ? transform.scaleX : 1;

  const style: React.CSSProperties = {
    zIndex: isDragging ? 10 : 1,
    order: cssOrder,
  };

  const combinedStyle = { ...style, ...customStyle };

  const glassButton = 'flex items-center justify-center p-1.5 glass-button rounded-lg';

  return (
    <motion.div
      layout
      animate={{ x, y, scale }}
      transition={isDragging ? { duration: 0 } : { type: 'spring', stiffness: 350, damping: 30 }}
      ref={setNodeRef}
      style={combinedStyle}
      onClick={(e) => {
        // Only focus if the click wasn't on a button, tool, or plyr control slider
        const target = e.target as HTMLElement;
        if (!target.closest('button') && !target.closest('.plyr__controls') && !target.closest('.plyr__menu')) {
          toggleFocusSlot(id);
        }
      }}
      className={`${gridSpanClass} relative w-full h-full rounded-lg overflow-hidden border border-white/5 ${
        isFocused ? 'shadow-[0_0_25px_var(--color-accent-muted)]' : ''
      } ${
        isDragging ? 'opacity-50 blur-sm' : 'opacity-100'
      } bg-black/40 transition-[box-shadow,opacity,filter] duration-300 group flex items-center justify-center video-player-container [&_.plyr]:w-full [&_.plyr]:h-full [&_.plyr]:absolute [&_.plyr]:inset-0 cursor-pointer`}
    >
      <video
        ref={videoRef}
        className="w-full h-full"
        style={{ backgroundColor: '#000', objectFit: 'cover' }}
        autoPlay
        playsInline
      />

      {/* Loading & Error States */}
      {(isLoading || isBuffering) && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-10 pointer-events-none">
          <i className="ri-loader-4-line text-4xl text-white animate-spin"></i>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 text-rose-500 pointer-events-none">
          <i className="ri-error-warning-fill text-4xl mb-2"></i>
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      {/* Stream Title Overlay — Top-left (Matches VideoPlayer) */}
      <div
        className={`stream-title-overlay absolute top-0 left-0 right-0 z-40 transition-all duration-300 opacity-0 group-hover:opacity-100`}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/20 to-transparent pointer-events-none" />
        <div className="relative px-3 pt-2 pb-6 flex items-start justify-between">
          {/* Absolute Center Grab Handle */}
          <div className="absolute left-1/2 -translate-x-1/2 top-1.5 z-20">
            <Tooltip content="Drag to reposition stream" delay={500} side="top">
              <div
                className="cursor-grab active:cursor-grabbing flex items-center justify-center px-3 py-1 glass-button rounded-lg text-emerald-300 hover:text-emerald-200 active:scale-95 [&_*]:cursor-grab"
                style={{ backgroundColor: 'rgba(16, 185, 129, 0.20)', backdropFilter: 'blur(16px)' }}
                {...attributes}
                {...listeners}
              >
                <GripHorizontal className="w-5 h-5 drop-shadow-md" />
              </div>
            </Tooltip>
          </div>

          {/* Left: Title */}
          <div className="flex-1 min-w-0 pr-12 z-10">
            <Tooltip content={channelName || channelLogin} delay={200} side="top">
              <h3 className="text-sm font-medium truncate drop-shadow-lg flex items-center gap-1.5 select-none text-white/90 mt-1">
                <StreamTitleWithEmojis title={channelName || channelLogin} />
                {isFocused && (
                  <Tooltip content="Focused Stream" delay={200} side="right">
                    <i className="ri-focus-3-line text-white/80 text-[12px] ml-1 shrink-0" />
                  </Tooltip>
                )}
              </h3>
            </Tooltip>
          </div>

          {/* Controls Overlay - Top Right */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Follow + Subscribe — focused tile only */}
            {socialEnabled && (
              <>
                <Tooltip
                  content={
                    checkingFollowStatus
                      ? 'Checking follow status...'
                      : followLoading
                        ? 'Processing...'
                        : isFollowing
                          ? `Unfollow ${channelName || channelLogin}`
                          : `Follow ${channelName || channelLogin}`
                  }
                  delay={200}
                  side="top"
                >
                  <button
                    onClick={handleFollowClick}
                    disabled={followLoading || checkingFollowStatus}
                    className={`${glassButton} ${followLoading || checkingFollowStatus ? 'opacity-60 cursor-wait' : ''}`}
                    style={{ backdropFilter: 'blur(16px)' }}
                  >
                    {followLoading || checkingFollowStatus ? (
                      <Loader2 className="w-4 h-4 animate-spin text-textSecondary" />
                    ) : heartDropAnimation ? (
                      <HeartBreak weight="fill" className="w-4 h-4 text-red-400 animate-heart-drop" />
                    ) : isFollowing ? (
                      <HeartBreak weight="fill" className="w-4 h-4 text-red-400 drop-shadow-[0_0_5px_rgba(239,68,68,0.7)]" />
                    ) : (
                      <Heart weight="fill" className="w-4 h-4 text-emerald-400 drop-shadow-[0_0_5px_rgba(16,185,129,0.7)]" />
                    )}
                  </button>
                </Tooltip>

                <Tooltip
                  content={
                    isSubscribed
                      ? `Gift a sub to ${channelName || channelLogin}'s community`
                      : hasSubHistory
                        ? `Resubscribe to ${channelName || channelLogin} (${cumulativeMonths + 1} months)`
                        : `Subscribe to ${channelName || channelLogin}`
                  }
                  delay={200}
                  side="top"
                >
                  <button
                    onClick={handleSubscribeClick}
                    className={glassButton}
                    style={{ backdropFilter: 'blur(16px)' }}
                  >
                    {subscriberBadgeUrl ? (
                      <img
                        src={subscriberBadgeUrl}
                        alt="Subscriber badge"
                        className="w-4 h-4 object-contain"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    )}
                  </button>
                </Tooltip>
              </>
            )}

            {/* Dock (minimize to the tray strip) */}
            <Tooltip content="Dock Stream" delay={200} side="top">
              <button
                onClick={() => dockSlot(id)}
                className={glassButton}
                style={{ backdropFilter: 'blur(16px)' }}
              >
                <Undo2 className="w-4 h-4 text-white" />
              </button>
            </Tooltip>

            {/* Close (remove from grid) */}
            <Tooltip content="Close Stream" delay={200} side="top">
              <button
                onClick={() => removeSlot(id)}
                className={glassButton}
                style={{ backgroundColor: 'rgba(239, 68, 68, 0.25)', backdropFilter: 'blur(16px)' }}
              >
                <XIcon weight="bold" className="w-4 h-4 text-red-400" />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
