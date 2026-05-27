// Wrapper TypeScript pour l'envoi et la lecture des tickets SAV.

import { getAuthClient } from '../auth/client';
import { getCurrentProfile } from '../auth/session';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';

const NOTIFY_FEEDBACK_URL = `${SUPABASE_URL}/functions/v1/notify-feedback`;

export interface FeedbackTicket {
  id: string;
  user_id: string | null;
  user_email: string;
  user_name: string | null;
  page: string;
  user_agent: string | null;
  message: string;
  status: 'new' | 'in_progress' | 'resolved';
  resolved_at: string | null;
  resolved_by: string | null;
  admin_notes: string | null;
  created_at: string;
}

// Soumet un nouveau ticket SAV à partir du contexte courant
// (page, user agent, profil utilisateur).
export async function submitFeedback(message: string): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) {
    throw new Error('Vous devez être connecté pour envoyer un retour');
  }

  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error('Le message ne peut pas être vide');
  }
  if (trimmed.length > 5000) {
    throw new Error('Message trop long (5000 caractères max)');
  }

  const page = window.location.pathname + window.location.search;

  const supabase = getAuthClient();
  const { error } = await supabase.from('feedback').insert({
    user_id: profile.id,
    user_email: profile.email,
    user_name: profile.full_name,
    page,
    user_agent: navigator.userAgent,
    message: trimmed,
    // status par défaut = 'new'
  });

  if (error) {
    throw new Error(error.message);
  }

  // Fire-and-forget: notif email à l'admin. Ne doit jamais casser l'insert.
  fetch(NOTIFY_FEEDBACK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      userEmail: profile.email,
      userName: profile.full_name,
      page,
      message: trimmed,
    }),
  }).catch(err => console.error('Erreur notify-feedback:', err));
}

// Liste les tickets visibles par l'utilisateur courant.
// Selon les RLS : un utilisateur lambda voit ses propres tickets ;
// un utilisateur avec feedback:read voit tous les tickets.
export async function listFeedback(filters?: {
  status?: 'new' | 'in_progress' | 'resolved';
}): Promise<FeedbackTicket[]> {
  const supabase = getAuthClient();
  let query = supabase
    .from('feedback')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}

// Met à jour le statut et/ou les notes d'un ticket.
// Requiert la permission feedback:resolve (vérifié par RLS).
export async function updateFeedback(
  id: string,
  updates: { status?: FeedbackTicket['status']; admin_notes?: string }
): Promise<void> {
  const supabase = getAuthClient();
  const { error } = await supabase.from('feedback').update(updates).eq('id', id);
  if (error) throw new Error(error.message);
}
