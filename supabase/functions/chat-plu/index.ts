// Chat IA — questions sur une analyse PLU.
// L'utilisateur tape une question depuis la results card, on charge le
// contexte de l'analyse (parcelle + tableau détaillé + MH) et on appelle
// Gemini 3 Flash avec un budget output serré pour limiter les coûts.
//
// Budget par message: ~5-10K tokens input (selon présence du tableau),
// max 800 tokens output. Historique conservé côté front, on cape à
// 10 derniers messages pour éviter qu'il enfle indéfiniment.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!
const GEMINI_MODEL = 'gemini-3-flash-preview'
const MAX_HISTORY = 10  // sliding window: 10 derniers messages user/assistant (5 paires environ)
const MAX_OUTPUT_TOKENS = 800

function geminiUrl(): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface RequestBody {
  analysis_id: string
  messages: ChatMessage[]  // historique COMPLET y compris la nouvelle question (dernier item)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

function formatParcelleBlock(row: Record<string, unknown>): string {
  const lines: string[] = []
  lines.push(`Commune : ${row.parcelle_commune}`)
  lines.push(`Section / numéro : ${row.parcelle_section} / ${row.parcelle_numero}`)
  lines.push(`Surface : ${row.parcelle_surface} m²`)
  lines.push(`Zonage : ${row.zonage_libelle} (${row.zonage_type})`)
  if (row.zonage_url_document) lines.push(`Document : ${row.zonage_url_document}`)
  return lines.join('\n')
}

function formatTableauBlock(detailedTable: unknown): string {
  if (!detailedTable || typeof detailedTable !== 'object') {
    return 'Non encore généré — l\'utilisateur n\'a pas cliqué sur "Générer tableau détaillé".'
  }
  // On sérialise compactement les rubriques avec valeur non-vide,
  // pour ne pas exploser le contexte avec des "Non précisé".
  const NOISE = /non\s*pr[ée]cis|non\s*indiqu|non\s*encore|n[/.]?a$/i
  const t = detailedTable as Record<string, unknown>
  const lines: string[] = []

  function walk(prefix: string, val: unknown) {
    if (val == null) return
    if (typeof val === 'string') {
      const trimmed = val.trim()
      if (!trimmed || NOISE.test(trimmed)) return
      lines.push(`${prefix} : ${trimmed}`)
      return
    }
    if (typeof val === 'object' && !Array.isArray(val)) {
      for (const [k, v] of Object.entries(val)) {
        walk(prefix ? `${prefix} > ${k}` : k, v)
      }
    }
  }
  walk('', t)
  if (lines.length === 0) return 'Tableau présent mais sans valeurs renseignées.'
  return lines.join('\n')
}

function formatMonumentsBlock(monuments: unknown): string {
  if (!Array.isArray(monuments) || monuments.length === 0) {
    return 'Aucun monument historique dans 500m — pas de contrainte ABF à ce titre.'
  }
  const list = (monuments as Array<Record<string, unknown>>).slice(0, 10)
  const lines = list.map(m => {
    const parts = [`${m.name}`]
    if (m.protection) parts.push(String(m.protection))
    parts.push(`${m.distance_m}m`)
    if (m.century) parts.push(String(m.century))
    return `- ${parts.join(' — ')}`
  })
  const more = monuments.length - list.length
  if (more > 0) lines.push(`(+ ${more} autres)`)
  return `${monuments.length} MH dans 500m :\n${lines.join('\n')}`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (!GEMINI_API_KEY) {
    return jsonResponse({ error: 'GEMINI_API_KEY non configuré' }, 500)
  }

  // ── Auth ────────────────────────────────────────────────
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: 'Token manquant' }, 401)
  const token = authHeader.replace(/^Bearer\s+/i, '')

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) {
    return jsonResponse({ error: 'Session invalide' }, 401)
  }

  // ── Parse ───────────────────────────────────────────────
  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Corps JSON invalide' }, 400)
  }
  if (!body.analysis_id) return jsonResponse({ error: 'analysis_id requis' }, 400)
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonResponse({ error: 'messages doit être un tableau non vide' }, 400)
  }
  if (body.messages[body.messages.length - 1].role !== 'user') {
    return jsonResponse({ error: 'Le dernier message doit être de l\'utilisateur' }, 400)
  }

  // Sliding window: garder au plus N derniers messages pour limiter input tokens
  const messages = body.messages.slice(-MAX_HISTORY)

  // ── Charger l'analyse depuis DB (service role bypass RLS) ──
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const { data: analysis, error: analysisErr } = await adminClient
    .from('analyses_plu')
    .select('parcelle_commune, parcelle_section, parcelle_numero, parcelle_surface, zonage_libelle, zonage_type, zonage_url_document, detailed_table, monuments_historiques')
    .eq('id', body.analysis_id)
    .single()

  if (analysisErr || !analysis) {
    return jsonResponse({ error: 'Analyse introuvable' }, 404)
  }

  // ── Construction du system prompt ───────────────────────
  const parcelleBlock = formatParcelleBlock(analysis as Record<string, unknown>)
  const tableauBlock = formatTableauBlock(analysis.detailed_table)
  const monumentsBlock = formatMonumentsBlock(analysis.monuments_historiques)

  const FALLBACK_TEMPLATE = `ROLE: Expert urbanisme.
CONTEXTE PARCELLE
{{PARCELLE}}
TABLEAU
{{TABLEAU_DETAILLE}}
MONUMENTS
{{MONUMENTS}}
Réponds en max 6 phrases, factuel.`

  const { data: promptRow } = await adminClient
    .from('ai_prompts')
    .select('content')
    .eq('key', 'chat-plu')
    .single()

  const template = promptRow?.content || FALLBACK_TEMPLATE
  const systemInstruction = template
    .replaceAll('{{PARCELLE}}', parcelleBlock)
    .replaceAll('{{TABLEAU_DETAILLE}}', tableauBlock)
    .replaceAll('{{MONUMENTS}}', monumentsBlock)

  // ── Construction de l'historique pour Gemini ────────────
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  // ── Appel Gemini ────────────────────────────────────────
  const geminiResponse = await fetch(geminiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: {
        temperature: 0.3,
        topP: 0.9,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingBudget: 0 },  // pas de "thinking" pour économiser
      }
    })
  })

  if (!geminiResponse.ok) {
    const errText = await geminiResponse.text().catch(() => '')
    console.error('Gemini API error:', geminiResponse.status, errText)
    return jsonResponse({ error: `Erreur Gemini: ${geminiResponse.status}` }, 502)
  }

  const data = await geminiResponse.json()
  const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  if (!reply) {
    return jsonResponse({ error: 'Réponse Gemini vide', raw: data }, 502)
  }

  const usage = data?.usageMetadata || null
  return jsonResponse({
    reply,
    usage: usage ? {
      input_tokens: usage.promptTokenCount,
      output_tokens: usage.candidatesTokenCount,
      total_tokens: usage.totalTokenCount,
    } : undefined,
  })
})
