# Point d'optimisation — carte et application (20/11/2026)

Audit fait en lecture seule sur le code tel qu'il tourne en prod, avec des mesures prises sur la prod (bundles, base, API). Les **gains** sont mesurés. Les points marqués *(supposé)* sont déduits du code et pas encore reproduits.

## Déjà fait le 20/11 (en prod)

- **Carte allégée** : le PDF et l'Excel ne se chargent plus qu'au clic. Le bundle de la carte passe de **887 kB à 203 kB** (de 291 à 65 kB gzip).
- **`xlsx` retiré** : la librairie avait des failles connues et ne savait pas écrire la mise en forme. Elle est remplacée par `exceljs`, chargé à la demande.
- **Clé Gemini exposée retirée** : `public/icpe-config.js` (une ancienne clé, toujours active) n'est plus servi, l'URL renvoie 404. **Il reste à révoquer cette clé côté Google.**
- **Notification des tickets SAV** : l'envoi survit maintenant à la fermeture de la page (`keepalive`).
- **Simulateur ICPE** : les réponses de l'IA mal imbriquées sont remises en ordre côté serveur. Avant, une partie des thèmes s'affichait « - ».

## P0 — Sécurité (à traiter en premier)

1. **`analyses_plu` est ouverte à tous.** Les policies `USING (true)` laissent n'importe qui lire, ajouter ou **supprimer** toutes les analyses avec la clé anon, qui figure dans le JS. `map.html` ne demande pas de connexion (`src/main.ts` n'a aucun `requirePermission`), et le dépôt GitHub est public.
   - **Correctif** : passer `database.ts` sur `getAuthClient()`, réserver les policies aux utilisateurs connectés avec la permission `map`, et ajouter le garde `map` sur la page.
   - Effort M. **Test utilisateur nécessaire** : 7 comptes sur 14 ont la permission `map`.
2. **Échapper les données affichées en `innerHTML`.** C'est le cas de `savedPins.ts:61`, `ui/pinsList.ts:92`, `resultsCard.ts` (texte IA, liens) et `search.ts:80`. Il n'y a aucune balise HTML en base, donc échapper ne changera pas l'affichage. Le risque est lié au point 1 : une ligne piégée s'exécuterait dans la session d'un admin. Il existe aujourd'hui cinq fonctions d'échappement en double.

## P1 — Gros gain, faible risque (faisable sans test utilisateur)

3. **Cadastre** (`main.ts:108`, `cadastre.ts`) :
   - `zoomend` et `moveend` se déclenchent tous les deux à chaque zoom, ce qui fait 2 requêtes WFS identiques (0,5 à 0,8 MB chacune).
   - Il n'y a ni délai d'attente, ni annulation, ni dédoublonnage, et les polygones s'empilent.
   - **Correctif** : écouter `moveend` seul, attendre 300 ms, ajouter `AbortController`, filtrer par identifiant de parcelle, et passer en `L.canvas()`.
4. **Démarrage de la carte** : l'interface attend `testDatabaseConnection` (inutile) puis le chargement de toutes les analyses avant de brancher la recherche et le clic. Il faut brancher l'interface d'abord et charger les épingles en fond.
5. **Liste des analyses trop lourde** : `select('*')` pèse **327 kB gzip** pour 140 analyses, alors que les colonnes de la liste seules font **8,9 kB**. On charge le détail au clic, et le tableau détaillé est déjà relu depuis la base par `analyze-plu-detailed`.
6. **Page Articles** : `heic2any` (1,33 MB) est importé dès le chargement alors qu'il ne sert qu'aux photos HEIC. En l'important à la demande, la page passerait d'environ 1,4 MB à environ 70 kB. Par ailleurs, 3 brouillons gardent leur image en base64 en base (1,8 MB à chaque ouverture de la liste).
7. **53 `console.log` en prod**, dont la réponse IA complète dans `api.ts:149`. Il suffit de purger `log`, `info` et `debug` au build (`esbuild.pure`) en gardant `warn` et `error`.
8. **Délais d'attente** : l'appel d'analyse (`api.ts:112`, `:136`) peut tourner sans fin. La recherche d'adresse (`search.ts:65`) ne vérifie pas `response.ok` et n'annule pas les recherches précédentes.

## P2 — À tester

9. Un second clic droit pendant une analyse (20-30 s) relance Gemini. Le double-clic zoome et analyse en même temps. L'épingle sauvegardée peut disparaître au clic long suivant *(supposé)*.
10. Couches WMS Zonage et RNU affichées d'office : elles représentent les 2/3 des tuiles. En `png8`, une tuile pèse **56 % de moins** ; autre piste, des tuiles de 512 px.
11. À z14-15, le serveur de cadastre coupe à 5 000 parcelles, donc l'affichage en ville est incomplet. Il faut paginer, ou afficher « zoomez ».

## P3 — Hygiène

12. `npm audit` signale une faille critique sur **jspdf ≤ 4.2.0**. La version 4 casse l'API, il faut donc la migrer avec des tests (les exports sont maintenant regroupés dans `src/exports/styledTable.ts`).
13. Les sourcemaps sont publiques (3,4 MB pour la carte). Les passer en `'hidden'`.
14. ICPE :
    - `/icpe/config.js` est appelé mais renvoie 404 (script mort) ;
    - la clé anon est recopiée en dur dans `icpe/simulateur.html` ;
    - Leaflet et Quill viennent de CDN sans vérification d'intégrité (SRI).
15. **Tickets SAV** : ajouter un filet de sécurité, par exemple les tickets `new` de plus de 48 h dans le récap quotidien Batipro-Mails, pour qu'un ticket ne puisse plus passer inaperçu.
