-- Add monuments_historiques cache column to analyses_plu.
-- Stores a JSON array of Mérimée records within a 500m radius (legal ABF perimeter)
-- fetched at analysis time. Structure (per item):
--   {
--     "reference":           "PA25000077",
--     "name":                "Hôtel de Montureux",
--     "type":                "hôtel",
--     "protection":          "inscrit MH" | "classé MH" | ...,
--     "century":             "16e siècle",
--     "distance_m":          230,
--     "lat":                 47.2393,
--     "lon":                 6.0237
--   }
--
-- A null value means no fetch was performed (legacy rows before this feature).
-- An empty array [] means a fetch was done and found nothing.

ALTER TABLE public.analyses_plu
  ADD COLUMN IF NOT EXISTS monuments_historiques JSONB;

COMMENT ON COLUMN public.analyses_plu.monuments_historiques IS
  'Liste des MH (Mérimée) dans un rayon de 500m, cachée au moment de l''analyse. Null = pas encore fetché, [] = fetché vide.';
