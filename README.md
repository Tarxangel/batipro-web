# Batipro Concept - Portail d'Outils Digitaux

Portail d'outils digitaux pour professionnels du bâtiment.

## 🗺️ Outil Principal: Batipro Map

Application de consultation PLU/RNU avec carte interactive pour commerciaux terrain.

## Stack Technique

- **Frontend:** TypeScript + Vite + Leaflet
- **Backend:** n8n workflow avec IA (Perplexity + Google Gemini 3 Flash)
- **Base de données:** Supabase (PostgreSQL)
- **APIs:** IGN Cadastre + API Adresse data.gouv.fr
- **Déploiement:** Vercel

## Développement Local

```bash
# Installer dépendances
npm install

# Lancer dev server (http://localhost:5173)
npm run dev

# Build production
npm run build

# Preview build
npm run preview
```

## Déploiement Vercel

```bash
# Installer Vercel CLI
npm install -g vercel

# Déployer
vercel

# Déployer en production
vercel --prod
```

## Fonctionnalités

### Page d'Accueil (index.html)
✅ Portail avec grille d'outils
✅ Design moderne avec gradient violet
✅ Cards cliquables avec animations
✅ Placeholder pour futurs outils
✅ Responsive mobile/desktop

### Batipro Map (map.html)
✅ Carte interactive avec vue satellite IGN
✅ Parcelles cadastrales en overlay
✅ Recherche d'adresse (Besançon)
✅ Appui long → pin drop → analyse PLU/RNU
✅ Backend n8n avec IA (Perplexity RNU + Gemini PLU)
✅ Card résultats avec analyse urbanistique
✅ Sauvegarde analyses dans Supabase
✅ Liste des pins sauvegardés
✅ Partage par email/SMS/copie
✅ Mode maintenance configurable
✅ Bouton retour à l'accueil
✅ Design mobile-first responsive

## Usage

### Page d'Accueil
1. Accéder à https://batipro-web.vercel.app
2. Voir la grille d'outils disponibles
3. Cliquer sur "Batipro Map" pour accéder à l'outil PLU/RNU

### Batipro Map
1. Sur la carte, rechercher une adresse ou zoomer sur Besançon
2. Effectuer un appui long (mobile) ou clic droit (desktop) sur une parcelle
3. Attendre l'analyse IA (20-30s)
4. Consulter les résultats PLU/RNU dans la card
5. Optionnel: Sauvegarder, partager ou revenir à l'accueil

## Architecture

```
web-app/
├── index.html            # Page d'accueil portail
├── map.html              # Batipro Map
├── src/
│   ├── main.ts           # Point d'entrée Batipro Map
│   ├── map.ts            # Carte Leaflet
│   ├── cadastre.ts       # API Cadastre IGN
│   ├── search.ts         # Recherche adresse
│   ├── interactions.ts   # Appui long, pin drop
│   ├── api.ts            # Client n8n webhook
│   ├── database.ts       # Client Supabase
│   ├── resultsCard.ts    # UI résultats
│   ├── config.ts         # Configuration
│   └── styles/
│       ├── home.css      # Styles page d'accueil
│       └── main.css      # Styles Batipro Map
├── package.json
├── tsconfig.json
├── vite.config.ts        # Config multi-page
└── vercel.json
```

## API n8n Webhook

**Endpoint:** https://n8n.batiproconcept.fr/webhook/batipro-analyse-plu

**Request:**
```json
{
  "latitude": 47.2380,
  "longitude": 6.0243
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "parcelle": {
      "commune": "Besançon",
      "section": "AB",
      "numero": "123",
      "surface": 500,
      "url_geoportail": "https://...",
      "coordonnees": {
        "lat": 47.2380,
        "long": 6.0243
      }
    },
    "zonage": {
      "type": "PLU" | "RNU",
      "code": "UB",
      "libelle": "Zone Ub",
      "url_document": "https://..." | null
    },
    "analyse": {
      "texte": "Analyse urbanistique...",
      "source": "Google Gemini 3 Flash Preview" | "Perplexity AI (RNU)"
    },
    "timestamp": "2026-01-15T..."
  }
}
```

### Workflow Backend n8n

Le workflow analyse les coordonnées GPS et retourne:
- **RNU (pas de PLU):** Analyse via Perplexity AI des règles du Code de l'Urbanisme
- **PLU (zonage trouvé):** Téléchargement du PDF réglementaire + analyse via Google Gemini 3 Flash

Voir la documentation détaillée dans `_bmad/_memory/batipro-web/project-overview.md`

## Support

Commercial Bâti Pro: Outil de vente terrain - effet waouh instantané devant client.
