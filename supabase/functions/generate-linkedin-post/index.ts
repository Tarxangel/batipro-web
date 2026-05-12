// Supabase Edge Function - Génération de post LinkedIn via Gemini
// Reçoit le titre, contenu et URL d'un article publié et retourne un post LinkedIn prêt à copier
//
// Le prompt est chargé depuis la table ai_prompts (key='linkedin-post') pour
// pouvoir être édité depuis l'interface admin. Un fallback en dur reste présent
// au cas où la table serait indisponible.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const FALLBACK_LINKEDIN_PROMPT = `Tu rédiges un post LinkedIn pour Batipro Concept (bâtiments industriels & logistiques, Bourgogne-Franche-Comté / Grand Est).

Article publié :
Titre : {{TITLE}}
Contenu : {{CONTENT}}
URL : {{ARTICLE_URL}}

Rédige un post LinkedIn moderne et percutant. Règles strictes :

STYLE :
- Ton direct, énergique, phrases courtes. Pas de langage corporate creux.
- INTERDIT : "Chez Batipro Concept, nous sommes fiers/heureux de...", "nous avons le plaisir", "nous sommes ravis". Ces formulations sont ringardes.
- Privilégie les faits concrets : chiffres, m², tonnes, défis techniques résolus.
- Utilise des sauts de ligne pour aérer (style LinkedIn moderne).
- Le nom Batipro Concept peut apparaître mais de façon naturelle, jamais en ouverture de phrase.

STRUCTURE :
1. Accroche forte en 1 ligne (fait marquant, question provocante ou stat impactante)
2. 3-5 phrases courtes qui racontent le projet (contexte, défi, solution)
3. 1 phrase d'appel à l'action vers l'article
4. Le lien {{ARTICLE_URL}}
5. 3-5 hashtags pertinents

Longueur : 120-200 mots.
Écris uniquement le post, rien d'autre.`

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY env var not set')
    return new Response(
      JSON.stringify({ success: false, error: 'Configuration serveur manquante' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const { title, content, articleUrl } = body

    if (!title || !content || !articleUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'title, content et articleUrl requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Nettoyer le HTML et limiter la taille (les premiers 3000 chars suffisent pour un post LinkedIn)
    const cleanContent = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000)

    // Charge le template depuis ai_prompts (éditable depuis l'admin),
    // fallback sur le prompt en dur si la DB ne répond pas.
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { data: promptRow } = await supabase
      .from('ai_prompts')
      .select('content')
      .eq('key', 'linkedin-post')
      .single()

    const template = promptRow?.content || FALLBACK_LINKEDIN_PROMPT
    const prompt = template
      .replaceAll('{{TITLE}}', title)
      .replaceAll('{{CONTENT}}', cleanContent)
      .replaceAll('{{ARTICLE_URL}}', articleUrl)

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
            thinkingConfig: {
              thinkingBudget: 0
            }
          }
        })
      }
    )

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text()
      console.error('Gemini API error:', errorText)
      throw new Error(`Gemini API error: ${geminiResponse.status}`)
    }

    const geminiData = await geminiResponse.json()
    const post = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || ''

    if (!post) {
      throw new Error('Réponse Gemini vide')
    }

    return new Response(
      JSON.stringify({ success: true, post }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('LinkedIn post generation error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur serveur'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
