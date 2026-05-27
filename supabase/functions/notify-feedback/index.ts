// Supabase Edge Function - Notification email à l'admin lors d'un nouveau ticket SAV
// Calquée sur notify-review. Envoie un email via Resend à thibautlab@gmail.com
// quand un utilisateur soumet un ticket via la bulle feedback flottante.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ADMIN_EMAIL = 'thibautlab@gmail.com'
const FROM_EMAIL = 'Batipro SAV <contact@thibautlab.fr>'
const APP_FEEDBACK_URL = 'https://app.plu.batiproconcept.fr/admin.html#feedback'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
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
    const { userEmail, userName, page, message } = body as {
      userEmail?: string
      userName?: string | null
      page?: string
      message?: string
    }

    if (!message || !userEmail) {
      return new Response(
        JSON.stringify({ success: false, error: 'userEmail et message requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const safeUserEmail = escapeHtml(userEmail)
    const safeUserName = escapeHtml(userName || '(sans nom)')
    const safePage = escapeHtml(page || '(page inconnue)')
    const safeMessage = escapeHtml(message).replace(/\n/g, '<br>')

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a2e;">Nouveau ticket SAV</h2>
        <table style="width:100%; border-collapse:collapse; margin: 16px 0;">
          <tr><td style="padding:6px 0; color:#666;">Utilisateur</td><td><strong>${safeUserName}</strong> &lt;${safeUserEmail}&gt;</td></tr>
          <tr><td style="padding:6px 0; color:#666;">Page</td><td>${safePage}</td></tr>
        </table>
        <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 16px 0; white-space: pre-wrap;">
          ${safeMessage}
        </div>
        <p>
          <a href="${APP_FEEDBACK_URL}" style="display: inline-block; background: #f97316; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">
            Voir dans l'admin
          </a>
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
        from: FROM_EMAIL,
        to: ADMIN_EMAIL,
        reply_to: userEmail,
        subject: `[SAV Batipro] ${userName || userEmail} — ${message.slice(0, 60)}${message.length > 60 ? '…' : ''}`,
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
    console.error('Notify feedback error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur serveur'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
