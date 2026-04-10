-- ========================================================
-- Table `feedback` — tickets SAV soumis depuis la bulle
-- flottante de l'application.
-- ========================================================
-- Stocke les retours utilisateurs (bug, suggestion, question)
-- avec un snapshot de l'identité au moment de la soumission
-- pour ne pas dépendre d'un JOIN futur.
--
-- Statuts :
--   - new         : ticket fraîchement reçu
--   - in_progress : pris en charge
--   - resolved    : résolu / fermé
-- ========================================================

CREATE TABLE feedback (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email   TEXT NOT NULL,         -- snapshot au moment de la soumission
  user_name    TEXT,                  -- snapshot au moment de la soumission
  page         TEXT NOT NULL,         -- ex: "/chantiers.html"
  user_agent   TEXT,
  message      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved')),
  resolved_at  TIMESTAMPTZ,
  resolved_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_notes  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feedback_status_created ON feedback(status, created_at DESC);
CREATE INDEX idx_feedback_user_id ON feedback(user_id);

-- ── Trigger : verrouille resolved_at + resolved_by sur transition ─
CREATE OR REPLACE FUNCTION feedback_track_resolution()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'resolved' AND (OLD.status IS NULL OR OLD.status <> 'resolved') THEN
    NEW.resolved_at := NOW();
    NEW.resolved_by := auth.uid();
  ELSIF NEW.status <> 'resolved' THEN
    NEW.resolved_at := NULL;
    NEW.resolved_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER feedback_resolution_trigger
BEFORE UPDATE ON feedback
FOR EACH ROW
EXECUTE FUNCTION feedback_track_resolution();

-- ── Row Level Security ────────────────────────────────────

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- INSERT : tout utilisateur authentifié peut soumettre, mais seulement pour son
-- propre user_id (impossible d'usurper l'identité d'un autre utilisateur).
CREATE POLICY "Users insert own feedback" ON feedback
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- SELECT : un utilisateur peut lire ses propres retours
CREATE POLICY "Users read own feedback" ON feedback
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- SELECT : les utilisateurs avec feedback:read voient tous les tickets
CREATE POLICY "Permitted read feedback" ON feedback
  FOR SELECT TO authenticated
  USING (has_permission('feedback', 'read'));

-- UPDATE : les utilisateurs avec feedback:resolve peuvent changer le statut /
-- ajouter des notes sur n'importe quel ticket
CREATE POLICY "Permitted update feedback" ON feedback
  FOR UPDATE TO authenticated
  USING (has_permission('feedback', 'resolve'))
  WITH CHECK (has_permission('feedback', 'resolve'));

-- DELETE : seuls les admins (qui ont toutes les permissions) peuvent purger.
-- Pas de policy DELETE explicite — admins passent par une opération privilégiée
-- via leur is_admin = true qui court-circuite has_permission(). Ici on choisit
-- volontairement de ne pas exposer DELETE pour préserver l'audit trail.
