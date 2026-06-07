// Route profile-card surface opens (badge overlays + the public profile viewer)
// to the main window.
//
// Every Tauri WebView has its own JS context and its own AppStore instance,
// so calling `useAppStore.getState().openBadgesWithBadge(...)` inside a
// MultiChat popout flips state on the popout's own store — the overlay
// opens in the popout, not in the main app. That's not what we want for a
// chat-only popout: the badges/paints picker is a main-app surface and the
// popout is meant to stay slim. These helpers detect whether we're in a
// popout and either dispatch via a Tauri event (popout → main) or fall
// through to the local store (main → main).
//
// Main-window listeners live in `utils/multichatTrayBridge.ts` next to the
// other popout-to-main bridges, so anyone tracing the event flow can find
// every listener in one place.
//
// Caller contract: callers don't need to know whether they're in a popout.
// They just call the helper and the right thing happens.

import { useAppStore } from '../stores/AppStore';
import { Logger } from './logger';

function isPopoutWindow(): boolean {
  if (typeof window === 'undefined') return false;
  const hash = window.location.hash;
  return hash.startsWith('#/multichat') || hash.startsWith('#/profile');
}

async function emitToMain(eventName: string, payload?: unknown): Promise<void> {
  try {
    const { emit } = await import('@tauri-apps/api/event');
    Logger.debug(`[openBadgesInMain] emitting ${eventName}`, payload);
    await emit(eventName, payload ?? {});
    Logger.debug(`[openBadgesInMain] emit ${eventName} done`);
  } catch (err) {
    Logger.error(`[openBadgesInMain] emit ${eventName} failed:`, err);
  }
}

export function openBadgesWithBadgeInMain(badgeId: string): void {
  const popout = isPopoutWindow();
  Logger.debug(`[openBadgesInMain] openBadgesWithBadge popout=${popout} badgeId=${badgeId}`);
  if (popout) {
    void emitToMain('open-badges-with-badge', { badgeId });
    return;
  }
  useAppStore.getState().openBadgesWithBadge(badgeId);
}

export function openBadgesWithPaintInMain(paintId: string): void {
  const popout = isPopoutWindow();
  Logger.debug(`[openBadgesInMain] openBadgesWithPaint popout=${popout} paintId=${paintId}`);
  if (popout) {
    void emitToMain('open-badges-with-paint', { paintId });
    return;
  }
  useAppStore.getState().openBadgesWithPaint(paintId);
}

export function openBadgesOnStreamNookInMain(): void {
  const popout = isPopoutWindow();
  Logger.debug(`[openBadgesInMain] openBadgesOnStreamNook popout=${popout}`);
  if (popout) {
    void emitToMain('open-badges-on-streamnook');
    return;
  }
  useAppStore.getState().openBadgesOnStreamNook();
}

// Generic deep-link: open the overlay on a given tab and (optionally) filter to
// a badge title. Used for badge types without a dedicated detail modal (Twitch,
// BetterTTV, Chat Clients) clicked from the profile card.
export function openBadgesWithTargetInMain(target: { tab: string; query?: string }): void {
  const popout = isPopoutWindow();
  Logger.debug(`[openBadgesInMain] openBadgesWithTarget popout=${popout}`, target);
  if (popout) {
    void emitToMain('open-badges-with-target', target);
    return;
  }
  useAppStore.getState().openBadgesWithTarget(target);
}

// Open a member's public StreamNook profile in the draggable viewer overlay.
// PublicProfileOverlay is mounted ONLY in the full App, not in the profile-card
// popout window (`#/profile` renders ProfileCardPage alone) — so calling the
// store directly from a popout flips state nothing renders. From a popout we
// emit to main instead, then close THIS profile card: it's alwaysOnTop, so
// leaving it open would occlude the viewer that just opened in main. MultiChat
// popouts are persistent surfaces, so those stay open.
export function openProfileViewerInMain(userId: string): void {
  const popout = isPopoutWindow();
  Logger.debug(`[openBadgesInMain] openProfileViewer popout=${popout} userId=${userId}`);
  if (popout) {
    void (async () => {
      await emitToMain('open-profile-viewer', { userId });
      if (window.location.hash.startsWith('#/profile')) {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          await getCurrentWindow().close();
        } catch (err) {
          Logger.warn('[openBadgesInMain] close profile popout failed:', err);
        }
      }
    })();
    return;
  }
  useAppStore.getState().openProfileViewer(userId);
}
