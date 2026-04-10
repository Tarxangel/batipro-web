// Module base de données pour les brouillons d'articles

import { SupabaseClient } from '@supabase/supabase-js';
import { getAuthClient } from '../auth/client';

// Types
export interface ArticleDraft {
  id: string;
  title: string;
  content: string;
  description: string | null;
  image_url: string | null;
  wp_media_id: number | null;
  status: 'draft' | 'pending_review' | 'published';
  wp_post_id: number | null;
  wp_post_url: string | null;
  chantier_id: string | null;
  created_at: string;
  updated_at: string;
}

export type NewArticleDraft = Omit<ArticleDraft, 'id' | 'created_at' | 'updated_at' | 'status' | 'wp_post_url'> & {
  wp_post_id?: number | null;
  chantier_id?: string | null;
};

// Client Supabase partagé (auth-aware: envoie le JWT utilisateur quand connecté)
function getSupabaseClient(): SupabaseClient {
  return getAuthClient();
}

// Créer un nouveau brouillon
export async function createDraft(draft: NewArticleDraft): Promise<ArticleDraft> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('article_drafts')
    .insert({
      title: draft.title,
      content: draft.content,
      description: draft.description,
      image_url: draft.image_url,
      wp_media_id: draft.wp_media_id,
      wp_post_id: draft.wp_post_id ?? null,
      chantier_id: draft.chantier_id ?? null,
      status: 'draft'
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Erreur création brouillon:', error);
    throw new Error(`Échec création brouillon: ${error.message}`);
  }

  console.log('✅ Brouillon créé:', data.id);
  return data;
}

// Mettre à jour un brouillon
export async function updateDraft(id: string, updates: Partial<ArticleDraft>): Promise<ArticleDraft> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('article_drafts')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('❌ Erreur mise à jour brouillon:', error);
    throw new Error(`Échec mise à jour: ${error.message}`);
  }

  console.log('✅ Brouillon mis à jour:', id);
  return data;
}

// Marquer comme publié
export async function markAsPublished(id: string, wpPostId: number, wpPostUrl: string): Promise<ArticleDraft> {
  return updateDraft(id, {
    status: 'published',
    wp_post_id: wpPostId,
    wp_post_url: wpPostUrl
  });
}

// Récupérer tous les brouillons (non publiés)
export async function getDrafts(): Promise<ArticleDraft[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('article_drafts')
    .select('*')
    .in('status', ['draft', 'pending_review'])
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Erreur récupération brouillons:', error);
    throw new Error(`Échec récupération: ${error.message}`);
  }

  return data || [];
}

// Récupérer un brouillon par ID
export async function getDraft(id: string): Promise<ArticleDraft | null> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('article_drafts')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    console.error('❌ Erreur récupération brouillon:', error);
    throw new Error(`Échec récupération: ${error.message}`);
  }

  return data;
}

// Supprimer un brouillon
export async function deleteDraft(id: string): Promise<void> {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from('article_drafts')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('❌ Erreur suppression brouillon:', error);
    throw new Error(`Échec suppression: ${error.message}`);
  }

  console.log('✅ Brouillon supprimé:', id);
}

// Récupérer les articles liés à un chantier (tous statuts)
export async function getDraftsByChantier(chantierId: string): Promise<ArticleDraft[]> {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('article_drafts')
    .select('*')
    .eq('chantier_id', chantierId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Erreur récupération articles chantier:', error);
    throw new Error(`Échec récupération: ${error.message}`);
  }

  return data || [];
}
