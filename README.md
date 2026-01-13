# Bâti Pro - Application Web Interactive

Application de consultation PLU/RNU avec carte interactive pour commerciaux terrain.

## Stack Technique

- **Frontend:** TypeScript + Vite + Leaflet
- **Backend:** n8n workflow avec Perplexity AI
- **APIs:** IGN Cadastre + API Adresse data.gouv.fr

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

## Fonctionnalités Phase 1

✅ Carte interactive avec vue satellite IGN
✅ Parcelles cadastrales en overlay
✅ Recherche d'adresse (Besançon)
✅ Appui long → pin drop → analyse PLU/RNU
✅ Intégration backend n8n avec Perplexity AI
✅ Card résultats avec infos parcelle et analyse urbanistique
✅ Design mobile-first responsive

## Usage

1. Ouvrir l'application sur mobile ou desktop
2. Rechercher une adresse ou zoomer sur Besançon
3. Effectuer un appui long (mobile) ou clic droit (desktop) sur une parcelle
4. Attendre l'analyse IA (20-30s)
5. Consulter les résultats PLU/RNU dans la card

## Architecture

```
web-app/
├── src/
│   ├── main.ts           # Point d'entrée
│   ├── map.ts            # Carte Leaflet
│   ├── cadastre.ts       # API Cadastre IGN
│   ├── search.ts         # Recherche adresse
│   ├── interactions.ts   # Appui long, pin drop
│   ├── api.ts            # Client n8n webhook
│   ├── resultsCard.ts    # UI résultats
│   ├── types.ts          # Types TypeScript
│   └── styles/
│       └── main.css      # Styles mobile-first
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
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
      "url_geoportail": "https://..."
    },
    "zonage": {
      "type": "PLU",
      "libelle": "Zone Ub",
      "url_document": "https://..."
    },
    "analyse": {
      "texte": "Analyse urbanistique...",
      "source": "Perplexity AI"
    },
    "timestamp": "2026-01-13T..."
  }
}
```

## Support

Commercial Bâti Pro: Outil de vente terrain - effet waouh instantané devant client.
