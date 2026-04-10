// CRUD pour les événements de chantier (table chantier_events)

import { getAuthClient } from '../auth/client';

export interface ChantierEvent {
  id: string;
  chantier_id: string;
  event_date: string;       // ISO date (YYYY-MM-DD)
  event_type: string | null;
  description: string;
  photo_url: string | null;
  created_at: string;
  created_by: string | null;
}

export type NewChantierEvent = Omit<ChantierEvent, 'id' | 'created_at' | 'created_by'>;

export async function listChantierEvents(chantierId: string): Promise<ChantierEvent[]> {
  const supabase = getAuthClient();
  const { data, error } = await supabase
    .from('chantier_events')
    .select('*')
    .eq('chantier_id', chantierId)
    .order('event_date', { ascending: false });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createChantierEvent(event: NewChantierEvent): Promise<ChantierEvent> {
  const supabase = getAuthClient();
  // Récupère l'utilisateur courant pour created_by
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('chantier_events')
    .insert({
      chantier_id: event.chantier_id,
      event_date: event.event_date,
      event_type: event.event_type,
      description: event.description,
      photo_url: event.photo_url,
      created_by: userData?.user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function updateChantierEvent(id: string, updates: Partial<NewChantierEvent>): Promise<ChantierEvent> {
  const supabase = getAuthClient();
  const { data, error } = await supabase
    .from('chantier_events')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteChantierEvent(id: string): Promise<void> {
  const supabase = getAuthClient();
  const { error } = await supabase
    .from('chantier_events')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
}
