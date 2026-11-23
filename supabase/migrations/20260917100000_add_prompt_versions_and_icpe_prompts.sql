-- ========================================================
-- Historique des prompts IA + prompts ICPE éditables
-- ========================================================
-- 1. ai_prompt_versions : chaque contenu remplacé est archivé par un trigger,
--    pas par l'UI. Une modif faite hors admin (psql, Studio) est donc capturée
--    elle aussi, et une restauration est elle-même archivée : on ne peut pas
--    perdre un contenu par une mauvaise manip.
-- 2. Trois nouveaux slots pour le module ICPE, jusqu'ici écrits en dur :
--    - icpe-approfondir         (bouton « Approfondir avec l'IA », step 3)
--    - icpe-tableau-prescriptions (remplissage des tableaux de prescriptions)
--    - icpe-chatbot             (chat expert ICPE)
-- ========================================================

CREATE TABLE ai_prompt_versions (
  id          BIGSERIAL PRIMARY KEY,
  prompt_key  TEXT NOT NULL REFERENCES ai_prompts(key) ON DELETE CASCADE,
  -- Contenu REMPLACÉ (pas le nouveau) : une ligne = un état antérieur.
  content     TEXT NOT NULL,
  -- Qui avait écrit ce contenu, et quand — repris de la ligne ai_prompts
  -- remplacée, pas de l'auteur de la modification en cours.
  authored_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  authored_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_prompt_versions_key_idx
  ON ai_prompt_versions (prompt_key, archived_at DESC);

-- ── Trigger d'archivage ───────────────────────────────────
-- SECURITY DEFINER : l'insert doit passer quel que soit l'appelant, sans lui
-- ouvrir de droit d'écriture direct sur la table d'historique.

CREATE OR REPLACE FUNCTION archive_ai_prompt_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.content IS DISTINCT FROM OLD.content THEN
    INSERT INTO ai_prompt_versions (prompt_key, content, authored_by, authored_at)
    VALUES (OLD.key, OLD.content, OLD.updated_by, OLD.updated_at);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_prompts_archive_version
BEFORE UPDATE ON ai_prompts
FOR EACH ROW
EXECUTE FUNCTION archive_ai_prompt_version();

-- ── Row Level Security ────────────────────────────────────
-- Lecture pour tout authentifié (comme ai_prompts). Aucune policy d'écriture :
-- seul le trigger alimente la table, personne ne réécrit l'historique.

ALTER TABLE ai_prompt_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read prompt versions" ON ai_prompt_versions
  FOR SELECT TO authenticated
  USING (true);

-- Doublé au niveau des GRANT : l'historique est en lecture seule pour l'app,
-- le trigger (SECURITY DEFINER) est le seul à y écrire.
REVOKE ALL ON ai_prompt_versions FROM anon, authenticated;
GRANT SELECT ON ai_prompt_versions TO authenticated;

-- ========================================================
-- Prompts ICPE
-- ========================================================

INSERT INTO ai_prompts (key, label, description, placeholders, content) VALUES

('icpe-approfondir',
 'ICPE — Approfondir avec l''IA',
 'Analyse contextuelle déclenchée par le bouton « Approfondir avec l''IA » de l''étape 3 du simulateur ICPE. Doit répondre en JSON ({interactions, vigilance[], cumuls, recommandations[]}) : si tu changes la structure, l''affichage de la page casse.',
 ARRAY['RUBRIQUES', 'PRESCRIPTIONS'],
 $prompt$Tu es un expert ICPE specialise dans les entrepots et batiments industriels en France.

Voici les rubriques identifiees pour ce projet:
{{RUBRIQUES}}
{{PRESCRIPTIONS}}

A partir des prescriptions extraites ci-dessus, fournis une analyse contextuelle:
1. Interactions et cumuls entre les rubriques: quand plusieurs rubriques imposent des prescriptions sur le meme theme, identifie la valeur la PLUS CONTRAIGNANTE (ex: la distance la plus grande, le REI le plus eleve)
2. Points de vigilance specifiques a cette combinaison
3. Prescriptions qui se cumulent ou entrent en conflit — avec les valeurs chiffrees
4. Recommandations pratiques pour le maitre d'ouvrage

Reponds en JSON avec cette structure:
{
  "interactions": "texte sur les interactions entre rubriques",
  "vigilance": ["point 1", "point 2", ...],
  "cumuls": "texte sur les cumuls de prescriptions",
  "recommandations": ["reco 1", "reco 2", ...]
}$prompt$),

('icpe-tableau-prescriptions',
 'ICPE — Remplissage des tableaux de prescriptions',
 'Extraction des prescriptions techniques depuis le texte de l''arrêté, une rubrique à la fois. La structure JSON attendue en fin de prompt pilote directement les 15 catégories du tableau affiché : n''en retire pas une clé sans adapter le simulateur.',
 ARRAY['CODE', 'INTITULE', 'REGIME', 'ARRETE'],
 $prompt$Tu es un assistant specialise en reglementation ICPE.

MISSION : A partir du TEXTE REGLEMENTAIRE FOURNI CI-DESSOUS, extraire les prescriptions techniques pour la rubrique et le regime demande.

RUBRIQUE : {{CODE}} - {{INTITULE}} — Regime : {{REGIME}}

TEXTE REGLEMENTAIRE SOURCE :
{{ARRETE}}

REGLES :
- Extrais les informations presentes dans le texte ci-dessus
- IMPORTANT : Les prescriptions de l'arrete s'appliquent au regime demande meme si le texte ne mentionne pas explicitement le nom du regime. Un arrete type couvre generalement TOUS les regimes de la rubrique. Extrais les prescriptions du texte et attribue-les au regime demande.
- Si une categorie de prescription n'est veritablement pas abordee du tout dans le texte (pas un seul mot sur le sujet), indique "Non precise dans l'arrete"
- Utilise la terminologie exacte du texte (REI, EI, R15, R30, R60, Broof t3, etc.)
- Inclus les valeurs numeriques exactes telles qu'elles apparaissent dans l'arrete
- Pour Autorisation sans arrete type, indique "Selon arrete prefectoral"
- Sois CONCIS : donne les valeurs cles et exigences, pas de phrases de contexte inutiles. Ex: "REI 120, R15 structure" plutot que de recopier des paragraphes entiers

Reponds avec un objet JSON :
{
  "{{CODE}}": {
    "{{REGIME}}": {
      "reseaux": {
        "Eaux pluviales": "..."
      },
      "dechets": {
        "Gestion des dechets": "..."
      },
      "implantation": {
        "Distances limites": "...",
        "Distances inter-batiments": "..."
      },
      "accessibilite": {
        "Acces au site": "...",
        "Voie engin": "...",
        "Echelles": "...",
        "Issues et quais": "...",
        "Locaux a risques": "..."
      },
      "construction": {
        "Structure": "...",
        "Toiture": "...",
        "Facades": "...",
        "Portes et fermetures": "..."
      },
      "cantonnement": {
        "Surface cellules": "...",
        "Murs separatifs": "...",
        "Ecrans de cantonnement": "..."
      },
      "desenfumage": {
        "Surface utile": "...",
        "Commandes": "...",
        "Exutoires": "..."
      },
      "stockage": {
        "Hauteur stockage": "...",
        "Allees de circulation": "...",
        "Distance aux parois": "..."
      },
      "lutte_incendie": {
        "Extincteurs": "...",
        "RIA": "...",
        "Sprinkler": "...",
        "Colonnes seches": "..."
      },
      "eau_incendie": {
        "Besoins en eau": "...",
        "Retention eaux extinction": "..."
      },
      "ventilation": {
        "Dispositifs de ventilation": "..."
      },
      "elec": {
        "Conformite": "...",
        "Coupure d'urgence": "..."
      },
      "chauffage": {
        "Type autorise": "...",
        "Implantation": "..."
      },
      "exploitation": {
        "Consignes d'exploitation": "...",
        "Verifications periodiques": "..."
      }
    }
  }
}$prompt$),

('icpe-chatbot',
 'ICPE — Chat expert',
 'System prompt du chat ICPE du simulateur. La réponse est affichée telle quelle (texte, **gras** supporté) : ne demande pas de JSON ici.',
 ARRAY['RUBRIQUES', 'PRESCRIPTIONS', 'PROJET', 'LOCALISATION', 'QUESTION'],
 $prompt$Tu es un expert ICPE (Installations Classees pour la Protection de l'Environnement) specialise dans la reglementation francaise des batiments industriels et entrepots.

Contexte du projet en cours:
{{RUBRIQUES}}
{{PRESCRIPTIONS}}
{{PROJET}}
{{LOCALISATION}}

Question de l'utilisateur: {{QUESTION}}

INSTRUCTIONS :
- Base tes reponses sur les PRESCRIPTIONS EXTRAITES ci-dessus quand elles sont disponibles
- Quand plusieurs rubriques ont des prescriptions sur le meme theme, indique la valeur la plus contraignante
- Cite les rubriques sources (ex: "Rubrique 1510 impose REI 120, plus contraignant que la 1511 qui impose REI 60")
- Reponds de maniere precise et concise
- Emploie la terminologie ICPE avec rigueur : ne confonds JAMAIS des notions distinctes. Exemple : un "local a risque" (local a risques particuliers/importants au sens securite incendie : chaufferie, local de charge, stockage de matieres dangereuses...) n'est PAS l'ensemble des locaux du batiment. Si un terme reglementaire a une definition precise, applique-la strictement.

RIGUEUR ET POSTURE D'EXPERT (important) :
- Ne change PAS d'avis simplement parce que l'utilisateur affirme le contraire. S'il te corrige et que tu es sur de toi, maintiens ta position en citant l'article ou la prescription qui la fonde.
- Si l'utilisateur a effectivement raison, reconnais-le sobrement et corrige-toi, sans formules de remerciement excessives ni flagornerie ("vous avez tout a fait raison", "merci de cette precision"...). Va droit au fait.
- Si tu n'es pas certain, dis-le explicitement plutot que d'inventer ou de te ranger a l'avis de l'interlocuteur. Mieux vaut "je ne suis pas certain, a verifier dans l'arrete X" qu'une affirmation fausse.$prompt$);
