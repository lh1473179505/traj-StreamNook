// Chat moderation control bridge.
//
// The main-window ChatWidget registers an adapter here on mount and clears it on
// unmount. Moderation keybindings (focus a message, then ban/timeout/delete/etc.)
// call through this adapter so the keybinding engine never reaches into chat
// internals. `isModerator()` gates the whole moderation context; `hasFocus()`
// reports whether a message is currently keyboard-focused (used to gate the
// action commands and to give the chat context priority over the player).

export interface ChatModController {
  /** Current user can moderate the watched channel (mod or broadcaster). */
  isModerator(): boolean;
  /** A chat message is currently keyboard-focused. */
  hasFocus(): boolean;
  /** Move focus toward newer messages (down). Focuses the newest if none yet. */
  focusNewer(): void;
  /** Move focus toward older messages (up). Focuses the newest if none yet. */
  focusOlder(): void;
  /** Clear the focus ring. */
  clearFocus(): void;
  /** Open the focused user's profile card. */
  openUserCard(): void;
  /** Delete the focused message. */
  deleteFocused(): void;
  /** Time the focused user out for `seconds`. */
  timeoutFocused(seconds: number): void;
  /** Permanently ban the focused user. */
  banFocused(): void;
  /** Unban the focused user. */
  unbanFocused(): void;
}

let current: ChatModController | null = null;

export function registerChatModController(controller: ChatModController | null): void {
  current = controller;
}

export function getChatModController(): ChatModController | null {
  return current;
}
