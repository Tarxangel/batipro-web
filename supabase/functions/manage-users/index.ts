// Supabase Edge Function — Gestion des comptes utilisateurs
//
// Endpoint privilégié appelé par la page admin pour créer / éditer /
// supprimer / réinitialiser les utilisateurs de l'application.
//
// L'appelant DOIT être authentifié et avoir is_admin = true dans
// app_profiles. La fonction utilise ensuite le service_role pour
// effectuer les opérations privilégiées (création auth.users, etc).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface ProfilePayload {
  full_name?: string
  is_admin?: boolean
  permissions?: Record<string, string[]>
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return jsonResponse({ error: 'Configuration serveur manquante' }, 500)
  }

  // ── Authentification de l'appelant ──────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Token manquant' }, 401)
  }
  const token = authHeader.replace(/^Bearer\s+/i, '')

  // Client authentifié comme l'utilisateur appelant
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  })

  // Récupère l'utilisateur depuis le JWT
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) {
    return jsonResponse({ error: 'Session invalide' }, 401)
  }
  const callerId = userData.user.id

  // Vérifie que l'appelant est admin
  const { data: callerProfile, error: profileErr } = await userClient
    .from('app_profiles')
    .select('is_admin')
    .eq('id', callerId)
    .single()

  if (profileErr || !callerProfile?.is_admin) {
    return jsonResponse({ error: 'Accès réservé aux administrateurs' }, 403)
  }

  // Client admin (service_role) pour les opérations privilégiées
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  // ── Routing ─────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Corps JSON invalide' }, 400)
  }

  const action = body.action as string

  try {
    switch (action) {
      // ── Liste tous les utilisateurs ────────────────────
      case 'list': {
        const { data, error } = await adminClient
          .from('app_profiles')
          .select('id, email, full_name, is_admin, permissions, created_at, updated_at')
          .order('created_at', { ascending: true })
        if (error) throw error
        return jsonResponse({ users: data })
      }

      // ── Création d'un utilisateur ──────────────────────
      case 'create': {
        const email = (body.email as string)?.trim().toLowerCase()
        const password = body.password as string
        const fullName = (body.full_name as string)?.trim()
        const isAdmin = !!body.is_admin
        const permissions = (body.permissions as Record<string, string[]>) || {}

        if (!email || !password || !fullName) {
          return jsonResponse({ error: 'email, password et full_name sont requis' }, 400)
        }
        if (password.length < 8) {
          return jsonResponse({ error: 'Le mot de passe doit faire au moins 8 caractères' }, 400)
        }

        // 1. Crée l'utilisateur dans auth.users
        const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true, // pas de confirmation par mail
          user_metadata: { full_name: fullName }
        })
        if (createErr || !created?.user) {
          return jsonResponse({ error: createErr?.message || 'Échec création auth' }, 400)
        }

        // 2. Crée le profil applicatif lié
        const { error: insertErr } = await adminClient
          .from('app_profiles')
          .insert({
            id: created.user.id,
            email,
            full_name: fullName,
            is_admin: isAdmin,
            permissions,
            created_by: callerId
          })

        if (insertErr) {
          // Rollback: supprime l'auth user pour ne pas laisser d'orphelin
          await adminClient.auth.admin.deleteUser(created.user.id)
          return jsonResponse({ error: `Échec création profil: ${insertErr.message}` }, 400)
        }

        return jsonResponse({ id: created.user.id, email, full_name: fullName })
      }

      // ── Mise à jour d'un profil (nom, admin, permissions) ──
      case 'update': {
        const userId = body.user_id as string
        if (!userId) return jsonResponse({ error: 'user_id requis' }, 400)

        const updates: ProfilePayload = {}
        if (typeof body.full_name === 'string') updates.full_name = body.full_name.trim()
        if (typeof body.is_admin === 'boolean') updates.is_admin = body.is_admin
        if (body.permissions && typeof body.permissions === 'object') {
          updates.permissions = body.permissions as Record<string, string[]>
        }

        // Garde-fou: empêche un admin de se retirer lui-même son propre statut admin
        // (sinon plus personne ne peut gérer les comptes)
        if (userId === callerId && updates.is_admin === false) {
          return jsonResponse({ error: 'Vous ne pouvez pas retirer votre propre statut admin' }, 400)
        }

        const { error } = await adminClient
          .from('app_profiles')
          .update(updates)
          .eq('id', userId)
        if (error) throw error
        return jsonResponse({ ok: true })
      }

      // ── Réinitialisation du mot de passe ───────────────
      case 'reset_password': {
        const userId = body.user_id as string
        const newPassword = body.new_password as string
        if (!userId || !newPassword) {
          return jsonResponse({ error: 'user_id et new_password requis' }, 400)
        }
        if (newPassword.length < 8) {
          return jsonResponse({ error: 'Le mot de passe doit faire au moins 8 caractères' }, 400)
        }

        const { error } = await adminClient.auth.admin.updateUserById(userId, {
          password: newPassword
        })
        if (error) throw error
        return jsonResponse({ ok: true })
      }

      // ── Suppression d'un utilisateur ───────────────────
      case 'delete': {
        const userId = body.user_id as string
        if (!userId) return jsonResponse({ error: 'user_id requis' }, 400)

        // Garde-fou: pas d'auto-suppression
        if (userId === callerId) {
          return jsonResponse({ error: 'Vous ne pouvez pas supprimer votre propre compte' }, 400)
        }

        // Supprime de auth.users — la FK ON DELETE CASCADE retire le profil
        const { error } = await adminClient.auth.admin.deleteUser(userId)
        if (error) throw error
        return jsonResponse({ ok: true })
      }

      default:
        return jsonResponse({ error: `Action inconnue: ${action}` }, 400)
    }
  } catch (error) {
    console.error('manage-users error:', error)
    return jsonResponse({ error: (error as Error).message }, 500)
  }
})
