// Amélioration IA de rendus architecturaux (Lumion → photoréaliste + esquisse).
//
// Prend un rendu 3D brut et produit un visuel enrichi en CONSERVANT
// strictement la géométrie du bâtiment — seuls l'ambiance lumineuse, les
// matériaux, la végétation et le paysagisme sont retravaillés.
//
// Moteur : Gemini "Nano Banana Pro" (gemini-3-pro-image-preview) en édition
// d'image, fallback Nano Banana (gemini-2.5-flash-image). Validé en POC le
// 2026-06-04 : tient la géométrie sans ControlNet (cf. services/lumion-poc).
//
// Modes :
//   - photoreal : rendu photoréaliste haut de gamme depuis la source
//   - sketch    : esquisse architecte (trait + aquarelle) depuis la source
//   - refine    : applique une instruction libre sur une image déjà générée
//   - upscale   : monte la résolution (2K/4K) sans rien redessiner
//
// Accès : ADMIN UNIQUEMENT (vérifié via app_profiles.is_admin).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

// Modèles image, testés dans l'ordre (le premier qui rend une image gagne).
const IMAGE_MODELS = [
  'gemini-3-pro-image-preview', // Nano Banana Pro — fidélité + 2K/4K
  'gemini-2.5-flash-image',     // Nano Banana — fallback stable
]

function geminiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ── Presets → texte de prompt ─────────────────────────────

interface Presets {
  heure?: string
  intensite?: string
  ambiance?: string
  vegetation?: string
  saison?: string
  ciel?: string
  localisation?: string
  details?: string
}

type Mode = 'photoreal' | 'sketch' | 'refine' | 'upscale'

function geometryLock(details?: string): string {
  const extra = details && details.trim()
    ? `\nÉléments à conserver impérativement (consigne de l'utilisateur) : ${details.trim()}.`
    : ''
  return `RÈGLE ABSOLUE — FIDÉLITÉ GÉOMÉTRIQUE :
L'image fournie est la référence géométrique UNIQUE. Reproduis à l'identique,
sans aucune modification : les volumes, proportions, hauteurs, alignements,
TOUTES les ouvertures (fenêtres et portes), les menuiseries, les matériaux et
bardages, les acrotères, les vitrages, les logos/enseignes à leur position
exacte, le stationnement, les clôtures, les accès et les véhicules.
Aucune ouverture déplacée, ajoutée ou supprimée. Aucun élément architectural
inventé. Tu n'améliores QUE : l'ambiance lumineuse, le rendu des matériaux, la
végétation et la qualité paysagère. Cadrage et point de vue strictement
identiques à la source. Image plein cadre, sans cartouche, titre, logo
d'agence, légende ni montage.${extra}`
}

function vegetationRules(p: Presets): string {
  const loc = p.localisation && p.localisation.trim()
    ? p.localisation.trim()
    : 'France métropolitaine (adapter au climat local réel)'
  const saison = p.saison && p.saison !== 'auto'
    ? ` Saison : ${p.saison} (feuillages et floraisons cohérents avec la saison).`
    : ''
  return `VÉGÉTATION : cohérente avec le climat et l'altitude réels du lieu —
localisation : ${loc}. Essences réalistes, pérennes, adaptées au climat local
(éviter toute plante de climat doux/méditerranéen si le lieu ne s'y prête pas :
pas de palmiers, oliviers, lauriers roses, agaves hors contexte méditerranéen).
Aménagement élégant, contemporain, sobre, comme conçu par un architecte
paysagiste professionnel.${saison}`
}

function buildPhotorealPrompt(p: Presets): string {
  const heure = p.heure || 'tombée du jour'
  const intensite = p.intensite || 'moyenne'
  const ambiance = p.ambiance || 'chaleureuse'
  const vegetation = p.vegetation || 'paysagisme haut de gamme'
  const ciel = p.ciel && p.ciel !== 'auto'
    ? p.ciel
    : 'ciel riche cohérent avec l\'heure (dégradé naturel)'
  return `Produis UN SEUL rendu photoréaliste architectural haut de gamme à partir
de cette image, qualité photographie d'architecture professionnelle / rendu concours.

${geometryLock(p.details)}

AMBIANCE DEMANDÉE :
- Heure : ${heure}
- Intensité de la lumière intérieure : ${intensite} (éclairage chaud réaliste de
  bureaux/locaux occupés, bien visible et chaleureux dans les vitrages ; éclairage
  d'entrée venant du plafond/auvent ; éclairage paysager discret au sol dans les
  massifs plantés (uplights doux rasant la végétation le long de la façade) ; AUCUN
  éclairage dans le bitume ni dans les surfaces béton/pierre ; aucun spot inventé au
  premier plan ; aucun effet spectaculaire artificiel)
- Tonalité générale : ${ambiance}
- Ciel : ${ciel}
- Niveau de végétalisation : ${vegetation}

${vegetationRules(p)}

La fidélité architecturale prime sur l'esthétique. Sortie : une image unique, plein cadre.`
}

