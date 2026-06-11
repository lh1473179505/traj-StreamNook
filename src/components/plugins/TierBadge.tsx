import { PluginTier, TIER_LABEL } from '../../types/plugins';
import { Tooltip } from '../ui/Tooltip';

const TIER_CLASSES: Record<PluginTier, string> = {
  A: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/20',
  B: 'bg-sky-500/15 text-sky-300 border-sky-400/20',
  C: 'bg-violet-500/15 text-violet-300 border-violet-400/20',
};

const TIER_HINT: Record<PluginTier, string> = {
  A: 'Official APIs and local features',
  B: 'Uses additional Twitch and third-party interfaces',
  C: 'A power-user add-on that runs in its own process and can use your login',
};

/** Small neutral capability-scope chip. */
const TierBadge = ({ tier }: { tier: PluginTier }) => (
  <Tooltip content={TIER_HINT[tier]}>
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${TIER_CLASSES[tier]}`}
    >
      {TIER_LABEL[tier]}
    </span>
  </Tooltip>
);

export default TierBadge;
