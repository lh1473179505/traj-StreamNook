import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Puzzle } from 'lucide-react';
import { capabilityLines, GrantedCaps, PluginTier } from '../../types/plugins';
import TierBadge from './TierBadge';

const TILE_BEVEL =
  'inset 1px 1px 0 0 rgba(255,255,255,0.10), inset -1px -1px 0 0 rgba(0,0,0,0.18)';

export interface ConsentSubject {
  name: string;
  author: string;
  version: string;
  tier: PluginTier;
  caps: GrantedCaps;
  /// Source label shown in the tier C copy ("local folder" for dev installs).
  sourceName: string;
  /// Verb on the confirm button: "Install" or "Enable".
  action: 'Install' | 'Enable';
}

interface Props {
  subject: ConsentSubject | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The install and enable consent dialog. Copy is the frozen contract in
 * docs/plugins/CAPABILITIES.md: tier A is a plain capability list, tier B
 * adds the unofficial-interfaces line, tier C is the full risk warning with
 * a required checkbox. Never collapses into a one-click confirm for tier C.
 */
const PluginConsentModal = ({ subject, onConfirm, onCancel }: Props) => {
  const [accepted, setAccepted] = useState(false);
  const isC = subject?.tier === 'C';
  const lines = subject ? capabilityLines(subject.caps) : [];

  return (
    <AnimatePresence>
      {subject && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="glass-panel relative max-h-[85vh] w-[480px] max-w-[90vw] overflow-y-auto p-6"
          >
            <div className="flex items-start gap-3.5">
              <div
                className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
                style={{
                  background: isC ? 'rgba(225, 130, 130, 0.16)' : 'rgba(165, 185, 150, 0.16)',
                  boxShadow: TILE_BEVEL,
                }}
              >
                {isC ? (
                  <ShieldAlert size={20} className="text-red-300" />
                ) : (
                  <Puzzle size={20} className="text-textPrimary" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-bold leading-snug text-textPrimary">
                  {isC
                    ? `${subject.name} can get your Twitch account suspended.`
                    : `${subject.action} ${subject.name}?`}
                </h2>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12px] text-textSecondary">
                  <span>by {subject.author}</span>
                  <span className="text-textMuted">·</span>
                  <span>v{subject.version}</span>
                  <span className="text-textMuted">·</span>
                  <TierBadge tier={subject.tier} />
                </div>
              </div>
            </div>

            {isC && (
              <div className="mt-4 space-y-3 text-[13px] leading-relaxed text-textSecondary">
                <p>
                  This add-on automates watching or claiming, or changes how ads are
                  delivered. Twitch's Terms of Service prohibit this, and accounts
                  that do it risk suspension and loss of drops, points, and
                  entitlements.
                </p>
                <p>
                  StreamNook does not include, ship, or endorse this behavior. You
                  are choosing to install community software that runs as its own
                  program, built by {subject.author}, from a source you added (
                  {subject.sourceName}).
                </p>
              </div>
            )}

            {subject.tier === 'B' && (
              <p className="mt-4 text-[13px] leading-relaxed text-textSecondary">
                This add-on talks to Twitch or other services over interfaces they do
                not officially document, in the way a normal viewer would.
              </p>
            )}

            <div className="mt-4 rounded-lg bg-white/[0.03] py-1.5">
              <div className="px-3.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-textMuted">
                What it can do
              </div>
              {lines.map((line) => (
                <div key={line.text} className="flex items-baseline gap-2 px-3.5 py-1">
                  <span
                    className={`h-1 w-1 flex-shrink-0 translate-y-[-2px] rounded-full ${
                      line.warning ? 'bg-red-300' : 'bg-textMuted'
                    }`}
                  />
                  <span
                    className={`text-[12.5px] leading-relaxed ${
                      line.warning ? 'text-red-300' : 'text-textPrimary'
                    }`}
                  >
                    {line.text}
                  </span>
                </div>
              ))}
              {lines.length === 0 && (
                <div className="px-3.5 py-1.5 text-[12.5px] text-textSecondary">
                  This plugin requests no capabilities.
                </div>
              )}
            </div>

            {isC && (
              <label className="mt-4 flex cursor-pointer select-none items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  className="mt-0.5 accent-red-400"
                />
                <span className="text-[13px] leading-relaxed text-textPrimary">
                  I understand this can get my Twitch account suspended, and I accept
                  that risk.
                </span>
              </label>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setAccepted(false);
                  onCancel();
                }}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[13px] text-textSecondary transition-colors hover:bg-white/10 hover:text-textPrimary"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isC && !accepted}
                onClick={() => {
                  setAccepted(false);
                  onConfirm();
                }}
                className={`rounded-lg border px-4 py-2 text-[13px] font-medium transition-colors ${
                  isC
                    ? accepted
                      ? 'border-red-400/25 bg-red-500/20 text-red-200 hover:bg-red-500/30'
                      : 'cursor-not-allowed border-white/10 bg-white/5 text-textMuted'
                    : 'border-accent/25 bg-accent/15 text-textPrimary hover:bg-accent/25'
                }`}
              >
                {isC ? `${subject.action} anyway` : subject.action}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default PluginConsentModal;
