-- Table des chantiers
CREATE TABLE chantiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  client_name TEXT,
  client_sector TEXT NOT NULL,
  project_type TEXT NOT NULL,
  address TEXT,
  city TEXT NOT NULL,
  department TEXT NOT NULL,
  surface INTEGER,
  description TEXT,
  seo_keywords TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed')),
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- FK article_drafts -> chantiers
ALTER TABLE article_drafts ADD COLUMN chantier_id UUID REFERENCES chantiers(id);

-- Index pour les requêtes courantes
CREATE INDEX idx_chantiers_status ON chantiers(status);
CREATE INDEX idx_article_drafts_chantier_id ON article_drafts(chantier_id);

-- RLS policies (anon access comme article_drafts)
ALTER TABLE chantiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon read chantiers" ON chantiers
  FOR SELECT TO anon USING (true);

CREATE POLICY "Allow anon insert chantiers" ON chantiers
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow anon update chantiers" ON chantiers
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon delete chantiers" ON chantiers
  FOR DELETE TO anon USING (true);
