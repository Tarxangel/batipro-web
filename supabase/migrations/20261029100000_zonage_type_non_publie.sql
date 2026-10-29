-- Commune dotée d'un document d'urbanisme (PLU / carte communale) non publié
-- sur le Géoportail de l'urbanisme : analyze-plu renvoie zonage.type = 'NON_PUBLIE'.
ALTER TABLE public.analyses_plu DROP CONSTRAINT analyses_plu_zonage_type_check;
ALTER TABLE public.analyses_plu ADD CONSTRAINT analyses_plu_zonage_type_check
  CHECK (zonage_type IN ('PLU', 'RNU', 'NON_PUBLIE'));
