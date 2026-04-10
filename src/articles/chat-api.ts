// Wrapper TypeScript pour l'edge function chat-article.
// Gère la conversation entre le frontend et Gemini, avec contexte chantier.

import { getAuthClient } from '../auth/client';
import { SUPABASE_URL } from '../config';

const ENDPOINT = `${SUPABASE_URL}/functions/v1/chat-article`;

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
