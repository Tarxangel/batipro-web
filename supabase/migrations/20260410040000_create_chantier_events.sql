-- ========================================================
-- Table `chantier_events` — historique éditable d'un chantier
-- ========================================================
-- Permet de tracer factuellement les événements qui se sont
-- déroulés sur un chantier (livraison, démolition, contrôle,
-- avancement, etc.). Cet historique servira de SOURCE DE VÉRITÉ
-- pour le futur générateur d'articles IA, qui doit s'appuyer
-- uniquement sur des faits horodatés et ne rien inventer.
-- ========================================================

CREATE TABLE chantier_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id  UUID NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,
  event_date   DATE NOT NULL,
  event_type   TEXT,                          -- catégorie libre (ex: "démolition", "livraison")
  description  TEXT NOT NULL,                 -- texte factuel
  photo_url    TEXT,                          -- url photo optionnelle (pour plus tard)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX idx_chantier_events_chantier_date
  ON chantier_events(chantier_id, event_date DESC);

-- ── Row Level Security ────────────────────────────────────

ALTER TABLE chantier_events ENABLE ROW LEVEL SECURITY;

-- Lecture publique (cohérent avec chantiers)
CREATE POLICY "Public read chantier_events" ON chantier_events
  FOR SELECT USING (true);

-- Écriture : exige la permission `chantiers:edit` (les events sont
-- considérés comme des métadonnées éditoriales du chantier)
CREATE POLICY "Permitted insert chantier_events" ON chantier_events
  FOR INSERT TO authenticated
  WITH CHECK (has_permission('chantiers', 'edit'));

CREATE POLICY "Permitted update chantier_events" ON chantier_events
  FOR UPDATE TO authenticated
  USING (has_permission('chantiers', 'edit'))
  WITH CHECK (has_permission('chantiers', 'edit'));

CREATE POLICY "Permitted delete chantier_events" ON chantier_events
  FOR DELETE TO authenticated
  USING (has_permission('chantiers', 'edit'));
