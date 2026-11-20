// Lecture / mise à jour des prompts IA depuis la table ai_prompts.
// Lecture : autorisée à tout authentifié (RLS).
// Update : autorisée aux admins uniquement (RLS).

import { getAuthClient } from '../auth/client';

export interface AiPrompt {
  key: string;
  label: string;
  description: string | null;
  content: string;
  placeholders: string[];
  updated_at: string;
  updated_by: string | null;
}

export async function listPrompts(): Promise<AiPrompt[]> {
  const supabase = getAuthClient();
  const { data, error } = await supabase
    .from('ai_prompts')
    .select('*')
    .order('key');

  if (error) throw new Error(error.message);
  return (data as AiPrompt[]) || [];
}

export interface AiPromptVersion {
  id: number;
  content: string;
  authored_by: string | null;
  /** Quand ce contenu avait été écrit. */
  authored_at: string;
  /** Quand il a été remplacé — c'est la date qui situe la version. */
  archived_at: string;
  /** Nom résolu depuis app_profiles (null si inconnu ou non-admin). */
  author_name: string | null;
}

/**
 * Versions antérieures d'un prompt, la plus récente d'abord. La table est
 * alimentée par un trigger sur ai_prompts : toute modification y laisse une
 * trace, y compris une restauration.
 */
export async function listPromptVersions(key: string): Promise<AiPromptVersion[]> {
  const supabase = getAuthClient();
  const { data, error } = await supabase
    .from('ai_prompt_versions')
    .select('id, content, authored_by, authored_at, archived_at')
    .eq('prompt_key', key)
    .order('archived_at', { ascending: false });

  if (error) throw new Error(error.message);
  const rows = (data as Omit<AiPromptVersion, 'author_name'>[]) || [];

  // Noms des auteurs en une requête séparée : authored_by pointe sur auth.users,
  // que PostgREST ne sait pas joindre à app_profiles automatiquement.
  const ids = [...new Set(rows.map(r => r.authored_by).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profiles } = await supabase
      .from('app_profiles')
      .select('id, full_name')
      .in('id', ids);
    for (const prof of (profiles as { id: string; full_name: string }[]) || []) {
      names.set(prof.id, prof.full_name);
    }
  }

  return rows.map(r => ({
    ...r,
    author_name: r.authored_by ? names.get(r.authored_by) ?? null : null,
  }));
}

export async function updatePromptContent(key: string, content: string): Promise<void> {
  const supabase = getAuthClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase
    .from('ai_prompts')
    .update({ content, updated_by: user?.id ?? null })
    .eq('key', key);

  if (error) throw new Error(error.message);
}
