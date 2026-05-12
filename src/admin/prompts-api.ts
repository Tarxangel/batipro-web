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

export async function updatePromptContent(key: string, content: string): Promise<void> {
  const supabase = getAuthClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { error } = await supabase
    .from('ai_prompts')
    .update({ content, updated_by: user?.id ?? null })
    .eq('key', key);

  if (error) throw new Error(error.message);
}
