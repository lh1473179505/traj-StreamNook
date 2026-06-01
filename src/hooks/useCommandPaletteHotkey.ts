// useCommandPaletteHotkey — window-level Ctrl/Cmd+K listener that toggles the
// palette. Mount once per window (main App + each MultiChat popout). Listens at
// the window level (capture phase) so it works even when focus is in a chat
// input or settings dialog. Browser default for Ctrl+K is "focus the address
// bar" — that's a no-op inside a Tauri WebView, but we preventDefault anyway
// so embedded webviews behave consistently.

import { useEffect } from 'react';
import { useAppStore } from '../stores/AppStore';
import { isRecordingKeybind } from '../keybindings/recorderState';

export function useCommandPaletteHotkey(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Stand down while the Keybindings recorder is capturing, so Ctrl+K is
      // recorded as a chord (or ignored) instead of opening the palette behind
      // the settings dialog.
      if (isRecordingKeybind()) return;
      if (e.isComposing || e.keyCode === 229) return;
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
