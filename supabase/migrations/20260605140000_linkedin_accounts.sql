-- ========================================================
-- Connexion LinkedIn par utilisateur (publication directe)
-- ========================================================
-- Stocke le token OAuth LinkedIn de chaque utilisateur pour
-- publier sur son profil perso (scope w_member_social).
-- Les tokens ne sont JAMAIS exposés au client : aucune policy
-- pour 'authenticated' → seules les Edge Functions (service
-- role, qui bypass RLS) y accèdent.
-- ========================================================

-- États OAuth temporaires (anti-CSRF + association state -> user)
CREATE TABLE linkedin_oauth_states (
  state      TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Comptes LinkedIn connectés
CREATE TABLE linkedin_accounts (
  user_id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  person_urn           TEXT NOT NULL,                -- urn:li:person:{sub}
  linkedin_name        TEXT,
  access_token         TEXT NOT NULL,
  refresh_token        TEXT,
  expires_at           TIMESTAMPTZ NOT NULL,
  refresh_expires_at   TIMESTAMPTZ,
  scope                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE linkedin_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkedin_accounts ENABLE ROW LEVEL SECURITY;
-- Aucune policy : accès réservé au service role (Edge Functions).
-- Les tokens ne transitent jamais par le navigateur.
