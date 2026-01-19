# Batipro Concept - Documentation Projet

## 🎯 Vision Globale

**Batipro Concept** est un portail d'outils digitaux pour professionnels du bâtiment. L'objectif est de créer une suite d'outils web interconnectés pour faciliter le travail terrain des commerciaux et techniciens.

## 📦 Architecture Générale

### Structure du Projet

```
Batipro/
├── web-app/                    # Application web principale (Vite + TypeScript)
│   ├── index.html             # Page d'accueil portail Batipro Concept
│   ├── map.html               # Batipro Map (outil PLU/RNU)
│   ├── articles.html          # Articles Chantier (génération articles IA)
│   ├── src/
│   │   ├── main.ts            # Point d'entrée Batipro Map
│   │   ├── map.ts             # Carte Leaflet
│   │   ├── cadastre.ts        # API Cadastre IGN
│   │   ├── search.ts          # Recherche adresse
│   │   ├── interactions.ts    # Appui long, pin drop
│   │   ├── geolocation.ts     # Bouton "Ma position" GPS
│   │   ├── api.ts             # Client n8n webhook
│   │   ├── database.ts        # Client Supabase
│   │   ├── resultsCard.ts     # UI résultats
│   │   ├── articles/          # Module Articles Chantier
│   │   │   ├── main.ts        # Logique principale
│   │   │   ├── api.ts         # Client n8n article webhook
│   │   │   ├── database.ts    # CRUD Supabase drafts
│   │   │   ├── config.ts      # Configuration webhook
│   │   │   └── styles.css     # Styles articles
│   │   └── styles/
│   │       ├── home.css       # Styles page d'accueil
│   │       └── main.css       # Styles Batipro Map
│   ├── n8n-workflows/         # JSON workflows n8n
│   │   └── app-articles.json  # Workflow génération articles
│   ├── package.json
│   ├── vite.config.ts         # Config multi-page (3 pages)
│   └── vercel.json            # Config déploiement
├── .mcp.json                   # Config n8n-mcp (Claude Code)
├── _bmad/                      # Système bmad (agents, workflows)
└── docs/                       # Documentation
```

## 🗺️ Outil 1: Batipro Map

### Description

Application de consultation PLU/RNU avec carte interactive pour commerciaux terrain.

### Stack Technique

- **Frontend:** TypeScript + Vite + Leaflet
- **Backend:** n8n workflow avec IA (Perplexity + Google Gemini)
- **Base de données:** Supabase (PostgreSQL)
- **APIs:** IGN Cadastre + API Adresse data.gouv.fr
- **Déploiement:** Vercel

### Fonctionnalités

✅ **Phase 1 - Complétée:**
- Carte interactive avec vue satellite IGN
- Parcelles cadastrales en overlay
- Recherche d'adresse (Besançon)
- Appui long → pin drop → analyse PLU/RNU
- Intégration backend n8n avec IA
- Card résultats avec infos parcelle et analyse urbanistique
- Design mobile-first responsive
- Sauvegarde analyses dans Supabase
- Liste des pins sauvegardés
- Partage par email/SMS/copie
- Mode maintenance configurable

✅ **Phase 2 - Complétée (19/01/2026):**
- Bouton "Ma position" GPS
- Géolocalisation avec fallback WiFi/IP pour desktop
- Marker bleu position utilisateur
- Auto-centrage sur position

### Workflow n8n Backend

#### Endpoint Webhook
```
POST https://n8n.batiproconcept.fr/webhook/batipro-analyse-plu
```

#### Architecture du Workflow

```
1. Webhook Web
   ↓
2. Extract Coordinates (latitude, longitude)
   ↓
3. IGN Parcelle (API Cadastre)
   ↓
4. IGN Zone Urba (API GPU)
   ↓
5. Build Parcel Info
   ↓
6. Est-ce RNU ? (Conditional)
   ├─ OUI → Perplexity RNU (Analyse RNU via Perplexity AI)
   └─ NON → HTTP Request (Download PDF) → Analyze document (Google Gemini 3 Flash)
   ↓
7. Merge (Fusion des résultats)
   ↓
8. Format Response JSON (Normalisation)
   ↓
9. Respond to Webhook
```

### Base de Données Supabase

#### Table: `analyses_plu`

```sql
CREATE TABLE analyses_plu (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  parcelle_commune VARCHAR(255) NOT NULL,
  parcelle_section VARCHAR(10) NOT NULL,
  parcelle_numero VARCHAR(10) NOT NULL,
  parcelle_surface INTEGER NOT NULL,
  parcelle_url_geoportail TEXT NOT NULL,
  zonage_type VARCHAR(10) NOT NULL,
  zonage_libelle VARCHAR(255) NOT NULL,
  zonage_url_document TEXT,
  analyse_texte TEXT NOT NULL,
  analyse_source VARCHAR(100) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 📝 Outil 2: Articles Chantier

### Description

Application de génération d'articles de blog à partir de photos de chantier. L'IA analyse l'image et génère un article professionnel pour le site Batipro Concept.

### Stack Technique

- **Frontend:** TypeScript + Vite + Quill.js (éditeur WYSIWYG)
- **Backend:** n8n workflow avec Google Gemini
- **Base de données:** Supabase (table `article_drafts`)
- **Publication:** WordPress REST API
- **Déploiement:** Vercel

### Fonctionnalités

✅ **Complétées (19/01/2026):**
- Upload photo (drag & drop ou sélection)
- Champ description chantier
- Envoi à n8n pour génération IA
- Éditeur WYSIWYG (Quill.js) - pas de HTML brut
- Sauvegarde brouillons dans Supabase
- Liste des brouillons avec aperçu
- Édition/suppression brouillons
- Interface de publication WordPress (simulée pour POC)

### Workflow n8n Backend

#### Endpoint Webhook
```
POST https://n8n.batiproconcept.fr/webhook/batipro-article-generator
```

#### Architecture du Workflow

```
1. Webhook (POST photo base64 + description)
   ↓
