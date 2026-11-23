-- Projets ERP OCI → gestion chantier
--
-- `oci_dossiers` est un cache lecture seule des dossiers de l'ERP Batipro (OCI),
-- alimenté par l'Edge Function `oci-sync` (push depuis la VM rangemails, ou pull
-- direct une fois le flux réseau VM PLU → ERP ouvert). Le navigateur ne parle
-- jamais à l'ERP.
--
-- Un chantier peut être lié à un dossier (`chantiers.oci_dossier_id`). L'import
-- passe par `import_oci_dossier()` : les champs viennent du cache (jamais du
-- client) et l'appel est idempotent — deux imports du même dossier renvoient le
-- même chantier.

CREATE TABLE IF NOT EXISTS oci_dossiers (
  id             TEXT PRIMARY KEY,           -- id ERP
  num_dossier    TEXT NOT NULL,
  nom            TEXT NOT NULL,
  phase          TEXT,                       -- Prospect|Projet|Chantier|SAV|Perdu|Autre
  client_nom     TEXT,
  adresse        TEXT,
  code_postal    TEXT,
  ville          TEXT,
  responsable    TEXT,
  erp_updated_at TIMESTAMPTZ,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oci_dossiers_phase ON oci_dossiers (phase, erp_updated_at DESC);

ALTER TABLE oci_dossiers ENABLE ROW LEVEL SECURITY;

-- Lecture : utilisateurs qui voient les chantiers ou les rendus. Écriture : service_role uniquement.
DROP POLICY IF EXISTS "Read oci_dossiers" ON oci_dossiers;
CREATE POLICY "Read oci_dossiers" ON oci_dossiers FOR SELECT
  TO authenticated
  USING (has_permission('chantiers', 'read') OR has_permission('renders', 'read'));

-- Lien chantier ↔ dossier ERP
-- FK vers le cache (jamais purgé) : permet à l'app de lire n° et phase ERP par jointure.
ALTER TABLE chantiers ADD COLUMN IF NOT EXISTS oci_dossier_id TEXT
  REFERENCES oci_dossiers(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chantiers_oci_dossier_id_key ON chantiers (oci_dossier_id)
  WHERE oci_dossier_id IS NOT NULL;

-- L'ERP ne connaît ni le secteur ni le type de projet : un projet importé les a
-- « à préciser » (chat-article gère déjà le null → « (non précisé) »).
ALTER TABLE chantiers ALTER COLUMN client_sector DROP NOT NULL;
ALTER TABLE chantiers ALTER COLUMN project_type DROP NOT NULL;

-- Département depuis le code postal ERP (« 95 870 », « 25410 », Corse, DOM).
CREATE OR REPLACE FUNCTION oci_department(p_cp TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN cp IS NULL OR length(cp) < 2 THEN ''
    WHEN cp LIKE '97%' THEN left(cp, 3)
    WHEN left(cp, 2) = '20' THEN CASE WHEN cp < '20200' THEN '2A' ELSE '2B' END
    ELSE left(cp, 2)
  END
  FROM (SELECT regexp_replace(coalesce(p_cp, ''), '\s', '', 'g') AS cp) s
$$;

-- Import (ou récupération) du chantier lié à un dossier ERP.
-- Autorisé aux créateurs de chantiers ET aux utilisateurs des rendus IA : ces
-- derniers rangent leurs visuels dans un projet sans avoir le droit de créer
-- des chantiers à la main.
CREATE OR REPLACE FUNCTION import_oci_dossier(p_oci_id TEXT)
RETURNS chantiers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d oci_dossiers;
  c chantiers;
BEGIN
  IF NOT (has_permission('chantiers', 'create') OR has_permission('renders', 'read')) THEN
    RAISE EXCEPTION 'Permission refusée' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO c FROM chantiers WHERE oci_dossier_id = p_oci_id;
  IF FOUND THEN
    RETURN c;
  END IF;

  SELECT * INTO d FROM oci_dossiers WHERE id = p_oci_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dossier ERP % introuvable', p_oci_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO chantiers (name, client_name, client_sector, project_type, address, city, department,
                         oci_dossier_id)
  VALUES (d.nom, d.client_nom, NULL, NULL, d.adresse, coalesce(d.ville, ''), oci_department(d.code_postal),
          d.id)
  ON CONFLICT (oci_dossier_id) WHERE oci_dossier_id IS NOT NULL DO NOTHING
  RETURNING * INTO c;

  -- Course perdue contre un import concurrent : on renvoie celui qui a gagné.
  IF c.id IS NULL THEN
    SELECT * INTO c FROM chantiers WHERE oci_dossier_id = p_oci_id;
  END IF;
  RETURN c;
END;
$$;

REVOKE ALL ON FUNCTION import_oci_dossier(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION import_oci_dossier(TEXT) TO authenticated;
