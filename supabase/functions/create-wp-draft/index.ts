// Supabase Edge Function — Création d'un brouillon WordPress depuis le chat IA
//
// Reçoit { photo_base64, mime_type, title, content_html, filename? } et :
//   1. Upload la photo sur https://www.batiproconcept.fr/wp-json/wp/v2/media
//   2. Crée un brouillon (status=draft) avec featured_media = id de la photo
//   3. Renvoie { wp_post_id, wp_media_id, image_url }
//
// Remplace l'ancien chemin n8n du "mode rapide" pour cette étape.
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
  photo_base64: string
  mime_type?: string
  title: string
  content_html: string
  filename?: string
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
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

  if (!body.photo_base64 || !body.title || !body.content_html) {
    return jsonResponse({ success: false, error: 'photo_base64, title et content_html sont requis' }, 400)
  }

  const authHeader = 'Basic ' + btoa(`${WP_USER}:${WP_PASS}`)
  const mimeType = body.mime_type || 'image/jpeg'
  const ext = mimeType.split('/')[1] || 'jpg'
  const filename = body.filename || `chantier-${Date.now()}.${ext}`

  // ── 1. Upload la photo sur /wp-json/wp/v2/media ──────────
  let mediaJson: { id: number; source_url: string }
  try {
    const photoBytes = base64ToBytes(body.photo_base64)
    const mediaResp = await fetch(`${WP_SITE}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
      body: photoBytes,
    })
    if (!mediaResp.ok) {
      const errTxt = await mediaResp.text().catch(() => '')
      console.error('WP media upload failed:', mediaResp.status, errTxt)
      return jsonResponse({ success: false, error: `WP media upload ${mediaResp.status}: ${errTxt.slice(0, 200)}` }, 502)
    }
    mediaJson = await mediaResp.json()
  } catch (err) {
    console.error('WP media upload error:', err)
    return jsonResponse({ success: false, error: `Upload photo: ${(err as Error).message}` }, 502)
  }

  // ── 2. Crée le brouillon ─────────────────────────────────
  let postJson: { id: number; link: string }
  try {
    const postResp = await fetch(`${WP_SITE}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: body.title,
        content: body.content_html,
        status: 'draft',
        featured_media: mediaJson.id,
      }),
    })
    if (!postResp.ok) {
      const errTxt = await postResp.text().catch(() => '')
      console.error('WP create post failed:', postResp.status, errTxt)
      return jsonResponse({ success: false, error: `WP create post ${postResp.status}: ${errTxt.slice(0, 200)}` }, 502)
    }
    postJson = await postResp.json()
  } catch (err) {
    console.error('WP create post error:', err)
    return jsonResponse({ success: false, error: `Create brouillon: ${(err as Error).message}` }, 502)
  }

  return jsonResponse({
    success: true,
    wp_post_id: postJson.id,
    wp_media_id: mediaJson.id,
    image_url: mediaJson.source_url,
    edit_url: `${WP_SITE}/wp-admin/post.php?post=${postJson.id}&action=edit`,
  })
})
