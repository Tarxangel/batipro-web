// Module API pour n8n

import { N8N_ARTICLE_WEBHOOK, N8N_PUBLISH_WEBHOOK } from './config';

// Types
export interface GenerateArticleRequest {
  photo: string; // Base64
  description: string;
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

export interface PublishArticleRequest {
  title: string;
  content: string;
  wp_media_id: number;
  categories?: number[];
}

export interface PublishArticleResponse {
  id: number;
  link: string;
  slug: string;
}

// Callbacks pour le suivi de progression
export interface ProgressCallbacks {
  onUploadStart?: () => void;
  onUploadComplete?: () => void;
  onAIStart?: () => void;
  onAIComplete?: () => void;
  onError?: (error: string) => void;
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

// Appeler n8n pour générer l'article
export async function generateArticle(
  request: GenerateArticleRequest,
  callbacks?: ProgressCallbacks
): Promise<GenerateArticleResponse> {
  try {
    // Étape 1: Upload
    callbacks?.onUploadStart?.();

    const response = await fetch(N8N_ARTICLE_WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        photo: request.photo,
        description: request.description
      })
    });

    callbacks?.onUploadComplete?.();

    // Étape 2: Attente IA (le webhook fait tout côté serveur)
    callbacks?.onAIStart?.();

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erreur serveur: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    callbacks?.onAIComplete?.();

    if (!data.success) {
      throw new Error(data.error || 'Erreur lors de la génération');
    }

    return data;

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur inconnue';
    callbacks?.onError?.(message);
    throw error;
  }
}

// Publier un article via n8n (met à jour le contenu et passe en publié)
export async function publishArticle(
  wpPostId: number,
  title: string,
  content: string
): Promise<PublishArticleResponse> {
  const response = await fetch(N8N_PUBLISH_WEBHOOK, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      wp_post_id: wpPostId,
      title: title,
      content: content
    })
  });

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