2. Convert Base64 to Binary (Code node)
   ↓
3. WP - Upload Image (HTTP Request → WordPress Media)
   ↓
4. Message a model (Google Gemini 3 Pro)
   ↓
5. Parse Response (Code node - extraction JSON)
   ↓
6. Respond Success (JSON response)
```

#### Input Webhook
```json
{
  "photo": "base64_encoded_image",
  "description": "Description du chantier par le technicien"
}
```

#### Output Response
```json
{
  "success": true,
  "title": "Titre de l'article généré",
  "content": "<h2>...</h2><p>...</p>...",
  "image_url": "https://www.batiproconcept.fr/wp-content/uploads/...",
  "wp_media_id": 12345
}
```

### Base de Données Supabase

#### Table: `article_drafts`

```sql
CREATE TABLE article_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  wp_media_id INTEGER,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  wp_post_id INTEGER,
  wp_post_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Configuration

**config.ts:**
```typescript
// Mode TEST - à changer en /webhook/ pour la production
export const N8N_ARTICLE_WEBHOOK = 'https://n8n.batiproconcept.fr/webhook-test/batipro-article-generator';
export const WP_API_URL = 'https://www.batiproconcept.fr/wp-json/wp/v2';
export const WP_CATEGORY_TERRAIN = 7;
```

---

## 🔧 Configuration Claude Code

### n8n-mcp (Model Context Protocol)

Fichier `.mcp.json` à la racine du projet (ignoré par git) :

```json
{
  "mcpServers": {
    "n8n-mcp": {
      "command": "npx",
      "args": ["-y", "n8n-mcp"],
      "env": {
        "MCP_MODE": "stdio",
        "N8N_API_URL": "https://n8n.batiproconcept.fr/api/v1",
        "N8N_API_KEY": "..."
      }
    }
  }
}
```

**Fonctionnalités :**
- Créer/modifier workflows n8n depuis Claude Code
- Accès documentation 1084 nodes n8n
- Gestion workflows via API

**Installation skills :**
```
/plugin install czlonkowski/n8n-skills
```

---

## 🚀 Déploiement

### Local
```bash
npm run dev      # Dev server (http://localhost:5173)
npm run build    # Build production
npm run preview  # Preview build
```

### Production (Vercel)
```bash
git add . && git commit -m "..." && git push  # Auto-deploy via Vercel
```

### URLs
- **Production:** https://batipro-web.vercel.app
- **Batipro Map:** https://batipro-web.vercel.app/map.html
- **Articles Chantier:** https://batipro-web.vercel.app/articles.html
- **n8n Backend:** https://n8n.batiproconcept.fr

---

## 📝 Changelog

### 2026-01-19
- ✅ Ajout bouton "Ma position" GPS sur Batipro Map
- ✅ Fallback géolocalisation WiFi/IP pour desktop
- ✅ Création outil Articles Chantier complet
- ✅ Upload photo + description → génération IA
- ✅ Workflow n8n avec Google Gemini
- ✅ Éditeur WYSIWYG Quill.js (plus de HTML brut)
- ✅ Sauvegarde brouillons Supabase
- ✅ Configuration n8n-mcp pour Claude Code
- ✅ Ajout `.mcp.json` au `.gitignore`

### 2026-01-15
- ✅ Création page d'accueil portail Batipro Concept
- ✅ Déplacement Batipro Map vers `/map.html`
- ✅ Design responsive avec gradient violet
- ✅ Bouton retour à l'accueil sur page map
- ✅ Configuration multi-page Vite
- ✅ Documentation bmad mise à jour

### 2026-01-14
- ✅ Partage analyses par email/SMS
- ✅ Fix limite caractères partage
- ✅ Amélioration UI

### 2026-01-13
- ✅ Intégration Supabase
- ✅ Liste pins sauvegardés
- ✅ Mode maintenance

---

## 🔮 Prochaines Étapes

### Articles Chantier
- [ ] Publication réelle vers WordPress (pas simulée)
- [ ] Envoi image à Gemini pour analyse visuelle
- [ ] Choix de catégorie article
- [ ] Preview avant publication

### Batipro Map
- [ ] Support multi-communes (au-delà de Besançon)
- [ ] Export PDF des analyses
- [ ] Historique des recherches
- [ ] Mode hors-ligne (PWA)
- [ ] Mesure de distances (à discuter)

### Outil 3 (À définir)
- À concevoir selon besoins terrain
- Intégration au portail Batipro Concept

---

## 📞 Contact

**Projet:** Batipro Concept
**Version:** 2.0.0
**Date:** 19 Janvier 2026
