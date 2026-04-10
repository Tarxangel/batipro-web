// Helpers de session et de permissions pour l'authentification.
//
// Modèle: chaque utilisateur a un profil dans `app_profiles` avec
// `is_admin` et un objet `permissions` JSONB de la forme :
//   { "articles": ["read","create","edit","publish"], ... }
//
// Un admin court-circuite toutes les vérifications de permission.

import type { User } from '@supabase/supabase-js';
import { getAuthClient } from './client';

export interface AppProfile {
  id: string;
  email: string;
  full_name: string;
  is_admin: boolean;
  permissions: Record<string, string[]>;
  created_at: string;
  updated_at: string;
}

export type AppModule = 'articles' | 'chantiers' | 'icpe' | 'map' | 'feedback';
export type AppAction = 'read' | 'create' | 'edit' | 'publish' | 'delete' | 'resolve';

let cachedProfile: AppProfile | null = null;
let cachedUserId: string | null = null;

// ── Auth ──────────────────────────────────────────────────

export async function login(email: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getAuthClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  cachedProfile = null;
  cachedUserId = null;
  return { ok: true };
}

export async function logout(): Promise<void> {
  const supabase = getAuthClient();
  await supabase.auth.signOut();
  cachedProfile = null;
  cachedUserId = null;
}

export async function getCurrentUser(): Promise<User | null> {
  const supabase = getAuthClient();
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

// ── Profile ──────────────────────────────────────────────

export async function getCurrentProfile(forceRefresh = false): Promise<AppProfile | null> {
  const user = await getCurrentUser();
  if (!user) {
    cachedProfile = null;
    cachedUserId = null;
    return null;
  }

  if (!forceRefresh && cachedProfile && cachedUserId === user.id) {
    return cachedProfile;
  }

  const supabase = getAuthClient();
  const { data, error } = await supabase
    .from('app_profiles')
    .select('id, email, full_name, is_admin, permissions, created_at, updated_at')
    .eq('id', user.id)
    .single();

  if (error || !data) {
    cachedProfile = null;
    cachedUserId = null;
    return null;
  }

  cachedProfile = data as AppProfile;
  cachedUserId = user.id;
  return cachedProfile;
}

// ── Permissions ──────────────────────────────────────────

export async function isAuthenticated(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}

export async function isAdmin(): Promise<boolean> {
  const profile = await getCurrentProfile();
  return profile?.is_admin === true;
}

export async function hasPermission(module: AppModule, action: AppAction): Promise<boolean> {
  const profile = await getCurrentProfile();
  if (!profile) return false;
  if (profile.is_admin) return true;
  const moduleActions = profile.permissions?.[module];
  return Array.isArray(moduleActions) && moduleActions.includes(action);
}

// ── Page guards ──────────────────────────────────────────

// Redirige vers /login.html si non authentifié.
// Renvoie le profil sinon.
export async function requireAuth(redirectTo = '/login.html'): Promise<AppProfile | null> {
  const profile = await getCurrentProfile();
  if (!profile) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `${redirectTo}?next=${next}`;
    return null;
  }
  return profile;
}

// Redirige si non admin.
export async function requireAdmin(redirectTo = '/'): Promise<AppProfile | null> {
  const profile = await requireAuth();
  if (!profile) return null;
  if (!profile.is_admin) {
    window.location.href = redirectTo;
    return null;
  }
  return profile;
}

// Redirige si l'utilisateur n'a pas la permission demandée.
export async function requirePermission(
  module: AppModule,
  action: AppAction,
  redirectTo = '/'
): Promise<AppProfile | null> {
  const profile = await requireAuth();
  if (!profile) return null;
  const ok = profile.is_admin
    || (Array.isArray(profile.permissions?.[module])
        && profile.permissions[module].includes(action));
  if (!ok) {
    window.location.href = redirectTo;
    return null;
  }
  return profile;
}
