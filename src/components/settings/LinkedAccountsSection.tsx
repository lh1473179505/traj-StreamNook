import { useEffect, useRef, useState } from 'react';
import { Loader2, UserPlus, Unlink, User, Check, Palette, LogOut } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { addAccount, removeAccount, type StoredAccount } from '../../services/accountService';
import { useSendAccountStore } from '../../stores/sendAccountStore';
import AccountIdentityEditor from './AccountIdentityEditor';
import { Tooltip } from '../ui/Tooltip';

/**
 * Manage linked Twitch accounts. Your main is the account you watch and stream
 * as; the others are "action" accounts you can send chat from. This screen lets
 * you add / remove them and choose your default sending account. (Changing which
 * account you stream as is a sign-out / sign-in, not a toggle here, because only
 * the main holds the browser session streaming uses.)
 */
export default function LinkedAccountsSection() {
  const addToast = useAppStore((s) => s.addToast);
  const logoutFromTwitch = useAppStore((s) => s.logoutFromTwitch);
  const closeSettings = useAppStore((s) => s.closeSettings);
  const accounts = useSendAccountStore((s) => s.accounts);
  const sendAsId = useSendAccountStore((s) => s.sendAsId);
  const setSendAsId = useSendAccountStore((s) => s.setSendAsId);

  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<StoredAccount | null>(null);
  const [signOutConfirm, setSignOutConfirm] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void useSendAccountStore.getState().loadAccounts();
  }, []);

  const handleAdd = async () => {
    if (adding) return;
    setAdding(true);
    try {
      const account = await addAccount();
      addToast(`Linked @${account.login}`, 'success');
      await useSendAccountStore.getState().loadAccounts();
    } catch (e) {
      addToast(typeof e === 'string' ? e : 'Could not link account', 'error');
    } finally {
      if (mountedRef.current) setAdding(false);
    }
  };

  const handleRemove = async (userId: string, login: string) => {
    setRemovingId(userId);
    try {
      await removeAccount(userId);
      addToast(`Unlinked @${login}`, 'info');
      await useSendAccountStore.getState().loadAccounts();
    } catch (e) {
      addToast(typeof e === 'string' ? e : 'Could not unlink account', 'error');
    } finally {
      if (mountedRef.current) setRemovingId(null);
    }
  };

  const primary = accounts.find((a) => a.is_primary);
  const multiple = accounts.length >= 2;
  // The effective default sender: the explicit choice, else the main.
  const defaultId = sendAsId ?? primary?.user_id ?? null;
  const hasSecondaries = accounts.some((a) => !a.is_primary);

  return (
    <div className="glass-panel rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-textPrimary uppercase tracking-wide">
          Accounts
        </h4>
        <button
          onClick={handleAdd}
          disabled={adding}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium glass-button disabled:cursor-wait disabled:opacity-70"
        >
          {adding ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Waiting for sign-in…
            </>
          ) : (
            <>
              <UserPlus size={14} />
              Add account
            </>
          )}
        </button>
      </div>

      {adding && (
        <p className="text-xs text-textSecondary">
          A browser window opened. Sign in as the account you want to add, then return here.
        </p>
      )}

      <p className="text-xs text-textSecondary">
        Your main is the account you watch and stream as. Add others to send chat from, then choose
        your default below or switch per message from the chat box.
      </p>

      <div className="space-y-1.5">
        {accounts.map((account) => {
          const isDefault = account.user_id === defaultId;
          return (
            <div
              key={account.user_id}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 bg-white/[0.03]"
            >
              {account.avatar_url ? (
                <img
                  src={account.avatar_url}
                  alt=""
                  className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
                  <User size={17} className="text-textMuted" />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-textPrimary truncate">
                    {account.display_name || account.login}
                  </span>
                  {account.is_primary && (
                    <span className="text-[10px] font-medium uppercase tracking-wide text-textMuted bg-white/5 px-1.5 py-0.5 rounded flex-shrink-0">
                      Main
                    </span>
                  )}
                </div>
                <div className="text-xs text-textSecondary truncate">@{account.login}</div>
              </div>

              {/* Default-sender control, only meaningful with 2+ accounts. */}
              {multiple &&
                (isDefault ? (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-accent flex-shrink-0">
                    <Check size={13} />
                    Default
                  </span>
                ) : (
                  <button
                    onClick={() => setSendAsId(account.user_id)}
                    className="text-[11px] text-textMuted hover:text-textPrimary px-2 py-1 rounded-md hover:bg-white/[0.05] transition-colors flex-shrink-0"
                  >
                    Set default
                  </button>
                ))}

              {/* Edit identity (palette) only for secondaries — the main edits
                  its identity in the Profile tab this section already lives in. */}
              {!account.is_primary && (
                <Tooltip content="Edit identity (7TV cosmetics + badges)">
                <button
                  onClick={() => setEditing(account)}
                  aria-label={`Edit identity for @${account.login}`}
                  className="p-1.5 text-textMuted hover:text-textPrimary hover:bg-white/[0.05] rounded-md transition-colors flex-shrink-0"
                >
                  <Palette size={15} />
                </button>
                </Tooltip>
              )}

              {/* Main account-level action is Sign out; secondaries Unlink. */}
              {account.is_primary ? (
                signOutConfirm ? (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setSignOutConfirm(false)}
                      className="text-[11px] text-textMuted hover:text-textPrimary px-2 py-1 rounded-md hover:bg-white/[0.05] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        setSignOutConfirm(false);
                        logoutFromTwitch();
                        closeSettings();
                      }}
                      className="text-[11px] font-medium text-red-400 hover:bg-red-500/10 px-2 py-1 rounded-md transition-colors"
                    >
                      Sign out
                    </button>
                  </div>
                ) : (
                  <Tooltip content="Sign out">
                  <button
                    onClick={() => setSignOutConfirm(true)}
                    aria-label="Sign out"
                    className="p-1.5 text-textMuted hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors flex-shrink-0"
                  >
                    <LogOut size={15} />
                  </button>
                  </Tooltip>
                )
              ) : (
                <button
                  onClick={() => handleRemove(account.user_id, account.login)}
                  disabled={removingId === account.user_id}
                  aria-label={`Unlink @${account.login}`}
                  className="p-1.5 text-textMuted hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors disabled:cursor-wait flex-shrink-0"
                >
                  {removingId === account.user_id ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Unlink size={15} />
                  )}
                </button>
              )}
            </div>
          );
        })}

        {!hasSecondaries && !adding && (
          <p className="text-xs text-textMuted pt-1">No extra accounts linked yet.</p>
        )}
      </div>

      {editing && (
        <AccountIdentityEditor account={editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
