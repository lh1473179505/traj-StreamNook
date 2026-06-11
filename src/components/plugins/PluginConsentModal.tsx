import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Puzzle } from 'lucide-react';
import {
  capabilityLines,
  GrantedCaps,
  PluginTier,
  TIER_LABEL,
} from '../../types/plugins';
import TierBadge from './TierBadge';

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
            className="glass-panel p-6 w-[480px] max-w-[90vw] max-h-[85vh] overflow-y-auto relative"
          >
            <div className="flex items-center gap-3 mb-1">
              <div className={`p-2 rounded-lg ${isC ? 'bg-red-500/15' : 'bg-accent/15'}`}>
                {isC ? (
                  <ShieldAlert size={20} className="text-red-300" />
                ) : (
                  <Puzzle size={20} className="text-accent" />
                )}
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-textPrimary truncate">
                  {isC
                    ? `${subject.name} can get your Twitch account suspended.`
                    : `${subject.action} ${subject.name}?`}
                </h2>
                <p className="text-[12px] text-textSecondary">
                  by {subject.author} · v{subject.version} ·{' '}
                  <TierBadge tier={subject.tier} /> {TIER_LABEL[subject.tier]}
                </p>
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

            <div className="mt-4 settings-card px-4 py-1">
              {lines.map((line) => (
                <div
                  key={line.text}
                  className={`py-2 text-[13px] leading-relaxed ${
                    line.warning ? 'text-red-300' : 'text-textPrimary'
                  }`}
                >
                  {line.text}
                </div>
              ))}
              {lines.length === 0 && (
                <div className="py-2 text-[13px] text-textSecondary">
                  This plugin requests no capabilities.
                </div>
              )}
            </div>

            {isC && (
              <label className="mt-4 flex items-start gap-2.5 cursor-pointer select-none">
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
                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[13px] text-textSecondary hover:text-textPrimary transition-colors"
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
                className={`px-4 py-2 rounded-lg border text-[13px] font-medium transition-colors ${
                  isC
                    ? accepted
                      ? 'bg-red-500/20 hover:bg-red-500/30 border-red-400/30 text-red-200'
                      : 'bg-white/5 border-white/10 text-textMuted cursor-not-allowed'
                    : 'bg-accent/20 hover:bg-accent/30 border-accent/30 text-textPrimary'
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
