// Publication directe LinkedIn (profil perso, scope w_member_social).
//
// Actions (POST { action }) :
//   - start      : démarre l'OAuth, renvoie l'URL d'autorisation LinkedIn
//   - status     : { connected, name, expired }
//   - publish    : poste { title, content, articleUrl, post } sur le profil,
//                  avec mention de la page entreprise Batipro (@[Nom](urn))
//   - disconnect : supprime le compte connecté
//
// Le callback OAuth est géré par la fonction séparée `linkedin-callback`.
// Les tokens vivent dans linkedin_accounts (service role uniquement).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const CLIENT_ID = Deno.env.get('LINKEDIN_CLIENT_ID') || ''
const CLIENT_SECRET = Deno.env.get('LINKEDIN_CLIENT_SECRET') || ''
const REDIRECT_URI = Deno.env.get('LINKEDIN_REDIRECT_URI') || ''
const ORG_URN = Deno.env.get('LINKEDIN_ORG_URN') || ''         // urn:li:organization:{id}
const ORG_NAME = Deno.env.get('LINKEDIN_ORG_NAME') || ''       // nom EXACT de la page
const LI_VERSION = Deno.env.get('LINKEDIN_VERSION') || '202605'
const SCOPE = 'openid profile w_member_social'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Échappe les caractères qui cassent le "little text format" de LinkedIn
// (parenthèses & chevrons surtout). On laisse # (hashtags) et @ (mentions).
function escapeCommentary(text: string): string {
  return text.replace(/([()<>])/g, '\\$1')
}

// Rafraîchit le token si expiré ; renvoie un access_token valide ou null.
async function getValidToken(sb: ReturnType<typeof admin>, account: Record<string, any>): Promise<string | null> {
  const now = Date.now()
  if (new Date(account.expires_at).getTime() - 60_000 > now) {
    return account.access_token
  }
  if (!account.refresh_token) return null
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: account.refresh_token,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  })
  const resp = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!resp.ok) return null
  const tok = await resp.json()
  const expiresAt = new Date(now + (tok.expires_in || 5184000) * 1000).toISOString()
  await sb.from('linkedin_accounts').update({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || account.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date(now).toISOString(),
  }).eq('user_id', account.user_id)
  return tok.access_token
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Auth de l'appelant
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ success: false, error: 'Token manquant' }, 401)
  const token = authHeader.replace(/^Bearer\s+/i, '')
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }
  )
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) return json({ success: false, error: 'Session invalide' }, 401)
  const userId = userData.user.id

  let body: any
  try { body = await req.json() } catch { return json({ success: false, error: 'JSON invalide' }, 400) }
  const action = body.action
  const sb = admin()

  // ── START : démarre l'OAuth ──────────────────────────────
  if (action === 'start') {
    if (!CLIENT_ID || !REDIRECT_URI) return json({ success: false, error: 'LinkedIn non configuré' }, 500)
    // state = jeton aléatoire lié à l'utilisateur (anti-CSRF)
    const state = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '')
    await sb.from('linkedin_oauth_states').insert({ state, user_id: userId })
    const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code`
      + `&client_id=${encodeURIComponent(CLIENT_ID)}`
      + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
      + `&state=${encodeURIComponent(state)}`
      + `&scope=${encodeURIComponent(SCOPE)}`
    return json({ success: true, authorizeUrl: url })
  }

  // ── STATUS ───────────────────────────────────────────────
  if (action === 'status') {
    const { data } = await sb.from('linkedin_accounts').select('linkedin_name, expires_at, refresh_token').eq('user_id', userId).single()
    if (!data) return json({ success: true, connected: false })
    const expired = new Date(data.expires_at).getTime() < Date.now() && !data.refresh_token
    return json({ success: true, connected: true, name: data.linkedin_name, expired })
  }

  // ── DISCONNECT ───────────────────────────────────────────
  if (action === 'disconnect') {
    await sb.from('linkedin_accounts').delete().eq('user_id', userId)
    return json({ success: true })
  }

  // ── PUBLISH ──────────────────────────────────────────────
  if (action === 'publish') {
    const { post, articleUrl } = body
    if (!post) return json({ success: false, error: 'post requis' }, 400)

    const { data: account } = await sb.from('linkedin_accounts').select('*').eq('user_id', userId).single()
    if (!account) return json({ success: false, error: 'LinkedIn non connecté' }, 400)

    const accessToken = await getValidToken(sb, account)
    if (!accessToken) return json({ success: false, error: 'Session LinkedIn expirée — reconnecte ton compte' }, 401)

    // Commentary : on échappe le texte, puis on ajoute la mention entreprise.
    let commentary = escapeCommentary(String(post).trim())
    if (ORG_URN && ORG_NAME && !commentary.includes(ORG_URN)) {
      commentary += `\n\nUn projet signé @[${ORG_NAME}](${ORG_URN})`
    }

    const payload = {
      author: account.person_urn,
      commentary,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }

    const resp = await fetch('https://api.linkedin.com/rest/posts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'LinkedIn-Version': LI_VERSION,
      },
      body: JSON.stringify(payload),
    })

    if (resp.status !== 201) {
      const errText = await resp.text().catch(() => '')
      console.error('LinkedIn publish error', resp.status, errText)
      return json({ success: false, error: `LinkedIn ${resp.status}: ${errText.slice(0, 300)}` }, 502)
    }
    const postId = resp.headers.get('x-restli-id') || ''
    const postUrl = postId ? `https://www.linkedin.com/feed/update/${postId}/` : 'https://www.linkedin.com/feed/'
    return json({ success: true, url: postUrl, postId })
  }

  return json({ success: false, error: 'action inconnue' }, 400)
})
