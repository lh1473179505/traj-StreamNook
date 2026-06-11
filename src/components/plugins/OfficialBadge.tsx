import { BadgeCheck } from 'lucide-react';
import { Tooltip } from '../ui/Tooltip';

/** Marks a first-party plugin built by StreamNook. Approved third-party
 *  plugins in the index do not carry this; being in the index is their
 *  approval. */
const OfficialBadge = () => (
  <Tooltip content="Official plugin, built by StreamNook">
    <span className="inline-flex items-center gap-1 rounded border border-amber-400/20 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
      <BadgeCheck size={11} strokeWidth={2.5} />
      Official
    </span>
  </Tooltip>
);

export default OfficialBadge;
