// Supabase Edge Function - Résumé de l'historique d'un chantier via Gemini
// Reçoit les descriptions des articles précédents et retourne un résumé

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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
    const descriptions: string[] = body.descriptions

    if (!descriptions || !Array.isArray(descriptions) || descriptions.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'descriptions[] requis et non vide' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Construire le prompt pour Gemini
    const descriptionsText = descriptions
      .map((desc, i) => `Visite ${i + 1}: ${desc}`)
      .join('\n\n')

    const prompt = `Tu es un assistant spécialisé dans le suivi de chantiers de construction de bâtiments industriels et logistiques.

Voici les descriptions des visites de chantier précédentes, dans l'ordre chronologique :

${descriptionsText}

Résume en 2-3 paragraphes concis l'historique de ce chantier :
- Quels travaux ont été réalisés et dans quel ordre
- Où en est l'avancement global
- Quels points clés à retenir pour la rédaction du prochain article de suivi

Écris en français, de manière factuelle et professionnelle. Ne répète pas mot pour mot les descriptions, synthétise.`

    // Appeler Gemini
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 500
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
    const summary = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || ''

    if (!summary) {
      throw new Error('Réponse Gemini vide')
    }

    return new Response(
      JSON.stringify({ success: true, summary }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Summarize error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur serveur'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
