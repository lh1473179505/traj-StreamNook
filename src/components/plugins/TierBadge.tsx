import { PluginTier, TIER_LABEL } from '../../types/plugins';
import { Tooltip } from '../ui/Tooltip';

const TIER_CLASSES: Record<PluginTier, string> = {
  A: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/20',
  B: 'bg-amber-500/15 text-amber-300 border-amber-400/20',
  C: 'bg-red-500/15 text-red-300 border-red-400/20',
};

const TIER_HINT: Record<PluginTier, string> = {
  A: 'Official APIs and local features only',
  B: 'Uses unofficial interfaces the way a normal viewer would',
  C: 'Automates watching, claiming, or ad delivery. Twitch prohibits this',
};

/** Small colored tier chip: green Safe, amber Unofficial, red Account risk. */
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
