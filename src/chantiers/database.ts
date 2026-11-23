// Module base de données pour les chantiers

import { SupabaseClient } from '@supabase/supabase-js';
import { getAuthClient } from '../auth/client';

// Types
export interface Chantier {
  id: string;
  name: string;
  client_name: string | null;
  client_sector: string | null;   // null = « à préciser » (projet importé de l'ERP)
  project_type: string | null;
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
  oci_dossier_id: string | null;
  oci?: { num_dossier: string; phase: string | null } | null;  // jointure oci_dossiers
}

export type NewChantier = Omit<Chantier, 'id' | 'created_at' | 'updated_at' | 'status' | 'oci_dossier_id' | 'oci'>;

// Chantier + n° et phase du dossier ERP lié
const CHANTIER_SELECT = '*, oci:oci_dossiers(num_dossier, phase)';

// Client Supabase partagé (auth-aware: envoie le JWT utilisateur quand connecté)
function getSupabaseClient(): SupabaseClient {
  return getAuthClient();
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
  const { oci: _oci, ...fields } = updates;

  const { data, error } = await supabase
    .from('chantiers')
    .update({
      ...fields,
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
    .select(CHANTIER_SELECT)
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
    .select(CHANTIER_SELECT)
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
