import { useAppStore } from '../stores/AppStore';

/**
 * Build a ModLogEvent from a Twitch `channel.moderate` EventSub payload and push
 * it into this window's mod-log store. Shared by the main window (App) and the
 * MultiChat popout: the dedicated moderation socket (Rust) emits one
 * `eventsub://channel-moderate` event to every window, and each window enriches
 * its own log with the acting moderator's identity. The `addModLog` de-dupe
 * merges this with the anonymized IRC entry for the same action.
 */
export function applyModerateEvent(data: Record<string, unknown>) {
  const action = (data.action as string) || 'unknown';
  // The action-specific detail object is keyed by the action name (e.g. data.ban).
  const eventDetails = data[action] as Record<string, unknown> | undefined;
  const targetUserFallback = String(data.target_user_name || data.target_user_login || '');

  useAppStore.getState().addModLog({
    id: String(data.id || Date.now() + Math.random()),
    action,
    timestamp: new Date().toISOString(),
    moderator_name: String(data.moderator_user_name || data.moderator_user_login || 'Unknown'),
    moderator_id: (data.moderator_user_id as string) || undefined,
    moderator_login: (data.moderator_user_login as string) || undefined,
    target_user_name: (eventDetails?.user_name as string) || targetUserFallback,
    target_user_id: (eventDetails?.user_id as string) || (data.target_user_id as string) || undefined,
    target_user_login: (eventDetails?.user_login as string) || (data.target_user_login as string) || undefined,
    // For deletes, the channel.moderate `delete` object carries the removed text.
    message: (eventDetails?.message_body as string) || undefined,
    reason: (eventDetails?.reason as string) || undefined,
    duration: eventDetails?.expires_at
      ? undefined
      : ((eventDetails?.duration as number) ?? (eventDetails?.wait_time_seconds as number)),
    channel: String(data.broadcaster_user_login || '').toLowerCase() || undefined,
    channel_display: (data.broadcaster_user_name as string) || undefined,
    source: 'eventsub',
    details: data,
  });
}
