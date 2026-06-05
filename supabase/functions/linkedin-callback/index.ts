// Callback OAuth LinkedIn (cible du redirect_uri enregistré dans l'app).
// LinkedIn redirige le navigateur ici avec ?code=...&state=...
// On échange le code contre un token, on récupère l'URN du membre, on stocke,
// puis on renvoie l'utilisateur vers l'app. Pas d'auth Supabase (navigation
// top-level) → on identifie l'utilisateur via le `state` créé à l'étape start.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1"

const CLIENT_ID = Deno.env.get('LINKEDIN_CLIENT_ID') || ''
const CLIENT_SECRET = Deno.env.get('LINKEDIN_CLIENT_SECRET') || ''
const REDIRECT_URI = Deno.env.get('LINKEDIN_REDIRECT_URI') || ''
const SUCCESS_REDIRECT = Deno.env.get('LINKEDIN_SUCCESS_REDIRECT') || 'https://app.plu.batiproconcept.fr/articles.html'

function redirect(status: 'connected' | 'error', detail = ''): Response {
  const url = `${SUCCESS_REDIRECT}?linkedin=${status}${detail ? '&detail=' + encodeURIComponent(detail) : ''}`
  return new Response(null, { status: 302, headers: { Location: url } })
}

serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error')

  if (oauthError) return redirect('error', oauthError)
  if (!code || !state) return redirect('error', 'paramètres manquants')

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Valide le state -> user (et le consomme)
  const { data: stateRow } = await sb.from('linkedin_oauth_states').select('user_id').eq('state', state).single()
  if (!stateRow) return redirect('error', 'state invalide')
  const userId = stateRow.user_id
  await sb.from('linkedin_oauth_states').delete().eq('state', state)

  // Échange code -> token
  const tokenResp = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    }),
  })
  if (!tokenResp.ok) {
    console.error('token exchange failed', tokenResp.status, await tokenResp.text().catch(() => ''))
    return redirect('error', 'échange token échoué')
  }
  const tok = await tokenResp.json()

  // Récupère l'identité du membre (OpenID userinfo) → person URN
  const infoResp = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  })
  if (!infoResp.ok) {
    console.error('userinfo failed', infoResp.status, await infoResp.text().catch(() => ''))
    return redirect('error', 'profil illisible')
  }
  const info = await infoResp.json()
  const personUrn = `urn:li:person:${info.sub}`
  const now = Date.now()
  const expiresAt = new Date(now + (tok.expires_in || 5184000) * 1000).toISOString()
  const refreshExpiresAt = tok.refresh_token_expires_in
    ? new Date(now + tok.refresh_token_expires_in * 1000).toISOString() : null

  await sb.from('linkedin_accounts').upsert({
    user_id: userId,
    person_urn: personUrn,
    linkedin_name: info.name || null,
    access_token: tok.access_token,
    refresh_token: tok.refresh_token || null,
    expires_at: expiresAt,
    refresh_expires_at: refreshExpiresAt,
    scope: tok.scope || null,
    updated_at: new Date(now).toISOString(),
  })

  return redirect('connected', info.name || '')
})
