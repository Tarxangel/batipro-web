// Supabase Edge Function — Synchro des dossiers ERP OCI → table oci_dossiers
//
// Deux modes, même table d'arrivée :
//  - push : body { dossiers: [...] } au format de l'API OCI (/v1/dossiers).
//    Utilisé par la VM rangemails, seule machine autorisée à joindre l'ERP
//    aujourd'hui (elle le tire déjà toutes les 30 min pour ses référentiels).
//  - pull : body {} → la fonction interroge l'ERP elle-même (OCI_BASE_URL +
//    OCI_API_KEY). Ne marche qu'une fois le flux VM PLU → 192.168.41.18:3000
//    ouvert par Neige et l'IP whitelistée par OCI.
//
// Auth : en-tête x-sync-secret == OCI_SYNC_SECRET (pas de JWT utilisateur).
// Upsert seulement : un dossier qui disparaît du flux reste en cache, pour ne
// jamais casser un chantier déjà lié.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface OciDossier {
  id: string | number
  num_dossier?: string | null
  nom?: string | null
  phase?: string | null
  client?: { nom?: string | null } | null
  adresse?: string | null
  code_postal?: string | null
  ville?: string | null
  responsable?: { nom?: string | null; prenom?: string | null } | string | null
  updated_at?: string | null
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

// Comparaison à temps constant du secret partagé
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// L'ERP renvoie parfois des U+FFFD (corruption cp1252 en amont) et des espaces parasites.
function clean(s: string | null | undefined): string | null {
  if (s == null) return null
  const t = String(s).replace(/�/g, '').replace(/\s+/g, ' ').trim()
  return t || null
}

function responsableName(r: OciDossier['responsable']): string | null {
  if (!r) return null
  if (typeof r === 'string') return clean(r)
  return clean([r.prenom, r.nom].filter(Boolean).join(' '))
}

function toRow(d: OciDossier, syncedAt: string) {
  const num = clean(d.num_dossier)
  const nom = clean(d.nom)
  if (!num || !nom || d.id == null) return null // l'API n'expose que les dossiers numérotés, garde-fou
  return {
    id: String(d.id),
    num_dossier: num,
    nom,
    phase: clean(d.phase),
    client_nom: clean(d.client?.nom),
    adresse: clean(d.adresse),
    code_postal: clean(d.code_postal),
    ville: clean(d.ville),
    responsable: responsableName(d.responsable),
    erp_updated_at: d.updated_at || null,
    synced_at: syncedAt,
  }
}

async function pullFromErp(baseUrl: string, apiKey: string): Promise<OciDossier[]> {
  const all: OciDossier[] = []
  for (let page = 1; page < 50; page++) {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/dossiers?per_page=1000&page=${page}`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) throw new Error(`ERP OCI HTTP ${res.status}`)
    const body = await res.json()
    const items: OciDossier[] = body.items || []
    all.push(...items)
    if (items.length === 0 || all.length >= (body.count ?? 0)) break
  }
  return all
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'POST uniquement' }, 405)
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
  const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const SYNC_SECRET = Deno.env.get('OCI_SYNC_SECRET')
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SYNC_SECRET) {
    return jsonResponse({ error: 'Configuration serveur manquante' }, 500)
  }

  if (!safeEqual(req.headers.get('x-sync-secret') || '', SYNC_SECRET)) {
    return jsonResponse({ error: 'Non autorisé' }, 401)
  }

  let body: { dossiers?: OciDossier[] } = {}
  try {
    body = await req.json()
  } catch {
    // body vide → mode pull
  }

  let dossiers: OciDossier[]
  let mode: 'push' | 'pull'
  if (Array.isArray(body.dossiers)) {
    mode = 'push'
    dossiers = body.dossiers
  } else {
    mode = 'pull'
    const baseUrl = Deno.env.get('OCI_BASE_URL')
    const apiKey = Deno.env.get('OCI_API_KEY')
    if (!baseUrl || !apiKey) {
      return jsonResponse({ error: 'Mode pull indisponible : OCI_BASE_URL / OCI_API_KEY absents' }, 501)
    }
    try {
      dossiers = await pullFromErp(baseUrl, apiKey)
    } catch (e) {
      return jsonResponse({ error: `ERP injoignable : ${(e as Error).message}` }, 502)
    }
  }

  const syncedAt = new Date().toISOString()
  const rows = dossiers.map(d => toRow(d, syncedAt)).filter((r): r is NonNullable<typeof r> => r !== null)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('oci_dossiers').upsert(rows.slice(i, i + 500), { onConflict: 'id' })
    if (error) {
      console.error('oci-sync upsert:', error)
      return jsonResponse({ error: `Écriture échouée : ${error.message}` }, 500)
    }
  }

  return jsonResponse({ ok: true, mode, received: dossiers.length, upserted: rows.length, skipped: dossiers.length - rows.length })
})
