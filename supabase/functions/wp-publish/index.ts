// Supabase Edge Function — Publication d'un article WordPress en direct (sans n8n)
//
// Reçoit { wp_post_id, title, content } et :
//   1. Met à jour le post WordPress existant (titre + contenu)
//   2. Passe son statut en `publish`
//   3. Renvoie { success, post_id, post_url }
//
// Remplace l'ancien proxy n8n `n8n-publish` / `smart-endpoint` : le container
// edge-runtime self-host ne peut pas joindre n8n.batiproconcept.fr (egress KO),
// alors qu'il joint directement www.batiproconcept.fr (cf. create-wp-draft).
//
// Secrets Supabase requis :
//   - WP_API_USER     (utilisateur WordPress avec capacité publish_posts)
//   - WP_API_PASSWORD (Application Password généré dans WP, format "xxxx xxxx xxxx xxxx")
//   - WP_SITE_URL     (optionnel, défaut "https://www.batiproconcept.fr")

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface RequestBody {
  wp_post_id: number
  title: string
  content: string
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

  const WP_USER = Deno.env.get('WP_API_USER')
  const WP_PASS = Deno.env.get('WP_API_PASSWORD')
  const WP_SITE = (Deno.env.get('WP_SITE_URL') || 'https://www.batiproconcept.fr').replace(/\/$/, '')

  if (!WP_USER || !WP_PASS) {
    return jsonResponse({ success: false, error: 'WP_API_USER / WP_API_PASSWORD non configurés' }, 500)
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ success: false, error: 'Corps JSON invalide' }, 400)
  }

  if (!body.wp_post_id || !body.title || !body.content) {
    return jsonResponse({ success: false, error: 'wp_post_id, title et content sont requis' }, 400)
  }

  const authHeader = 'Basic ' + btoa(`${WP_USER}:${WP_PASS}`)

  // ── Met à jour le post existant et le passe en `publish` ─────────
  let postJson: { id: number; link: string }
  try {
    const postResp = await fetch(`${WP_SITE}/wp-json/wp/v2/posts/${body.wp_post_id}`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: body.title,
        content: body.content,
        status: 'publish',
      }),
    })
    if (!postResp.ok) {
      const errTxt = await postResp.text().catch(() => '')
      console.error('WP publish failed:', postResp.status, errTxt)
      return jsonResponse({ success: false, error: `WP publish ${postResp.status}: ${errTxt.slice(0, 200)}` }, 502)
    }
    postJson = await postResp.json()
  } catch (err) {
    console.error('WP publish error:', err)
    return jsonResponse({ success: false, error: `Publication: ${(err as Error).message}` }, 502)
  }

  return jsonResponse({
    success: true,
    post_id: postJson.id,
    post_url: postJson.link,
  })
})
