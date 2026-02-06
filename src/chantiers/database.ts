// Module base de données pour les chantiers

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';

// Types
export interface Chantier {
  id: string;
  name: string;
  client_name: string | null;
  client_sector: string;
  project_type: string;
  address: string | null;
  city: string;
  department: string;
  surface: number | null;
  description: string | null;
  seo_keywords: string | null;
  status: 'active' | 'paused' | 'completed';
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export type NewChantier = Omit<Chantier, 'id' | 'created_at' | 'updated_at' | 'status'>;

// Client Supabase singleton
let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Configuration Supabase manquante');
    }
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseClient;
}

// Créer un chantier
export async function createChantier(chantier: NewChantier): Promise<Chantier> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('chantiers')
    .insert({
      name: chantier.name,
      client_name: chantier.client_name,
      client_sector: chantier.client_sector,
      project_type: chantier.project_type,
      address: chantier.address,
      city: chantier.city,
      department: chantier.department,
      surface: chantier.surface,
      description: chantier.description,
      seo_keywords: chantier.seo_keywords,
      start_date: chantier.start_date,
      end_date: chantier.end_date
    })
    .select()
    .single();

  if (error) {
    console.error('Erreur création chantier:', error);
    throw new Error(`Échec création chantier: ${error.message}`);
  }

  return data;
}

// Mettre à jour un chantier
export async function updateChantier(id: string, updates: Partial<Chantier>): Promise<Chantier> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('chantiers')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Erreur mise à jour chantier:', error);
    throw new Error(`Échec mise à jour: ${error.message}`);
  }

  return data;
}

// Récupérer tous les chantiers (avec filtre optionnel par statut)
export async function getChantiers(statusFilter?: string): Promise<Chantier[]> {
  const supabase = getSupabaseClient();

  let query = supabase
    .from('chantiers')
    .select('*')
    .order('updated_at', { ascending: false });

  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Erreur récupération chantiers:', error);
    throw new Error(`Échec récupération: ${error.message}`);
  }

  return data || [];
}

// Récupérer un chantier par ID
export async function getChantier(id: string): Promise<Chantier | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('chantiers')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('Erreur récupération chantier:', error);
    throw new Error(`Échec récupération: ${error.message}`);
  }

  return data;
}

// Supprimer un chantier
export async function deleteChantier(id: string): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('chantiers')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Erreur suppression chantier:', error);
    throw new Error(`Échec suppression: ${error.message}`);
  }
}

// Compter les articles liés à un chantier
export async function countArticlesByChantier(chantierId: string): Promise<number> {
  const supabase = getSupabaseClient();

  const { count, error } = await supabase
    .from('article_drafts')
    .select('*', { count: 'exact', head: true })
    .eq('chantier_id', chantierId);

  if (error) {
    console.error('Erreur comptage articles:', error);
    return 0;
  }

  return count || 0;
}
