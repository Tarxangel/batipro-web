-- ========================================================
-- Resserrement RLS sur la table `article_drafts`
-- ========================================================
-- Avant : `anon` pouvait tout faire (héritage du temps où l'app
-- n'avait pas d'auth — la "vérification admin" était purement
-- côté client via un JWT maison).
-- Après : seuls les utilisateurs authentifiés ayant la permission
-- correspondante peuvent écrire / publier / supprimer.
-- La lecture reste publique pour préserver les consultations
-- non-authentifiées éventuelles.
-- ========================================================

-- Drop défensif de TOUTES les policies existantes sur article_drafts
-- (les noms historiques peuvent varier — on ratisse large pour repartir propre).
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'article_drafts'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.article_drafts', pol.policyname);
  END LOOP;
END $$;

-- S'assure que RLS est bien activée
ALTER TABLE article_drafts ENABLE ROW LEVEL SECURITY;

-- ── SELECT : public (anon + authenticated) ───────────────
CREATE POLICY "Public read article_drafts" ON article_drafts
  FOR SELECT
  USING (true);

-- ── INSERT : authentifié + permission articles.create ────
CREATE POLICY "Permitted insert article_drafts" ON article_drafts
  FOR INSERT
  TO authenticated
  WITH CHECK (has_permission('articles', 'create'));

-- ── UPDATE : authentifié + permission articles.edit ──────
-- Note : la transition draft → published est aussi une UPDATE,
-- gérée logiquement côté app par le bouton "Publier" qui requiert
-- la permission `articles:publish`. Le RLS n'autorise que `edit` ici
-- car `publish` est un UPDATE de fait. Donc pour pouvoir publier,
-- l'utilisateur doit avoir AU MINIMUM `articles:edit` ET `articles:publish`.
-- L'admin UI doit cocher les deux pour les publishers.
CREATE POLICY "Permitted update article_drafts" ON article_drafts
  FOR UPDATE
  TO authenticated
  USING (has_permission('articles', 'edit'))
  WITH CHECK (has_permission('articles', 'edit'));

-- ── DELETE : authentifié + permission articles.delete ────
CREATE POLICY "Permitted delete article_drafts" ON article_drafts
  FOR DELETE
  TO authenticated
  USING (has_permission('articles', 'delete'));
