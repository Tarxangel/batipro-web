// Module API pour n8n

import heic2any from 'heic2any';
import { N8N_ARTICLE_WEBHOOK, N8N_PUBLISH_WEBHOOK, SUMMARIZE_HISTORY_URL, LINKEDIN_POST_URL, LINKEDIN_URL, NOTIFY_REVIEW_URL, GENERATE_TIMEOUT, PUBLISH_TIMEOUT, MAX_IMAGE_DIMENSION, IMAGE_COMPRESSION_QUALITY } from './config';
import { SUPABASE_ANON_KEY } from '../config';
import { getAuthClient } from '../auth/client';

// ── Publication directe LinkedIn (Edge Function linkedin) ──
async function linkedinCall(payload: Record<string, unknown>): Promise<any> {
  const supabase = getAuthClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Session expirée');
  const response = await fetch(LINKEDIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => ({ success: false, error: `HTTP ${response.status}` }));
  if (!response.ok || !json.success) throw new Error(json.error || `Erreur HTTP ${response.status}`);
  return json;
}

export async function linkedinStatus(): Promise<{ connected: boolean; name?: string; expired?: boolean }> {
  try {
    const r = await linkedinCall({ action: 'status' });
    return { connected: !!r.connected, name: r.name, expired: r.expired };
  } catch {
    return { connected: false };
  }
}

export async function linkedinStart(): Promise<string> {
  const r = await linkedinCall({ action: 'start' });
  return r.authorizeUrl as string;
}

export async function linkedinPublish(post: string, articleUrl: string): Promise<string> {
  const r = await linkedinCall({ action: 'publish', post, articleUrl });
  return r.url as string;
}

export async function linkedinDisconnect(): Promise<void> {
  await linkedinCall({ action: 'disconnect' });
}

// Types
export interface SeoContext {
  articleType: string;   // chantier, livraison, expertise, actualite
  projectType: string;   // construction, extension, renovation, restructuration
  sector: string;        // industriel, logistique, agroalimentaire, etc.
  city: string;
  department: string;    // code département
  surface: string;       // m²
  keywords: string;      // mots-clés séparés par virgules
}

export interface GenerateArticleRequest {
  photo: string; // Base64
  description: string;
  seo: SeoContext;
  history?: string; // Résumé de l'historique du chantier
}

export interface GenerateArticleResponse {
  success: boolean;
  title: string;
  content: string;
  image_url: string;
  wp_media_id: number;
  wp_post_id?: number;  // ID du brouillon WordPress créé
  wp_post_url?: string; // URL du brouillon
  error?: string;
}

export interface PublishArticleResponse {
  id: number;
  link: string;
  slug: string;
}

// Fetch avec timeout via AbortController
function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { ...options, signal: controller.signal })
    .catch((error) => {
      if (error.name === 'AbortError') {
        throw new Error(`Délai d'attente dépassé (${Math.round(timeoutMs / 1000)}s). Réessayez.`);
      }
      throw error;
    })
    .finally(() => clearTimeout(timeoutId));
}

// Vérifier si un fichier est au format HEIC/HEIF
function isHeicFile(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return type === 'image/heic' || type === 'image/heif' || name.endsWith('.heic') || name.endsWith('.heif');
}

// Convertir HEIC/HEIF en JPEG
export async function convertHeicToJpeg(file: File): Promise<File> {
  if (!isHeicFile(file)) return file;

  const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 }) as Blob;
  const jpegName = file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg');
  return new File([blob], jpegName, { type: 'image/jpeg' });
}

// Convertir un fichier en base64
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Enlever le préfixe data:image/...;base64,
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Compresser une image via canvas
export function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // Redimensionner si trop grand
      if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        const ratio = Math.min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Échec de la compression'));
            return;
          }
          const compressed = new File([blob], file.name, { type: 'image/jpeg' });
          resolve(compressed);
        },
        'image/jpeg',
        IMAGE_COMPRESSION_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Impossible de charger l\'image'));
    };

    img.src = url;
  });
}

// Appeler n8n pour générer l'article
export async function generateArticle(
  request: GenerateArticleRequest
): Promise<GenerateArticleResponse> {
  const response = await fetchWithTimeout(
    N8N_ARTICLE_WEBHOOK,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photo: request.photo,
        description: request.description,
        seo: request.seo,
        ...(request.history ? { history: request.history } : {})
      })
    },
    GENERATE_TIMEOUT
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erreur serveur: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Erreur lors de la génération');
  }

  return data;
}

// Publier un article via n8n (met à jour le contenu et passe en publié)
export async function publishArticle(
  wpPostId: number,
  title: string,
  content: string
): Promise<PublishArticleResponse> {
  const response = await fetchWithTimeout(
    N8N_PUBLISH_WEBHOOK,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wp_post_id: wpPostId,
        title: title,
        content: content
      })
    },
    PUBLISH_TIMEOUT
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erreur publication: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Erreur lors de la publication');
  }

  return {
    id: data.post_id,
    link: data.post_url,
    slug: ''
  };
}

// Générer un post LinkedIn pour un article publié via Edge Function
export async function generateLinkedInPost(title: string, content: string, articleUrl: string): Promise<string> {
  const response = await fetchWithTimeout(
    LINKEDIN_POST_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ title, content, articleUrl })
    },
    30000 // 30s timeout
  );

  if (!response.ok) {
    console.error('Erreur generate-linkedin-post:', response.status);
    return ''; // Fail silently
  }

  const data = await response.json();
  return data.post || '';
}

// Retravailler un post LinkedIn existant via une consigne IA
export async function reworkLinkedInPost(currentPost: string, instruction: string): Promise<string> {
  const response = await fetchWithTimeout(
    LINKEDIN_POST_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ currentPost, instruction }),
    },
    30000
  );
  if (!response.ok) return '';
  const data = await response.json();
  return data.post || '';
}

// Notifier l'admin qu'un article est soumis pour validation
export async function notifyReview(title: string, articleId: string): Promise<void> {
  try {
    await fetch(NOTIFY_REVIEW_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ title, articleId })
    });
  } catch (error) {
    console.error('Erreur notify-review:', error);
    // Fail silently — la soumission ne doit jamais échouer à cause de l'email
  }
}

// Résumer l'historique des articles d'un chantier via Edge Function
export async function summarizeHistory(descriptions: string[]): Promise<string> {
  const response = await fetchWithTimeout(
    SUMMARIZE_HISTORY_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ descriptions })
    },
    30000 // 30s timeout
  );

  if (!response.ok) {
    console.error('Erreur summarize-history:', response.status);
    return ''; // Fail silently - history is optional
  }

  const data = await response.json();
  return data.summary || '';
}
