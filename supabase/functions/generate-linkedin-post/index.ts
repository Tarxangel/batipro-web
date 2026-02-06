// Supabase Edge Function - Génération de post LinkedIn via Gemini
// Reçoit le titre, contenu et URL d'un article publié et retourne un post LinkedIn prêt à copier

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
    const { title, content, articleUrl } = body

    if (!title || !content || !articleUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'title, content et articleUrl requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Nettoyer le HTML et limiter la taille (les premiers 3000 chars suffisent pour un post LinkedIn)
    const cleanContent = content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000)

    const prompt = `Tu es le dirigeant de Batipro Concept, une entreprise spécialisée dans la construction de bâtiments industriels et logistiques en Bourgogne-Franche-Comté et Grand Est.

Tu viens de publier cet article sur ton site :
Titre : ${title}
Contenu : ${cleanContent}
URL : ${articleUrl}

Rédige un post LinkedIn professionnel et engageant pour partager cet article. Règles :
- Commence par une accroche percutante (question ou affirmation forte) qui donne envie de lire
- Résume les points clés de l'article en 3-4 phrases concises
- Adopte un ton professionnel mais accessible, fier du travail accompli
- Termine par un appel à l'action invitant à lire l'article complet
- Ajoute 3-5 hashtags pertinents (#BTP #Construction #Industrie etc.)
- Ajoute le lien vers l'article à la fin
- Longueur totale : 150-250 mots

Écris uniquement le post, sans commentaire ni explication.`

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
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
