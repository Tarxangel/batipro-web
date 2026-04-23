-- Ajoute une colonne de cache pour le tableau PLU détaillé (14 catégories)
-- Rempli à la demande par la fonction analyze-plu-detailed.
-- NULL tant que l'utilisateur n'a pas demandé la vue détaillée.

ALTER TABLE analyses_plu
  ADD COLUMN IF NOT EXISTS detailed_table JSONB;

COMMENT ON COLUMN analyses_plu.detailed_table IS
  'Tableau réglementaire détaillé (14 catégories) extrait du PLU par Gemini, cache pour éviter de refacturer à chaque ouverture';
