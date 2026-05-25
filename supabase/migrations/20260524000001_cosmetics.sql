-- Cosmetic badges (default StreamNook mark + Supporter + Subscriber) plus
-- the Ko-fi entitlement plumbing that grants the paid tiers.
--
-- The auth model mirrors the rest of StreamNook's Supabase usage: the anon
-- key reads/writes against tables keyed by Twitch user_id, with the client
-- asserting its own identity. The Ko-fi webhook runs as service_role inside
-- a Supabase Edge Function and so bypasses RLS.
--
-- This migration is intentionally idempotent. Re-running it is safe — it
-- only DELETEs the explicit legacy slugs from the original draft and uses
-- ALTER TABLE IF NOT EXISTS / INSERT ON CONFLICT throughout.

-- ─── Cosmetics catalog ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cosmetics (
    slug          TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    description   TEXT,
    kind          TEXT NOT NULL DEFAULT 'badge',
    asset_path    TEXT NOT NULL,
    animated      BOOLEAN NOT NULL DEFAULT false,
    payment_type  TEXT,
    ko_fi_url     TEXT,
    sort_order    INT NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- is_default flag: cosmetics with is_default=true are universally equippable
-- by every StreamNook member (no per-user entitlement row needed). Kept
-- additive so older catalogs that ran the migration before this column
-- existed still upgrade cleanly.
ALTER TABLE cosmetics ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

-- min_amount: minimum Ko-fi payment (in the catalog row's implied currency,
-- currently USD) required to be awarded this cosmetic. NULL or 0 means "no
-- minimum" (e.g. the default cosmetic). The webhook gates BOTH the cosmetic
-- award AND the subscriber-month increment on amount >= min_amount, so
-- under-min payments don't count toward future tiered-month badges either.
ALTER TABLE cosmetics ADD COLUMN IF NOT EXISTS min_amount NUMERIC(10, 2);

-- Clean up old slugs from the original Gold/Gold-Animated draft naming.
-- ON DELETE CASCADE on user_cosmetics + ON DELETE SET NULL on
-- user_cosmetic_active mean this is safe even with downstream rows.
DELETE FROM cosmetics WHERE slug IN ('streamnook-gold', 'streamnook-gold-animated');

-- ─── User entitlements (INSERT-only; drives realtime) ────────────────────
CREATE TABLE IF NOT EXISTS user_cosmetics (
    twitch_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug           TEXT NOT NULL REFERENCES cosmetics(slug) ON DELETE CASCADE,
    granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    source         TEXT NOT NULL DEFAULT 'kofi',
    payment_id     TEXT,
    PRIMARY KEY (twitch_user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_user_cosmetics_user ON user_cosmetics(twitch_user_id);

-- ─── Active selection (one row per user) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS user_cosmetic_active (
    twitch_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    active_slug    TEXT REFERENCES cosmetics(slug) ON DELETE SET NULL,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Ko-fi transaction audit (idempotency by message_id) ─────────────────
CREATE TABLE IF NOT EXISTS kofi_transactions (
    message_id      TEXT PRIMARY KEY,
    kofi_email      TEXT,
    from_name       TEXT,
    amount          TEXT,
    currency        TEXT,
    payment_type    TEXT NOT NULL,
    is_subscription BOOLEAN NOT NULL DEFAULT false,
    is_first_sub    BOOLEAN NOT NULL DEFAULT false,
    is_public       BOOLEAN NOT NULL DEFAULT true,
    tier_name       TEXT,
    matched_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    matched_via     TEXT,
    cosmetic_slug   TEXT REFERENCES cosmetics(slug) ON DELETE SET NULL,
    raw_data        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kofi_txn_email ON kofi_transactions(LOWER(kofi_email)) WHERE kofi_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kofi_txn_matched_user ON kofi_transactions(matched_user_id) WHERE matched_user_id IS NOT NULL;

-- ─── Ko-fi email overrides (admin link page + auto-link from @mention) ───
CREATE TABLE IF NOT EXISTS kofi_email_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kofi_email  TEXT NOT NULL,
    linked_by   TEXT NOT NULL DEFAULT 'admin',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kofi_email_links_email_unique ON kofi_email_links(LOWER(kofi_email));
CREATE INDEX IF NOT EXISTS idx_kofi_email_links_user ON kofi_email_links(user_id);

-- ─── Subscriber state (months count + activity recency) ──────────────────
-- Each Ko-fi subscription webhook (payment_type='Subscription') triggers an
-- atomic UPSERT here via record_subscriber_payment(). Derived fields:
--   - total_months: count of successful subscription payments
--   - first_subscribed_at: only set on the first INSERT
--   - last_paid_at: most recent payment timestamp
-- Active-subscription detection is INFERRED from last_paid_at (Ko-fi sends
-- no cancellation webhook, only renewal webhooks). Suggested grace window
-- for monthly subs: 35 days.
CREATE TABLE IF NOT EXISTS user_subscriber_state (
    twitch_user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    total_months         INT NOT NULL DEFAULT 0,
    first_subscribed_at  TIMESTAMPTZ,
    last_paid_at         TIMESTAMPTZ,
    last_payment_id      TEXT,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriber_state_last_paid
    ON user_subscriber_state(last_paid_at DESC);

-- Atomic increment helper. Called by the kofi-webhook Edge Function on
-- every Subscription payment after idempotency + match steps succeed.
-- Returns the new total_months so the webhook can log it and (later) check
-- against tier-badge thresholds.
CREATE OR REPLACE FUNCTION record_subscriber_payment(
    p_user_id    TEXT,
    p_payment_id TEXT,
    p_paid_at    TIMESTAMPTZ DEFAULT now()
)
RETURNS INT AS $$
DECLARE
    new_total INT;
BEGIN
    INSERT INTO user_subscriber_state (
        twitch_user_id, total_months, first_subscribed_at, last_paid_at, last_payment_id, updated_at
    )
    VALUES (p_user_id, 1, p_paid_at, p_paid_at, p_payment_id, now())
    ON CONFLICT (twitch_user_id) DO UPDATE
    SET total_months    = user_subscriber_state.total_months + 1,
        last_paid_at    = EXCLUDED.last_paid_at,
        last_payment_id = EXCLUDED.last_payment_id,
        updated_at      = now()
    RETURNING total_months INTO new_total;
    RETURN new_total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Seed the catalog ────────────────────────────────────────────────────
INSERT INTO cosmetics (slug, name, description, kind, asset_path, animated, payment_type, ko_fi_url, sort_order, is_default, min_amount)
VALUES
  (
    'streamnook-default',
    'StreamNook Member',
    'The default StreamNook mark, free for every community member.',
    'badge',
    'streamnook-logo.png',
    false,
    NULL,
    NULL,
    0,
    true,
    NULL
  ),
  (
    'streamnook-supporter',
    'Supporter',
    'A gold StreamNook mark. Awarded for a one-time donation of $3 or more on Ko-fi.',
    'badge',
    'streamnook-badge-gold.png',
    false,
    'Donation',
    'https://ko-fi.com/streamnook',
    10,
    false,
    3.00
  ),
  (
    'streamnook-subscriber',
    'Subscriber',
    'An animated gold StreamNook mark that flows as a Penrose triangle. Awarded for an active Ko-fi monthly subscription of $5 or more.',
    'badge',
    'streamnook-badge-gold-animated.webp',
    true,
    'Subscription',
    'https://ko-fi.com/streamnook',
    20,
    false,
    5.00
  )
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    asset_path = EXCLUDED.asset_path,
    animated = EXCLUDED.animated,
    payment_type = EXCLUDED.payment_type,
    ko_fi_url = EXCLUDED.ko_fi_url,
    sort_order = EXCLUDED.sort_order,
    is_default = EXCLUDED.is_default,
    min_amount = EXCLUDED.min_amount;

-- ─── Row Level Security ──────────────────────────────────────────────────
-- Catalog + entitlements + selection are world-readable so chat can render
-- every viewer's badge. Writes to user_cosmetic_active go through the anon
-- key from the picker UI (same soft-auth posture as user_stats). The Ko-fi
-- webhook uses service_role and bypasses RLS for writes to user_cosmetics,
-- kofi_transactions, and kofi_email_links.

ALTER TABLE cosmetics ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_cosmetics ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_cosmetic_active ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriber_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE kofi_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kofi_email_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cosmetics_read ON cosmetics;
CREATE POLICY cosmetics_read ON cosmetics FOR SELECT USING (true);

DROP POLICY IF EXISTS user_cosmetics_read ON user_cosmetics;
CREATE POLICY user_cosmetics_read ON user_cosmetics FOR SELECT USING (true);

DROP POLICY IF EXISTS user_cosmetic_active_read ON user_cosmetic_active;
CREATE POLICY user_cosmetic_active_read ON user_cosmetic_active FOR SELECT USING (true);

DROP POLICY IF EXISTS user_cosmetic_active_write ON user_cosmetic_active;
CREATE POLICY user_cosmetic_active_write ON user_cosmetic_active
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS user_subscriber_state_read ON user_subscriber_state;
CREATE POLICY user_subscriber_state_read ON user_subscriber_state FOR SELECT USING (true);
