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

const FALLBACK_LINKEDIN_PROMPT = `Tu rédiges un post LinkedIn PROFESSIONNEL pour Batipro Concept, entreprise de construction de bâtiments industriels, logistiques et tertiaires (Bourgogne-Franche-Comté / Grand Est). Le post accompagne la publication d'un article de chantier. Objectif : valoriser le savoir-faire de l'entreprise de façon crédible et professionnelle, optimisée pour la visibilité LinkedIn, sans tomber dans le post « généré par IA ».

Article publié (source d'infos, à NE PAS recopier tel quel) :
Titre : {{TITLE}}
Contenu : {{CONTENT}}
URL : {{ARTICLE_URL}}

=== TON ===
- Professionnel, posé, expert. Tu représentes une entreprise du bâtiment sérieuse et reconnue.
- « Nous » / « nos équipes » / « notre bureau d'études ». Pas de registre familier, pas d'argot, jamais de « je préfère », « franchement », « galérer ».
- Crédible et concret : tu démontres la maîtrise technique par des faits (matériaux, méthodes, contraintes, chiffres), sans jargon marketing.
- Reste lisible et vivant : ce n'est pas un communiqué rigide, mais ça reste corporate-professionnel.

=== SEO / VISIBILITÉ LINKEDIN ===
- ACCROCHE (1re ligne, ~150 caractères max — c'est ce qui s'affiche avant « voir plus ») : informative et engageante, avec le TYPE D'OUVRAGE/l'opération + la LOCALISATION. Elle doit donner envie de déplier.
- Intègre NATURELLEMENT les mots-clés du secteur tirés du contenu (type de bâtiment, technique/ouvrage, matériau, ville/région) : ils aident la recherche et la portée LinkedIn. Aucun bourrage de mots-clés.
- Texte AÉRÉ : courts paragraphes séparés par des sauts de ligne (lecture mobile).
- 3 à 5 HASHTAGS pertinents en fin : un mix portée large (#BTP #Construction) + métier (#CharpenteMétallique, #BâtimentIndustriel…) + local (#GrandEst ou la ville/dpt). Multi-mots en CamelCase.

=== À ÉVITER (sent l'IA / nuit à la crédibilité) ===
- Argot, ton familier, première personne du singulier intime, emojis en pagaille (0, à la rigueur 1).
- Jargon creux : « fier de vous annoncer », « savoir-faire d'exception », « acteur incontournable », « au cœur de nos préoccupations », « solution clé en main », « alliant tradition et modernité ».
- Accroche « 🚀 », listes à puces avec emojis, tirets cadratins (—), CTA robotique (« et vous, qu'en pensez-vous ? », « n'hésitez pas à »).

=== FORME ===
- 100 à 180 mots.
- Termine par le lien {{ARTICLE_URL}} sur sa propre ligne, introduit sobrement (ex : « Plus de détails sur le projet : »).
- Puis les 3 à 5 hashtags.

Écris UNIQUEMENT le post final, prêt à publier, rien d'autre.`

// Mode "retravailler" : applique une consigne sur un post existant.
function buildReworkPrompt(currentPost: string, instruction: string): string {
  return `Voici un post LinkedIn existant pour Batipro Concept (entreprise de construction de bâtiments industriels/logistiques, Grand Est / BFC) :
---
${currentPost}
---
Retravaille-le selon cette consigne : « ${instruction} ».
Conserve un ton PROFESSIONNEL et les bonnes pratiques : accroche forte en 1re ligne, mots-clés sectoriels naturels, texte aéré, 3 à 5 hashtags pertinents, AUCUN emoji en pagaille, aucun jargon marketing creux, pas d'argot.
Réponds UNIQUEMENT avec le post final retravaillé, rien d'autre.`
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
    const { title, content, articleUrl, currentPost, instruction } = body

    // Deux modes :
    //   - rework  : { currentPost, instruction } → retravaille un post existant
    //   - fresh   : { title, content, articleUrl } → génère depuis l'article
    const isRework = !!(currentPost && instruction)

    if (!isRework && (!title || !content || !articleUrl)) {
      return new Response(
        JSON.stringify({ success: false, error: 'title, content et articleUrl requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let prompt: string
    if (isRework) {
      prompt = buildReworkPrompt(String(currentPost), String(instruction))
    } else {
      // Nettoyer le HTML et limiter la taille
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
      prompt = template
        .replaceAll('{{TITLE}}', title)
        .replaceAll('{{CONTENT}}', cleanContent)
        .replaceAll('{{ARTICLE_URL}}', articleUrl)
    }

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
