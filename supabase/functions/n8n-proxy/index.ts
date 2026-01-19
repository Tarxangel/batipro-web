// Supabase Edge Function - Proxy pour n8n webhook
// Contourne les restrictions CORS en relayant les requêtes vers n8n

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const N8N_WEBHOOK_URL = "https://n8n.batiproconcept.fr/webhook/batipro-article-generator"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Récupérer le body de la requête
    const body = await req.json()

    console.log('📤 Relaying request to n8n...')

    // Relayer vers n8n
    const n8nResponse = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)
    })

    // Récupérer la réponse de n8n
    const responseText = await n8nResponse.text()
    
    console.log('📥 n8n response status:', n8nResponse.status)

    // Parser la réponse si c'est du JSON
    let responseData
    try {
      responseData = JSON.parse(responseText)
    } catch {
      responseData = { raw: responseText }
    }

    // Retourner la réponse avec les headers CORS
    return new Response(
      JSON.stringify(responseData),
      {
        status: n8nResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    )

  } catch (error) {
    console.error('❌ Proxy error:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur proxy'
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    )
  }
})
