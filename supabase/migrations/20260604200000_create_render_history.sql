-- ========================================================
-- Mémoire des rendus IA (feature "Rendus IA", admin)
-- ========================================================
-- Stocke les visuels générés que l'admin choisit d'enregistrer,
-- taggés par chantier. Les fichiers vivent dans le bucket Storage
-- privé "renders" ; cette table en tient l'index + les métadonnées.
-- ========================================================

CREATE TABLE render_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id  UUID REFERENCES chantiers(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('photoreal', 'sketch')),
  storage_path TEXT NOT NULL,
  resolution   TEXT NOT NULL DEFAULT '1K',
  presets      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX render_history_chantier_idx ON render_history (chantier_id, created_at DESC);

ALTER TABLE render_history ENABLE ROW LEVEL SECURITY;

-- Réservé aux admins (feature admin-only pour l'instant).
CREATE POLICY "Admins read renders" ON render_history
  FOR SELECT TO authenticated
  USING (is_current_user_admin());

CREATE POLICY "Admins insert renders" ON render_history
  FOR INSERT TO authenticated
  WITH CHECK (is_current_user_admin());

CREATE POLICY "Admins delete renders" ON render_history
  FOR DELETE TO authenticated
  USING (is_current_user_admin());

-- ── Bucket Storage privé "renders" ────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('renders', 'renders', false)
ON CONFLICT (id) DO NOTHING;

-- Accès fichiers : admins uniquement (lecture via URL signée, upload, suppression).
CREATE POLICY "Admins read render files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'renders' AND is_current_user_admin());

CREATE POLICY "Admins upload render files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'renders' AND is_current_user_admin());

CREATE POLICY "Admins delete render files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'renders' AND is_current_user_admin());
