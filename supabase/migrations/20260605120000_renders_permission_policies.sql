-- ========================================================
-- Rendus IA : passage de l'accès admin-only au système de
-- permissions par module (admin OU permission renders:read),
-- comme les autres outils de l'app.
-- ========================================================

-- ── render_history ────────────────────────────────────────
DROP POLICY IF EXISTS "Admins read renders"   ON render_history;
DROP POLICY IF EXISTS "Admins insert renders" ON render_history;
DROP POLICY IF EXISTS "Admins delete renders" ON render_history;

CREATE POLICY "Render users read" ON render_history
  FOR SELECT TO authenticated
  USING (has_permission('renders', 'read'));

CREATE POLICY "Render users insert" ON render_history
  FOR INSERT TO authenticated
  WITH CHECK (has_permission('renders', 'read'));

CREATE POLICY "Render users delete" ON render_history
  FOR DELETE TO authenticated
  USING (has_permission('renders', 'read'));

-- ── Storage bucket "renders" ──────────────────────────────
DROP POLICY IF EXISTS "Admins read render files"   ON storage.objects;
DROP POLICY IF EXISTS "Admins upload render files" ON storage.objects;
DROP POLICY IF EXISTS "Admins delete render files" ON storage.objects;

CREATE POLICY "Render users read files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'renders' AND has_permission('renders', 'read'));

CREATE POLICY "Render users upload files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'renders' AND has_permission('renders', 'read'));

CREATE POLICY "Render users delete files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'renders' AND has_permission('renders', 'read'));
