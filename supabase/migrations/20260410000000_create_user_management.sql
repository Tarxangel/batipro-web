-- ========================================================
-- Système de gestion des utilisateurs et permissions
-- ========================================================
-- Crée une table app_profiles liée à auth.users qui contient
-- le rôle (admin ou non) et un objet JSONB de permissions
-- granulaires par module et action.
--
-- Format permissions JSONB :
--   {
--     "articles":  ["read", "create", "edit", "publish"],
--     "chantiers": ["read", "create", "edit", "delete"],
--     "icpe":      ["read"],
--     "map":       ["read"],
--     "feedback":  ["read", "resolve"]
--   }
-- ========================================================

CREATE TABLE app_profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT NOT NULL,
  is_admin    BOOLEAN NOT NULL DEFAULT false,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_app_profiles_email ON app_profiles(email);

-- ── Helper functions ──────────────────────────────────────

-- Renvoie true si l'utilisateur courant a is_admin = true.
-- SECURITY DEFINER pour bypasser le RLS lors de la lecture
-- (sinon récursion infinie sur les policies de app_profiles).
CREATE OR REPLACE FUNCTION is_current_user_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM app_profiles WHERE id = auth.uid()),
    false
  );
$$;

-- Renvoie true si l'utilisateur courant a la permission demandée
-- (admin court-circuite tout).
CREATE OR REPLACE FUNCTION has_permission(p_module TEXT, p_action TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_admin FROM app_profiles WHERE id = auth.uid()),
    false
  )
  OR EXISTS (
    SELECT 1 FROM app_profiles
    WHERE id = auth.uid()
      AND permissions -> p_module ? p_action
  );
$$;

-- ── Trigger updated_at ────────────────────────────────────

CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER app_profiles_set_updated_at
BEFORE UPDATE ON app_profiles
FOR EACH ROW
EXECUTE FUNCTION trigger_set_updated_at();

-- ── Row Level Security ────────────────────────────────────

ALTER TABLE app_profiles ENABLE ROW LEVEL SECURITY;

-- Tout utilisateur authentifié peut lire son propre profil
-- (utilisé pour récupérer ses permissions au login).
CREATE POLICY "Users read own profile" ON app_profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Les admins peuvent tout lire / écrire / supprimer
CREATE POLICY "Admins read all profiles" ON app_profiles
  FOR SELECT TO authenticated
  USING (is_current_user_admin());

CREATE POLICY "Admins insert profiles" ON app_profiles
  FOR INSERT TO authenticated
  WITH CHECK (is_current_user_admin());

CREATE POLICY "Admins update profiles" ON app_profiles
  FOR UPDATE TO authenticated
  USING (is_current_user_admin())
  WITH CHECK (is_current_user_admin());

CREATE POLICY "Admins delete profiles" ON app_profiles
  FOR DELETE TO authenticated
  USING (is_current_user_admin());

-- ── Permissions GRANT ─────────────────────────────────────

GRANT EXECUTE ON FUNCTION is_current_user_admin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION has_permission(TEXT, TEXT) TO authenticated, anon;
