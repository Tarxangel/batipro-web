# Outils ICPE - Batipro

Outils de consultation et simulation ICPE (Installations Classées pour la Protection de l'Environnement) pour les professionnels du BTP.

## Fonctionnalités

### 1. Carte ICPE (`index.html`)
- Carte interactive avec recherche par coordonnées
- Affichage des ICPE à proximité (API Géorisques)
- Sites et sols pollués (CASIAS, BASOL, SIS)
- Liens vers les fiches Géorisques

### 2. Simulateur ICPE (`simulateur-icpe.html`)
- Identification des rubriques ICPE applicables
- Détermination du régime (Déclaration, Enregistrement, Autorisation)
- Liens vers les fiches AIDA INERIS
- Analyse par IA (Gemini)

### 3. Simulateur ICPE Pro (`simulateur-icpe-v2.html`)
- Formulaire détaillé du projet
- Tableau des prescriptions techniques
- Export PDF / Excel / CSV
- Documents de référence AIDA

## Déploiement

### Vercel / Netlify
Déployer directement depuis GitHub - ce sont des fichiers HTML statiques.

### Configuration
Pour la production, configurer la clé API Gemini via un proxy backend (n8n recommandé).

## APIs utilisées

- **Géorisques** : https://georisques.gouv.fr/api
- **AIDA INERIS** : https://aida.ineris.fr
- **Google Gemini** : Pour l'analyse IA

## Licence

Projet privé - Batipro
