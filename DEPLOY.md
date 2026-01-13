# Guide de Déploiement - Bâti Pro Web

## Méthode 1: Netlify Drop (La Plus Rapide)

1. Buildez l'application:
   ```bash
   npm run build
   ```

2. Allez sur https://app.netlify.com/drop

3. Glissez-déposez le dossier `dist/` sur la page

4. Netlify génère automatiquement une URL HTTPS

**Avantages:**
- Déploiement instantané (10-20s)
- HTTPS gratuit
- CDN global
- Aucune configuration requise

## Méthode 2: Vercel Dashboard (Recommandé pour production)

1. Créez un compte sur https://vercel.com

2. Poussez votre code sur GitHub/GitLab:
   ```bash
   cd /Users/thibaut/Batipro/web-app
   git init
   git add .
   git commit -m "Initial commit - Bâti Pro Web App"
   git remote add origin <votre-repo-url>
   git push -u origin main
   ```

3. Sur Vercel Dashboard:
   - Cliquez "Add New Project"
   - Sélectionnez votre repo GitHub
   - Vercel détecte automatiquement Vite
   - Cliquez "Deploy"

4. Vercel génère une URL de production

**Avantages:**
- Déploiement automatique à chaque push
- Preview deployments pour chaque PR
- Domaine personnalisé gratuit
- Analytics intégrés

## Méthode 3: Vercel CLI

1. Installez Vercel CLI:
   ```bash
   npm install -g vercel
   ```

2. Déployez:
   ```bash
   cd /Users/thibaut/Batipro/web-app
   vercel
   ```

3. Suivez les instructions interactives

4. Pour déployer en production:
   ```bash
   vercel --prod
   ```

## Configuration Domaine Personnalisé

### Sur Vercel:
1. Allez dans Settings > Domains
2. Ajoutez votre domaine (ex: batipro.fr)
3. Configurez les DNS selon les instructions

### Sur Netlify:
1. Allez dans Site Settings > Domain Management
2. Ajoutez votre domaine personnalisé
3. Configurez les DNS

## Variables d'Environnement

Si vous ajoutez des clés API secrètes plus tard:

**Vercel:**
```bash
vercel env add VITE_API_KEY
```

**Netlify:**
Site Settings > Environment Variables

## Monitoring

### Vercel:
- Analytics: https://vercel.com/dashboard/analytics
- Logs: https://vercel.com/dashboard/deployments

### Netlify:
- Analytics: Site Settings > Analytics
- Deploy logs: Deploys > Deploy log

## URLs de Test

Après déploiement, testez:
- ✅ Carte s'affiche correctement
- ✅ Recherche d'adresse fonctionne
- ✅ Parcelles cadastrales apparaissent (zoom > 14)
- ✅ Appui long → pin → analyse PLU/RNU
- ✅ Card résultats affiche les données

## Performance

Vérifiez les performances avec:
- Lighthouse (DevTools > Lighthouse)
- https://pagespeed.web.dev/

Objectifs:
- Performance: > 90
- Accessibility: > 90
- Best Practices: > 90
- SEO: > 90

## Support

En cas de problème:
1. Vérifiez les logs de déploiement
2. Testez le build local: `npm run build && npm run preview`
3. Vérifiez que l'API n8n est accessible (CORS)
