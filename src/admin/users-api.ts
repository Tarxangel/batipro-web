// Wrapper TypeScript autour de l'edge function manage-users.

import { getAuthClient } from '../auth/client';
import { SUPABASE_URL } from '../config';

const ENDPOINT = `${SUPABASE_URL}/functions/v1/manage-users`;

export interface ManagedUser {
  id: string;
  email: string;
  full_name: string;
  is_admin: boolean;
  permissions: Record<string, string[]>;
  created_at: string;
  updated_at: string;
}

export interface CreateUserPayload {
  email: string;
  password: string;
  full_name: string;
  is_admin: boolean;
  permissions: Record<string, string[]>;
}

export interface UpdateUserPayload {
  user_id: string;
  full_name?: string;
  is_admin?: boolean;
  permissions?: Record<string, string[]>;
}

async function callManageUsers<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const supabase = getAuthClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    throw new Error('Session expirée — veuillez vous reconnecter');
  }

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const json = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) {
    throw new Error(json.error || `Erreur HTTP ${response.status}`);
  }
  return json as T;
}

export async function listUsers(): Promise<ManagedUser[]> {
  const data = await callManageUsers<{ users: ManagedUser[] }>({ action: 'list' });
  return data.users || [];
}

export async function createUser(payload: CreateUserPayload): Promise<{ id: string }> {
  return callManageUsers<{ id: string }>({ action: 'create', ...payload });
}

export async function updateUser(payload: UpdateUserPayload): Promise<void> {
  await callManageUsers({ action: 'update', ...payload });
}

export async function resetPassword(user_id: string, new_password: string): Promise<void> {
  await callManageUsers({ action: 'reset_password', user_id, new_password });
}

export async function deleteUser(user_id: string): Promise<void> {
  await callManageUsers({ action: 'delete', user_id });
}