function buildSketchPrompt(p: Presets): string {
  const vegetation = p.vegetation || 'paysagisme haut de gamme'
  return `Produis UNE SEULE esquisse architecturale couleur à partir de cette image :
croquis d'architecte professionnel dessiné à la main, encre noire fine + aquarelle
légère, style carnet d'architecte haut de gamme.

${geometryLock(p.details)}

Style de trait : trait d'architecte LÂCHE et vivant, lignes d'encre qui DÉBORDENT
légèrement des angles et se prolongent au-delà des coins, lavis d'aquarelle
transparents et légers, bords de l'image qui s'estompent vers le blanc (effet
vignette carnet de croquis, papier visible aux marges), ciel suggéré en quelques
traits légers. Caractère « croquis pris sur le vif », pas un trait propre et figé.
Même géométrie, même cadrage, mêmes ouvertures et proportions que la source.
Végétation cohérente : ${vegetation}. ${p.localisation ? 'Localisation : ' + p.localisation + '.' : ''}
Sortie : une image unique, plein cadre, sans cartouche ni légende.`
}

function buildRefinePrompt(instructions: string, details?: string): string {
  return `Voici une image de rendu architectural déjà produite. Applique UNIQUEMENT
la modification demandée par l'utilisateur, sans rien changer d'autre.

MODIFICATION DEMANDÉE : ${instructions}

${geometryLock(details)}
Ne touche à rien d'autre que ce qui est explicitement demandé ci-dessus. Garde le
style, le cadrage et tous les autres éléments rigoureusement identiques.
Sortie : une image unique, plein cadre.`
}

const UPSCALE_PROMPT = `Augmente la résolution et la netteté de cette image pour une
impression A3 haute définition. RÈGLE ABSOLUE : ne change strictement RIEN au contenu —
cadrage identique, géométrie identique, mêmes couleurs, mêmes matériaux, mêmes
ouvertures, mêmes véhicules, mêmes personnages, même végétation, même ambiance
lumineuse. Tu n'augmentes QUE la finesse des détails et la netteté (textures,
feuillages, reflets). Aucun ajout, aucune suppression, aucun recadrage. Image unique
plein cadre, sans cartouche ni légende.`

function buildPrompt(mode: Mode, presets: Presets, instructions?: string): string {
  switch (mode) {
    case 'photoreal': return buildPhotorealPrompt(presets)
    case 'sketch':    return buildSketchPrompt(presets)
    case 'refine':    return buildRefinePrompt(instructions || 'améliore légèrement le réalisme', presets.details)
    case 'upscale':   return UPSCALE_PROMPT
  }
}

// ── Appel image avec fallback de modèle ───────────────────

async function generateImage(
  prompt: string,
  imageB64: string,
  mime: string,
  size: string,
): Promise<{ image: string; mime: string; model: string }> {
  let lastErr = 'inconnue'
  for (const model of IMAGE_MODELS) {
    try {
      const resp = await fetch(geminiUrl(model), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: mime, data: imageB64 } },
              { text: prompt },
            ],
          }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: '16:9', imageSize: size },
          },
        }),
      })
      if (!resp.ok) {
        lastErr = `${model} → HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`
        console.error(lastErr)
        continue
      }
      const data = await resp.json()
      const parts = data?.candidates?.[0]?.content?.parts || []
      for (const part of parts) {
        const inline = part.inlineData || part.inline_data
        if (inline?.data) {
          return { image: inline.data, mime: inline.mimeType || 'image/png', model }
        }
      }
      lastErr = `${model} → pas d'image dans la réponse`
      console.error(lastErr, JSON.stringify(data).slice(0, 300))
    } catch (e) {
      lastErr = `${model} → ${e instanceof Error ? e.message : String(e)}`
      console.error(lastErr)
    }
  }
  throw new Error(lastErr)
}

// ── Handler ───────────────────────────────────────────────

interface RequestBody {
  image: string        // base64 sans préfixe data:
  mime?: string
  mode: Mode
  presets?: Presets
  instructions?: string
  size?: '1K' | '2K' | '4K'
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

  // ── Auth : token requis ─────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ success: false, error: 'Token manquant' }, 401)
  const token = authHeader.replace(/^Bearer\s+/i, '')

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) {
    return jsonResponse({ success: false, error: 'Session invalide' }, 401)
  }

  // ── Garde admin ─────────────────────────────────────────
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: profile } = await adminClient
    .from('app_profiles')
    .select('is_admin')
    .eq('id', userData.user.id)
    .single()
  if (!profile?.is_admin) {
    return jsonResponse({ success: false, error: 'Accès réservé aux administrateurs' }, 403)
  }

  // ── Parse ───────────────────────────────────────────────
  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ success: false, error: 'Corps JSON invalide' }, 400)
  }
  if (!body.image) {
    return jsonResponse({ success: false, error: 'image (base64) requise' }, 400)
  }
  const mode: Mode = body.mode || 'photoreal'
  if (!['photoreal', 'sketch', 'refine', 'upscale'].includes(mode)) {
    return jsonResponse({ success: false, error: 'mode invalide' }, 400)
  }
  // Itérations en 1K (rapide/pas cher) ; 4K réservé à l'upscale final.
  const size = body.size || (mode === 'upscale' ? '4K' : '1K')
  const mime = body.mime || 'image/png'
  const prompt = buildPrompt(mode, body.presets || {}, body.instructions)

  try {
    const out = await generateImage(prompt, body.image, mime, size)
    return jsonResponse({ success: true, ...out })
  } catch (e) {
    return jsonResponse({
      success: false,
      error: e instanceof Error ? e.message : 'Échec de génération',
    }, 502)
  }
})
