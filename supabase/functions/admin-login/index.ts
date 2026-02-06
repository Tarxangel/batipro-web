// Supabase Edge Function - Admin Login
// Vérifie le mot de passe admin et retourne un token JWT signé

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Encoder une string en Uint8Array
function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

// Base64url encode
function base64url(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Créer un JWT signé HMAC-SHA256
async function createToken(secret: string, expiresInHours = 24): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    role: 'admin',
    iat: now,
    exp: now + (expiresInHours * 3600)
  }

  const headerB64 = base64url(encode(JSON.stringify(header)))
  const payloadB64 = base64url(encode(JSON.stringify(payload)))
  const signingInput = `${headerB64}.${payloadB64}`

  const key = await crypto.subtle.importKey(
    'raw',
    encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encode(signingInput))
  )

  return `${signingInput}.${base64url(signature)}`
}

// Vérifier un JWT
async function verifyToken(token: string, secret: string): Promise<boolean> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return false

    const signingInput = `${parts[0]}.${parts[1]}`
    const key = await crypto.subtle.importKey(
      'raw',
      encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    // Reconstruire la signature depuis base64url
    const sigB64 = parts[2].replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - parts[2].length % 4) % 4)
    const sigBytes = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0))

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encode(signingInput))
    if (!valid) return false

    // Vérifier l'expiration
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (payload.exp < Math.floor(Date.now() / 1000)) return false

    return true
  } catch {
    return false
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const JWT_SECRET = Deno.env.get('ADMIN_JWT_SECRET') || 'batipro-admin-secret-change-me'
  const ADMIN_PASSWORD = Deno.env.get('ADMIN_PASSWORD')

  if (!ADMIN_PASSWORD) {
    console.error('ADMIN_PASSWORD env var not set')
    return new Response(
      JSON.stringify({ success: false, error: 'Configuration serveur manquante' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()

    // Mode 1: Login avec mot de passe
    if (body.action === 'login') {
      if (!body.password) {
        return new Response(
          JSON.stringify({ success: false, error: 'Mot de passe requis' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (body.password !== ADMIN_PASSWORD) {
        return new Response(
          JSON.stringify({ success: false, error: 'Mot de passe incorrect' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const token = await createToken(JWT_SECRET)
      return new Response(
        JSON.stringify({ success: true, token }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Mode 2: Vérifier un token existant
    if (body.action === 'verify') {
      if (!body.token) {
        return new Response(
          JSON.stringify({ success: false, valid: false }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const valid = await verifyToken(body.token, JWT_SECRET)
      return new Response(
        JSON.stringify({ success: true, valid }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: false, error: 'Action invalide (login ou verify)' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Admin login error:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Erreur serveur' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
