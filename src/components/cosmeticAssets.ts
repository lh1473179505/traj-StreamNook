// Slug -> Vite-resolved asset URL for cosmetic badges.
//
// The Supabase `cosmetics.asset_path` column is the source of truth for which
// file goes with which slug, but the actual bundling of the image into the
// build happens here so Vite can fingerprint the URL. When a new cosmetic is
// added to the catalog, drop the asset under src/assets and add a line here.

import defaultBadge from '../assets/streamnook-logo.png';
import supporterBadge from '../assets/streamnook-badge-gold.png';
import subscriberBadge from '../assets/streamnook-badge-gold-animated.webp';

export const COSMETIC_ASSET_BY_SLUG: Record<string, string> = {
  'streamnook-default': defaultBadge,
  'streamnook-supporter': supporterBadge,
  'streamnook-subscriber': subscriberBadge,
};
