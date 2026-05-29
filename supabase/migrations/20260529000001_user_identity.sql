-- StreamNook Identity loadout: the per-user, cross-client selection of which
-- aggregated badges a member wants displayed as their StreamNook presence.
--
-- Unlike the cosmetics tables (anon-write, soft-auth from the picker), writes
-- to user_identity go ONLY through the service-role Identity API on
-- streamnook.app (/api/v1/identity), which verifies the caller actually owns
-- the Twitch user_id (bearer token validated against id.twitch.tv, or the
-- sn_session cookie) before upserting. So there is intentionally NO anon-write
-- policy here — the row is world-readable (chat renders every member's chosen
-- subset) but only the verified owner can change it.
--
-- Schema note: `badges` is a positive show-list of opaque, provider-agnostic
-- badge keys the consumer resolves to images itself (same contract shape as
-- 7TV's cosmetics API):
--   third-party  ->  "<provider>:<id>"   e.g. "ffz:6", "bttv:abc", "chatterino:x"
--   7TV badge    ->  "7tv:<badgeId>"     (reserved for later; v1 editor writes third-party)
--   twitch       ->  "twitch:<setID>/<version>" (reserved)
-- `customized=false` (or no row) means "show everything" — the pre-feature
-- default, so existing members are unaffected until they curate.

CREATE TABLE IF NOT EXISTS user_identity (
    twitch_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    badges         JSONB       NOT NULL DEFAULT '[]'::jsonb,
    paint          TEXT,
    customized     BOOLEAN     NOT NULL DEFAULT false,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Row Level Security ──────────────────────────────────────────────────
-- World-readable: any client (and any third-party app via the public API)
-- can read a member's applied identity to render it. No anon write policy —
-- the service-role Identity API is the only writer (it bypasses RLS), and it
-- gates the write on verified Twitch ownership.
ALTER TABLE user_identity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_identity_read ON user_identity;
CREATE POLICY user_identity_read ON user_identity FOR SELECT USING (true);
