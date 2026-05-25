// useCommandPaletteHotkey — window-level Ctrl/Cmd+K listener that toggles the
// palette. Mount once per window (main App + each MultiChat popout). Listens at
// the window level (capture phase) so it works even when focus is in a chat
// input or settings dialog. Browser default for Ctrl+K is "focus the address
// bar" — that's a no-op inside a Tauri WebView, but we preventDefault anyway
// so embedded webviews behave consistently.

import { useEffect } from 'react';
import { useAppStore } from '../stores/AppStore';

export function useCommandPaletteHotkey(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey || e.shiftKey) return;
      if (e.key !== 'k' && e.key !== 'K') return;
      e.preventDefault();
      e.stopPropagation();
      useAppStore.getState().toggleCommandPalette();
    };
    // Capture so chat-input keydown handlers (which often stopPropagation on
    // bubble) can't swallow the chord.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
