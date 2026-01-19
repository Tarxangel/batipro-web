// Configuration pour le module Articles

// URL du proxy Supabase pour appeler n8n (contourne CORS)
// Génération d'article: relaye vers https://n8n.batiproconcept.fr/webhook/batipro-article-generator
export const N8N_ARTICLE_WEBHOOK = 'https://awhbjbuxbcxszlxcbpjb.supabase.co/functions/v1/n8n-proxy';

// Publication d'article: relaye vers https://n8n.batiproconcept.fr/webhook/batipro-article-publish
export const N8N_PUBLISH_WEBHOOK = 'https://awhbjbuxbcxszlxcbpjb.supabase.co/functions/v1/smart-endpoint';

// Configuration WordPress (pour référence uniquement)
export const WP_SITE_URL = 'https://www.thibautlab.fr';
