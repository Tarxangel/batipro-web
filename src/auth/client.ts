// Client Supabase partagé pour l'authentification.
//
// Singleton avec persistance de session activée (localStorage),
// utilisé par toutes les pages qui ont besoin de connaître
// l'identité de l'utilisateur courant.

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';

let client: SupabaseClient | null = null;

export function getAuthClient(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: 'batipro_auth',
      }
    });
  }
  return client;
}
