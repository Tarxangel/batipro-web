// Edge Function rewrite-selection
//
// Appelée depuis l'éditeur d'article (mode Canvas) quand l'utilisateur
// sélectionne un passage et demande une modification ciblée.
//
// Reçoit { full_article, selection, instruction, chantier_id? }
// Renvoie { success, rewritten } où rewritten est le texte de remplacement
// (HTML simple, prêt à être inséré à la place du passage d'origine).
//
// Le prompt système est chargé depuis ai_prompts (slot 'rewrite-selection'),
// éditable depuis l'admin. Fallback inline en cas d'indisponibilité.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!
const GEMINI_MODEL = 'gemini-3-flash-preview' // flash : édition ponctuelle, doit être rapide

function geminiUrl(): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`
}

interface RequestBody {
  full_article: string
  selection: string
  instruction: string
  chantier_id?: string
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

  if (!GEMINI_API_KEY) {
    return jsonResponse({ success: false, error: 'GEMINI_API_KEY non configuré' }, 500)
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // ── Auth de l'appelant ──────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ success: false, error: 'Token manquant' }, 401)
  const token = authHeader.replace(/^Bearer\s+/i, '')

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) {
    return jsonResponse({ success: false, error: 'Session invalide' }, 401)
  }

  // ── Parse ───────────────────────────────────────────────
  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ success: false, error: 'Corps JSON invalide' }, 400)
  }

  if (!body.full_article || !body.selection || !body.instruction) {
    return jsonResponse({ success: false, error: 'full_article, selection et instruction sont requis' }, 400)
  }

  // Limite défensive : on ne veut pas envoyer un article de 50k caractères
  const fullArticle = body.full_article.slice(0, 20000)
  const selection = body.selection.slice(0, 5000)
  const instruction = body.instruction.slice(0, 500)

  // ── Chargement du prompt depuis ai_prompts ──────────────
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const { data: promptRow } = await adminClient
    .from('ai_prompts')
    .select('content')
    .eq('key', 'rewrite-selection')
    .single()

  const template = promptRow?.content || FALLBACK_PROMPT
  const systemInstruction = template
    .replaceAll('{{FULL_ARTICLE}}', fullArticle)
    .replaceAll('{{SELECTION}}', selection)
    .replaceAll('{{INSTRUCTION}}', instruction)

  // ── Appel Gemini ────────────────────────────────────────
  const geminiResponse = await fetch(geminiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [
        { role: 'user', parts: [{ text: 'Réécris le passage sélectionné selon la consigne.' }] }
      ],
      generationConfig: {
        temperature: 0.5,
        topP: 0.9,
        maxOutputTokens: 4000,
        responseMimeType: 'application/json',
      }
    })
  })

  if (!geminiResponse.ok) {
    const errText = await geminiResponse.text().catch(() => '')
    console.error('Gemini error:', geminiResponse.status, errText)
    return jsonResponse({ success: false, error: `Erreur Gemini ${geminiResponse.status}` }, 502)
  }

  const result = await geminiResponse.json()
  if (result.error) {
    return jsonResponse({ success: false, error: result.error.message }, 502)
  }

  const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text
  if (!rawText) {
    return jsonResponse({ success: false, error: 'Réponse Gemini vide' }, 502)
  }

  let parsed: { rewritten?: string }
  try {
    parsed = JSON.parse(rawText)
  } catch {
    // Si pas de JSON valide, on prend le texte brut
    return jsonResponse({ success: true, rewritten: rawText.trim() })
  }

  if (!parsed.rewritten) {
    return jsonResponse({ success: false, error: 'Champ rewritten manquant dans la réponse' }, 502)
  }

  return jsonResponse({ success: true, rewritten: parsed.rewritten.trim() })
})

// Fallback minimal si la table ai_prompts ne répond pas
const FALLBACK_PROMPT = `Tu es un journaliste BTP qui retouche un passage précis d'un article. L'utilisateur a sélectionné un fragment du texte et te demande de le modifier.

ARTICLE COMPLET (POUR CONTEXTE) :
{{FULL_ARTICLE}}

PASSAGE SÉLECTIONNÉ (À RÉÉCRIRE) :
{{SELECTION}}

CONSIGNE :
{{INSTRUCTION}}

Règles :
- Réécris UNIQUEMENT le passage sélectionné.
- Préserve le format (texte brut si fragment, balises HTML si paragraphes complets).
- Ton journalistique BTP, factuel, pas de formules creuses.
- N'invente aucun fait technique absent de l'article ou de la consigne.

Réponds avec un JSON :
{ "rewritten": "Le passage réécrit." }`
