// Configuration pour le module Articles

import { SUPABASE_URL } from '../config';

// URL du proxy Supabase pour appeler n8n (contourne CORS)
export const N8N_ARTICLE_WEBHOOK = `${SUPABASE_URL}/functions/v1/n8n-proxy`;
// Publication directe via l'API REST WordPress (Edge Function wp-publish, sans n8n)
export const PUBLISH_WEBHOOK = `${SUPABASE_URL}/functions/v1/wp-publish`;
export const SUMMARIZE_HISTORY_URL = `${SUPABASE_URL}/functions/v1/summarize-history`;
export const NOTIFY_REVIEW_URL = `${SUPABASE_URL}/functions/v1/notify-review`;
export const LINKEDIN_POST_URL = `${SUPABASE_URL}/functions/v1/generate-linkedin-post`;
export const LINKEDIN_URL = `${SUPABASE_URL}/functions/v1/linkedin`;

// Site WordPress de prod. Sert de repli pour construire le shortlink `?p=<id>`
// quand WordPress ne renvoie pas de permalien exploitable.
export const WP_SITE_URL = 'https://www.batiproconcept.fr';

// Limites
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
export const MAX_IMAGE_DIMENSION = 1920; // px
export const IMAGE_COMPRESSION_QUALITY = 0.8;
export const GENERATE_TIMEOUT = 120000; // 2 min
export const PUBLISH_TIMEOUT = 30000; // 30s
