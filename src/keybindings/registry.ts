// Resolution + mutation helpers for keybindings.
//
// Effective bindings = user overrides (from settings.keybindings) layered over
// the code-defined defaults. We store only the delta, so future default changes
// still reach users who never customized a given command.

import { useAppStore } from '../stores/AppStore';
import type { KeybindingOverrides } from '../types';
import { getBindableCommands, getBindableCommand } from './commands';
import { canonicalToDisplay } from './chord';
import type { BindableCommand, KeybindContext } from './types';

export function getOverrides(): KeybindingOverrides {
  return useAppStore.getState().settings.keybindings ?? {};
}

/** Effective chords for a command. Reserved commands always use their defaults.
 *  For others: an override (including an explicit empty array) wins; otherwise
 *  the defaults apply. */
export function getEffectiveBindings(
  cmd: BindableCommand,
  overrides: KeybindingOverrides = getOverrides(),
): string[] {
  if (cmd.reserved) return cmd.defaultBindings;
  const override = overrides[cmd.id];
  return override !== undefined ? override : cmd.defaultBindings;
}

export function getEffectiveBindingsById(
  id: string,
  overrides: KeybindingOverrides = getOverrides(),
): string[] {
  const cmd = getBindableCommand(id);
  return cmd ? getEffectiveBindings(cmd, overrides) : [];
}

/** True when the command's effective bindings differ from its defaults. */
export function isCustomized(cmd: BindableCommand, overrides = getOverrides()): boolean {
  if (cmd.reserved) return false;
  return overrides[cmd.id] !== undefined;
}

/** Map of command id -> first binding (display form), for palette hint
 *  enrichment. Command ids that match palette item ids attach automatically. */
export function getShortcutDisplayMap(): Record<string, string> {
  const overrides = getOverrides();
  const map: Record<string, string> = {};
  for (const cmd of getBindableCommands()) {
    const binds = getEffectiveBindings(cmd, overrides);
    if (binds.length > 0) map[cmd.id] = canonicalToDisplay(binds[0]);
  }
  return map;
}

export interface BindingConflict {
  id: string;
  label: string;
}

/** Other (rebindable) commands in the same context already using `canonical`. */
export function findConflicts(
  canonical: string,
  context: KeybindContext,
  exceptId: string,
): BindingConflict[] {
  const overrides = getOverrides();
  const out: BindingConflict[] = [];
  for (const cmd of getBindableCommands()) {
    if (cmd.id === exceptId || cmd.reserved) continue;
    if (cmd.context !== context) continue;
    if (getEffectiveBindings(cmd, overrides).includes(canonical)) {
      out.push({ id: cmd.id, label: cmd.label });
    }
  }
  return out;
}

async function writeOverrides(mutate: (o: KeybindingOverrides) => void): Promise<void> {
  const state = useAppStore.getState();
  const next: KeybindingOverrides = { ...(state.settings.keybindings ?? {}) };
  mutate(next);
  await state.updateSettings({ ...state.settings, keybindings: next });
}

/** Replace all bindings for a command. */
export async function setBindings(id: string, bindings: string[]): Promise<void> {
  await writeOverrides((o) => {
    o[id] = bindings;
  });
}

/** Append one binding to a command (deduped). */
export async function addBinding(id: string, canonical: string): Promise<void> {
  const current = getEffectiveBindingsById(id);
  if (current.includes(canonical)) return;
  await setBindings(id, [...current, canonical]);
}

/** Remove one binding from a command. */
export async function removeBinding(id: string, canonical: string): Promise<void> {
  const current = getEffectiveBindingsById(id);
  await setBindings(
    id,
    current.filter((b) => b !== canonical),
  );
}

/** Drop the override for a command, restoring its defaults. */
export async function resetBinding(id: string): Promise<void> {
  await writeOverrides((o) => {
    delete o[id];
  });
}

/** Clear every override, restoring all defaults. */
export async function resetAllBindings(): Promise<void> {
  const state = useAppStore.getState();
  await state.updateSettings({ ...state.settings, keybindings: {} });
}
