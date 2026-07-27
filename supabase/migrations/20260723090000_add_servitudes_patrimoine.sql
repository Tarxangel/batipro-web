-- Servitudes patrimoine (AC1 abords MH, AC2 sites inscrits/classés, AC4 SPR)
-- détectées par point-dans-polygone via l'API Carto GPU dans analyze-plu.
-- Cache du résultat pour les analyses sauvegardées (même logique que
-- monuments_historiques).
ALTER TABLE analyses_plu
  ADD COLUMN IF NOT EXISTS servitudes_patrimoine jsonb;
