// Wrapper TypeScript pour l'edge function chat-article.
// Gère la conversation entre le frontend et Gemini, avec contexte chantier.

import { getAuthClient } from '../auth/client';
import { SUPABASE_URL } from '../config';

const ENDPOINT = `${SUPABASE_URL}/functions/v1/chat-article`;
const CREATE_WP_DRAFT_ENDPOINT = `${SUPABASE_URL}/functions/v1/create-wp-draft`;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatDraft {
  title: string;
  content_html: string;
}

export interface ChatResponse {
  message: string;
  draft: ChatDraft | null;
}

export interface SendChatPayload {
  chantier_id: string;
  photo_base64?: string;
  mime_type?: string;
  messages: ChatMessage[];
  // 'chat' (défaut) → modèle flash, conversation/questions
  // 'draft' → modèle pro, force la rédaction d'un brouillon complet
  mode?: 'chat' | 'draft';
}

export async function sendChat(payload: SendChatPayload): Promise<ChatResponse> {
  const supabase = getAuthClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Session expirée — veuillez vous reconnecter');

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) {
    throw new Error(json.error || `Erreur HTTP ${response.status}`);
  }
  return json as ChatResponse;
}

// ── Création du brouillon WordPress depuis un draft chat ──
//
// Appelle l'Edge Function create-wp-draft qui upload la photo sur WordPress
// et crée un post status=draft. Renvoie les IDs nécessaires pour la
// publication ultérieure.

export interface CreateWpDraftPayload {
  photo_base64: string;
  mime_type?: string;
  title: string;
  content_html: string;
}

export interface CreateWpDraftResponse {
  wp_post_id: number;
  wp_media_id: number;
  image_url: string;
  edit_url: string;
}

export async function createWpDraft(payload: CreateWpDraftPayload): Promise<CreateWpDraftResponse> {
  const supabase = getAuthClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Session expirée — veuillez vous reconnecter');

  const response = await fetch(CREATE_WP_DRAFT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => ({ success: false, error: `HTTP ${response.status}` }));
  if (!response.ok || !json.success) {
    throw new Error(json.error || `Erreur HTTP ${response.status}`);
  }
  return {
    wp_post_id: json.wp_post_id,
    wp_media_id: json.wp_media_id,
    image_url: json.image_url,
    edit_url: json.edit_url,
  };
}
