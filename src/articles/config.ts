// Configuration pour le module Articles

// URL du proxy Supabase pour appeler n8n (contourne CORS)
// Génération d'article: relaye vers https://n8n.batiproconcept.fr/webhook/batipro-article-generator
export const N8N_ARTICLE_WEBHOOK = 'https://awhbjbuxbcxszlxcbpjb.supabase.co/functions/v1/n8n-proxy';

// Publication d'article: relaye vers https://n8n.batiproconcept.fr/webhook/batipro-article-publish
export const N8N_PUBLISH_WEBHOOK = 'https://awhbjbuxbcxszlxcbpjb.supabase.co/functions/v1/smart-endpoint';

// Admin login Edge Function
export const ADMIN_LOGIN_URL = 'https://awhbjbuxbcxszlxcbpjb.supabase.co/functions/v1/admin-login';

// Résumé historique chantier Edge Function
export const SUMMARIZE_HISTORY_URL = 'https://awhbjbuxbcxszlxcbpjb.supabase.co/functions/v1/summarize-history';

// Notification soumission article Edge Function
export const NOTIFY_REVIEW_URL = 'https://awhbjbuxbcxszlxcbpjb.supabase.co/functions/v1/notify-review';

// Génération post LinkedIn Edge Function
export const LINKEDIN_POST_URL = 'https://awhbjbuxbcxszlxcbpjb.supabase.co/functions/v1/generate-linkedin-post';

// Configuration WordPress (pour référence uniquement)
export const WP_SITE_URL = 'https://www.thibautlab.fr';

// Limites
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
export const MAX_IMAGE_DIMENSION = 1920; // px
export const IMAGE_COMPRESSION_QUALITY = 0.8;
export const GENERATE_TIMEOUT = 120000; // 2 min
export const PUBLISH_TIMEOUT = 30000; // 30s
