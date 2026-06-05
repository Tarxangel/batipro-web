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

const FALLBACK_LINKEDIN_PROMPT = `Tu écris un post LinkedIn à la PREMIÈRE PERSONNE pour quelqu'un de Batipro Concept (bâtiments industriels & logistiques, Bourgogne-Franche-Comté / Grand Est). Objectif central : que ça sonne comme un VRAI pro du bâtiment qui raconte son chantier à un confrère — surtout PAS comme un post généré par IA. LinkedIn pénalise les posts qui sentent l'IA ; ton job est qu'on n'y voie que du feu.

Article publié (source d'infos, à NE PAS recopier ni résumer mécaniquement) :
Titre : {{TITLE}}
Contenu : {{CONTENT}}
URL : {{ARTICLE_URL}}

=== VOIX HUMAINE (à faire) ===
- Première personne : "on", "j'ai", "notre équipe". Comme si tu racontais ta semaine de boulot.
- Démarre par un détail CONCRET et vécu : un imprévu sur le chantier, une contrainte technique, un moment précis, un chiffre qui parle (m², tonnes, délai, météo, dénivelé...).
- Rythme NATUREL et irrégulier : alterne phrases courtes et plus longues. Une tournure orale de temps en temps ("franchement", "au final", "pas évident", "honnêtement"). Ça doit respirer l'humain, pas le gabarit.
- Reste spécifique à CE chantier : si une phrase pourrait coller à n'importe quel projet, supprime-la.
- Une petite opinion, une fierté discrète ou une leçon tirée, c'est bienvenu.

=== CE QUI SENT L'IA / LE SPAM (interdit) ===
- Pas d'accroche bateau : "🚀", "Fier de vous annoncer", "Heureux/Ravi de partager", "C'est avec plaisir que".
- Pas de listes à puces, pas d'emojis décoratifs en pagaille (1 emoji grand max, idéalement zéro).
- Pas de tirets cadratins (—), pas de structure trop léchée ou symétrique.
- Pas de CTA robotique : "Et vous, qu'en pensez-vous ?", "N'hésitez pas à...", "Dites-moi en commentaire".
- Pas de jargon marketing : "solution clé en main", "savoir-faire d'exception", "au cœur de nos préoccupations", "acteur incontournable".
- 3 hashtags MAXIMUM, simples et pertinents. Jamais un mur de hashtags.

=== FORME ===
- 80-150 mots. Plutôt court. Quelques sauts de ligne pour aérer.
- Amène le lien {{ARTICLE_URL}} naturellement, sur sa propre ligne en fin de post.
- 1 à 3 hashtags max tout à la fin.

Écris UNIQUEMENT le post, prêt à publier, rien d'autre.`

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
            temperature: 0.9,
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
