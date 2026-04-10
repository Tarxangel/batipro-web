-- ========================================================
-- Resserrement RLS sur la table `chantiers`
-- ========================================================
-- Avant : `anon` pouvait tout faire (USING true / WITH CHECK true)
-- Après : seuls les utilisateurs authentifiés ayant la permission
-- correspondante (chantiers.create/edit/delete) peuvent écrire.
-- La lecture reste publique pour ne pas casser les flux qui ne
-- nécessitent pas d'authentification (ex: aperçu sur la home, etc).
-- ========================================================

-- Drop des anciennes policies ouvertes
DROP POLICY IF EXISTS "Allow anon read chantiers"   ON chantiers;
DROP POLICY IF EXISTS "Allow anon insert chantiers" ON chantiers;
DROP POLICY IF EXISTS "Allow anon update chantiers" ON chantiers;
DROP POLICY IF EXISTS "Allow anon delete chantiers" ON chantiers;

-- ── SELECT : public (anon + authenticated) ───────────────
CREATE POLICY "Public read chantiers" ON chantiers
  FOR SELECT
  USING (true);

-- ── INSERT : authentifié + permission chantiers.create ───
CREATE POLICY "Permitted insert chantiers" ON chantiers
  FOR INSERT
  TO authenticated
  WITH CHECK (has_permission('chantiers', 'create'));

-- ── UPDATE : authentifié + permission chantiers.edit ─────
CREATE POLICY "Permitted update chantiers" ON chantiers
  FOR UPDATE
  TO authenticated
  USING (has_permission('chantiers', 'edit'))
  WITH CHECK (has_permission('chantiers', 'edit'));

-- ── DELETE : authentifié + permission chantiers.delete ───
CREATE POLICY "Permitted delete chantiers" ON chantiers
  FOR DELETE
  TO authenticated
  USING (has_permission('chantiers', 'delete'));
