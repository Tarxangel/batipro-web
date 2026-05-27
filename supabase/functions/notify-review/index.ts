// Supabase Edge Function - Notification email lors de la soumission d'un article
// Envoie un email via Resend à l'admin pour valider l'article

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

  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY env var not set')
    return new Response(
      JSON.stringify({ success: false, error: 'Configuration serveur manquante' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json()
    const { title, articleId } = body

    if (!title || !articleId) {
      return new Response(
        JSON.stringify({ success: false, error: 'title et articleId requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const appUrl = 'https://app.plu.batiproconcept.fr/articles.html'

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a2e;">Nouvel article à valider</h2>
        <p>Un article vient d'être soumis pour validation :</p>
        <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0;">
          <strong>${title}</strong>
        </div>
        <p>
          <a href="${appUrl}" style="display: inline-block; background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
            Voir l'article dans l'app
          </a>
        </p>
        <p style="color: #666; font-size: 14px; margin-top: 24px;">
          Connectez-vous en mode admin pour relire et publier l'article.
        </p>
      </div>
    `

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'Batipro App <contact@thibautlab.fr>',
        to: ['sebastien.pheulpin@batiproconcept.fr', 'tatiana.hodille@batiproconcept.fr'],
        subject: `Nouvel article à valider : ${title}`,
        html: htmlBody
      })
    })

    if (!resendResponse.ok) {
      const errorText = await resendResponse.text()
      console.error('Resend API error:', errorText)
      throw new Error(`Resend API error: ${resendResponse.status}`)
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Notify review error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur serveur'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
