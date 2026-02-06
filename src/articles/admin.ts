// Module Admin - Gestion de l'authentification admin

import { ADMIN_LOGIN_URL } from './config';
import { SUPABASE_ANON_KEY } from '../config';

const TOKEN_KEY = 'batipro_admin_token';

// Vérifier si l'admin est connecté (check local + vérification serveur)
export function isAdmin(): boolean {
  return !!sessionStorage.getItem(TOKEN_KEY);
}

// Récupérer le token
export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

// Login admin - envoie le mot de passe à l'Edge Function
export async function adminLogin(password: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(ADMIN_LOGIN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ action: 'login', password })
    });

    const data = await response.json();

    if (data.success && data.token) {
      sessionStorage.setItem(TOKEN_KEY, data.token);
      return { success: true };
    }

    return { success: false, error: data.error || 'Mot de passe incorrect' };
  } catch (error) {
    return { success: false, error: 'Erreur de connexion au serveur' };
  }
}

// Logout admin
export function adminLogout(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

// Vérifier que le token est encore valide (appel serveur)
export async function verifyAdminToken(): Promise<boolean> {
  const token = getToken();
  if (!token) return false;

  try {
    const response = await fetch(ADMIN_LOGIN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ action: 'verify', token })
    });

    const data = await response.json();

    if (!data.valid) {
      sessionStorage.removeItem(TOKEN_KEY);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
