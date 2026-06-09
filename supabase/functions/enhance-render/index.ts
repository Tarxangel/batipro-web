// Amélioration IA de rendus architecturaux (Lumion → photoréaliste + esquisse).
//
// Prend un rendu 3D brut et produit un visuel enrichi en CONSERVANT
// strictement la géométrie du bâtiment — seuls l'ambiance lumineuse, les
// matériaux, la végétation et le paysagisme sont retravaillés.
//
// Moteur : OpenAI gpt-image-2 en édition d'image (/v1/images/edits). 16:9 natif
// jusqu'à 3840px (4K UHD), sort directement une version HD imprimable — pas
// d'étape d'upscale séparée. (Bascule depuis Gemini Nano Banana le 2026-06-05.)
//
// Modes :
//   - photoreal : rendu photoréaliste HD imprimable depuis la source
//   - sketch    : esquisse architecte (trait + aquarelle) depuis la source
//   - refine    : applique une instruction libre sur une image déjà générée
//   - upscale   : régénère en 4K (optionnel — la base est déjà HD)
//   - detect    : liste les matériaux visibles (vision → texte)
//
// Accès : ADMIN UNIQUEMENT (vérifié via app_profiles.is_admin).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!

// Moteur image OpenAI (le dernier modèle dispo) + modèle vision pour la détection.
const OPENAI_IMAGE_MODEL = 'gpt-image-2'
const OPENAI_VISION_MODEL = 'gpt-4o-mini'

// Token de taille (1K/2K/4K) → dimension pixel 16:9 valide pour gpt-image-2
// (côté le plus long ≤ 3840, dimensions multiples de 16).
function sizePx(token?: string): string {
  switch (token) {
    case '4K': return '3840x2160'
    case '1K': return '1536x864'
    case '2K':
    default:   return '2560x1440' // QHD 16:9 — HD imprimable par défaut
  }
}

// base64 (sans préfixe) → octets, pour l'upload multipart vers /v1/images/edits.
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
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
  intensite?: string   // 'aucune' | 'faible' | 'moyenne' | 'forte'
  facade?: string      // 'aucun' | 'indirect'  (éclairage indirect de façade)
  ambiance?: string
  vegetation?: string
  saison?: string
  ciel?: string
  localisation?: string
  materiaux?: string   // matériaux déclarés/corrigés par l'utilisateur
  details?: string
  realisme?: boolean   // true = pousser le rendu vers le photoréalisme (casser le look 3D)
}

type Mode = 'photoreal' | 'sketch' | 'refine' | 'upscale' | 'detect'

// Bloc matériaux déclarés par l'utilisateur — fait autorité sur la perception du
// modèle (corrige notamment les Trespa pris pour de la pierre).
function materialsRules(p: Presets): string {
  if (!p.materiaux || !p.materiaux.trim()) return ''
  return `\nMATÉRIAUX DÉCLARÉS PAR L'UTILISATEUR (fait AUTORITÉ, prioritaire sur ta
perception — ne pas requalifier) : ${p.materiaux.trim()}.`
}

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
d'agence, légende ni montage.
LOGOS BATIPRO — À PRÉSERVER FIDÈLEMENT : conserve le logo « Batipro » en bas à
gauche de l'image à sa position, taille et lisibilité exactes (ne pas le
recouvrir, le déplacer, le flouter ni l'effacer). Conserve également, sans le
déformer ni le faire disparaître, le logo Batipro figurant sur les véhicules de
la scène (notamment la camionnette / le véhicule utilitaire blanc) : il doit
rester net et identique à la source.
MATÉRIAUX — NE RIEN REQUALIFIER : reproduis les matériaux exactement tels qu'ils
apparaissent dans la source, sans réinterpréter leur nature (ne pas transformer
un bardage type Trespa / panneau composite en pierre ou en brique, ni l'inverse).
Tu n'améliores que la qualité de rendu (texture, reflets) du matériau réel.${extra}`
}

function vegetationRules(p: Presets): string {
  const loc = p.localisation && p.localisation.trim()
    ? p.localisation.trim()
    : 'France métropolitaine (adapter au climat local réel)'
  const saison = p.saison && p.saison !== 'auto'
    ? ` Saison : ${p.saison} (feuillages et floraisons cohérents avec la saison).`
    : ''
  return `VÉGÉTATION : cohérente avec le climat et l'altitude réels du lieu —
localisation : ${loc}. Essences réalistes, pérennes, adaptées au climat local.
INTERDIT (hors contexte méditerranéen réel) : palmiers, oliviers, lauriers roses,
agaves, et toute plante de climat doux/méditerranéen.
AUTORISÉ / À PRIVILÉGIER : graminées rustiques (miscanthus, calamagrostis,
pennisetum rustique, carex), lavandes rustiques adaptées, sauges vivaces,
échinacées, géraniums vivaces, népétas, hortensias, cornouillers, amélanchiers,
bouleaux, érables champêtres, pins de montagne, épicéas, végétation de climat
montagnard ou continental.
Aménagement élégant, contemporain, sobre, pérenne, comme conçu par un architecte
paysagiste professionnel, cohérent avec un budget de projet tertiaire haut de gamme.${saison}`
}

// Construit le bloc d'éclairage en fonction des presets (intérieur, façade) et
// applique les contraintes dures de Sébastien : pas de lumière dans les enrobés.
function lightingRules(p: Presets): string {
  const intensite = p.intensite || 'moyenne'
  const facade = p.facade || 'aucun'

  // ── Lumière intérieure ──
  let interieur: string
  if (intensite === 'aucune' || intensite === 'éteint' || intensite === 'aucun') {
    interieur = `AUCUN éclairage intérieur : les vitrages restent sombres et non
  éclairés, bâtiment présenté inoccupé. N'allume aucune fenêtre, aucun plafonnier,
  aucune lumière visible à travers les vitres.`
  } else {
    interieur = `Éclairage intérieur chaud et réaliste de locaux occupés, visible dans
  les vitrages, d'intensité ${intensite} (rester naturel, sans surbrillance) ;
  éclairage d'entrée venant du plafond/auvent.`
  }

  // ── Éclairage de façade : optionnel et DÉSACTIVÉ par défaut ──
  // Par défaut Batipro ne met JAMAIS de lumière rapportée. On n'autorise un
  // lèche-mur discret QUE si l'utilisateur le demande explicitement (facade='indirect').
  const facadeTxt = (facade === 'indirect' || facade === 'indirect discret')
    ? `\n- Éclairage de façade : indirect et TRÈS DISCRET — lèche-mur doux et diffus
  qui rase la façade, halo léger sans source lumineuse visible, sans surbrillance
  marquée ni effet spectaculaire. Doit rester subtil.`
    : `\n- INTERDICTION ABSOLUE — ÉCLAIRAGE DE FAÇADE : n'ajoute AUCUN éclairage
  artificiel rapporté sur la façade. Spécifiquement INTERDITS : les spots/uplights
  en contre-plongée au pied du bâtiment qui éclairent le mur de bas en haut, les
  lèche-murs, les bandeaux LED, les halos lumineux et toute traînée de lumière
  rasant ou remontant la façade pour la "mettre en valeur". La façade n'est
  éclairée QUE par la lumière ambiante naturelle de l'heure et reste sombre là où
  le ciel ne l'éclaire pas. Aucune façade illuminée artificiellement, même de nuit.`

  return `ÉCLAIRAGE :
- Intérieur : ${interieur}${facadeTxt}
- INTERDICTION ABSOLUE — AUCUN éclairage extérieur artificiel rapporté dans la
  scène. N'ajoute AUCUNE source de lumière au sol : pas de spots, pas d'uplights,
  pas de bornes, pas de balises, pas de projecteurs encastrés, pas de halos ni de
  taches lumineuses — NI dans les massifs plantés, NI dans les pelouses / l'herbe,
  NI le long du bâtiment ou en pied de façade, NI dans les bordures, allées,
  cheminements, enrobés, bitume, asphalte, voiries, parkings, béton ou pierre.
  Aucun liseré lumineux au sol qui suit le contour du bâtiment. Le sol, les massifs
  et la pelouse restent SOMBRES et MATS, éclairés UNIQUEMENT par la lumière
  ambiante naturelle de l'heure. Aucun éclairage inventé au premier plan, aucun
  effet artificiel spectaculaire. (Seul l'éclairage intérieur visible par les
  vitrages est autorisé.)`
}

// Bloc optionnel (case « Réalisme photo renforcé ») : casse le look CGI / rendu
// 3D en injectant des indices photographiques réels. NE TOUCHE PAS à la géométrie.
function realismRules(p: Presets): string {
  if (p.realisme !== true) return ''
  const base = `\nRÉALISME PHOTOGRAPHIQUE RENFORCÉ — l'objectif est qu'on NE puisse PAS
deviner qu'il s'agit d'un rendu 3D : le résultat doit ressembler à une VRAIE
PHOTOGRAPHIE prise au reflex plein format. Applique (sans modifier les volumes,
ouvertures, matériaux ni le cadrage) :
- Optique réelle : objectif d'architecture (~24-35 mm), très légère profondeur de
  champ, mise au point nette sur le bâtiment, premier/arrière-plans à peine adoucis.
- Capteur : micro-grain photographique fin et homogène, légère aberration
  chromatique en bord de cadre, plage dynamique réaliste (hautes lumières non
  cramées, ombres qui conservent du détail), balance des blancs naturelle.
- Matériaux NON parfaits : micro-imperfections réalistes — légères salissures,
  traces d'eau, poussière, reflets irréguliers, joints et arêtes non parfaitement
  nets, usure subtile. Bannir l'aspect plastique/lisse/synthétique du rendu 3D.
- Lumière physiquement crédible : ombres douces cohérentes avec une seule source,
  occlusion ambiante discrète, légère brume atmosphérique sur l'arrière-plan,
  reflets diffus réalistes dans les vitrages (pas de reflet « miroir » parfait).
- Végétation et sol photographiques : feuillages aux nuances variées, herbe non
  uniforme, enrobé avec sa texture réelle. Aucun élément trop net ou trop répétitif.
Résultat attendu : indiscernable d'un cliché d'architecture professionnel.`

  // Le rendu de nuit/tombée du jour trahit le plus le look 3D : on cible
  // explicitement ses défauts (fenêtres plates, ciel lisse, ombres débouchées).
  const heure = (p.heure || '').toLowerCase()
  const lowLight = heure.includes('nuit') || heure.includes('bleue') ||
    heure.includes('tombée') || heure.includes('tombee') || heure.includes('crépus') ||
    heure.includes('crepus') || heure.includes('coucher')
  if (!lowLight) return base

  return base + `\n\nSPÉCIFIQUE FAIBLE LUMIÈRE / NUIT — c'est ici que le rendu 3D se
trahit le plus, corrige IMPÉRATIVEMENT ces points (toujours sans toucher à la
géométrie ni aux ouvertures) :
- FENÊTRES ÉCLAIRÉES (défaut n°1) : surtout PAS des rectangles orange uniformes,
  plats et identiques. Chaque vitrage éclairé doit montrer une lumière intérieure
  INÉGALE et crédible — intensité et température variables d'une pièce à l'autre
  (du blanc chaud au légèrement froid), PROFONDEUR visible derrière la vitre
  (plafonds, luminaires ponctuels, silhouettes de mobilier, embrasures), reflets
  partiels et discrets à la surface du verre, parfois un store ou un rideau. Deux
  fenêtres ne doivent jamais être identiques.
- CIEL : ciel de tombée du jour/nuit réaliste, dégradé SUBTIL et NON lisse —
  nuances de nuages, micro-grain, pas d'aplat synthétique ni de banding propre.
- CONTRASTE BASSE LUMIÈRE : vraie plage dynamique de photo nocturne — ombres
  PROFONDES qui ne sont PAS débouchées par une lumière d'ambiance artificielle,
  modelé directionnel réel, léger bloom discret UNIQUEMENT autour des sources
  lumineuses réelles.
- GRAIN : montée en ISO visible dans les zones sombres (grain plus marqué qu'en
  plein jour), comme un vrai capteur en faible lumière.
- MATIÈRE DANS LA PÉNOMBRE : conserve la micro-texture des matériaux même peu
  éclairés — bardage, béton et enrobé ne doivent pas devenir des surfaces lisses
  « shadées » sans grain.`
}

function buildPhotorealPrompt(p: Presets): string {
  const heure = p.heure || 'tombée du jour'
  const ambiance = p.ambiance || 'chaleureuse'
  const vegetation = p.vegetation || 'paysagisme haut de gamme'
  const ciel = p.ciel && p.ciel !== 'auto'
    ? p.ciel
    : 'ciel riche cohérent avec l\'heure (dégradé naturel)'
  return `Produis UN SEUL rendu photoréaliste architectural haut de gamme à partir
de cette image, qualité photographie d'architecture professionnelle / rendu concours.

${geometryLock(p.details)}${materialsRules(p)}${realismRules(p)}

${lightingRules(p)}

AMBIANCE DEMANDÉE :
- Heure : ${heure}
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

${geometryLock(p.details)}${materialsRules(p)}

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

// ── Génération image via OpenAI gpt-image-2 (édition d'image) ──
// /v1/images/edits en multipart : la source sert de référence géométrique, le
// modèle réinterprète l'ambiance/matériaux/végétation en gardant la composition.
async function generateImage(
  prompt: string,
  imageB64: string,
  mime: string,
  sizeToken: string,
  quality: string,
): Promise<{ image: string; mime: string; model: string }> {
  const form = new FormData()
  form.append('model', OPENAI_IMAGE_MODEL)
  form.append('image', new Blob([b64ToBytes(imageB64)], { type: mime }), 'source.png')
  form.append('prompt', prompt)
  form.append('size', sizePx(sizeToken))
  form.append('quality', quality)
  form.append('n', '1')

  const resp = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  })
  if (!resp.ok) {
    throw new Error(`gpt-image-2 → HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
  }
  const data = await resp.json()
  const b64 = data?.data?.[0]?.b64_json
  if (!b64) throw new Error('gpt-image-2 → pas d\'image dans la réponse')
  return { image: b64, mime: 'image/png', model: OPENAI_IMAGE_MODEL }
}

// ── Détection des matériaux (vision → texte court) ────────
// OpenAI gpt-4o-mini vision. Renvoie une ligne concise prête à pré-remplir le
// champ "Matériaux" que l'utilisateur corrige ensuite.
async function detectMaterials(imageB64: string, mime: string): Promise<string> {
  const prompt = `Tu es un expert façade/construction. Observe ce rendu architectural
et liste UNIQUEMENT les matériaux réellement visibles, de façon factuelle, sans
deviner la marque. Réponds en UNE seule ligne courte, format :
"Bardage : … ; Menuiseries : … ; Soubassement : … ; Toiture/acrotère : … ; Sol/voirie : …"
(n'inclus que les éléments visibles). Ne décris pas la scène, ne fais pas de phrases.`
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${imageB64}` } },
        ],
      }],
      max_tokens: 300,
      temperature: 0.2,
    }),
  })
  if (!resp.ok) {
    throw new Error(`détection matériaux → HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  }
  const data = await resp.json()
  const text = (data?.choices?.[0]?.message?.content || '').trim()
  if (!text) throw new Error('détection matériaux → réponse vide')
  return text
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
  if (!OPENAI_API_KEY) {
    return jsonResponse({ success: false, error: 'OPENAI_API_KEY non configuré' }, 500)
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

  // ── Garde : admin OU permission renders:read ────────────
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: profile } = await adminClient
    .from('app_profiles')
    .select('is_admin, permissions')
    .eq('id', userData.user.id)
    .single()
  const canRender = profile?.is_admin === true ||
    (Array.isArray(profile?.permissions?.renders) && profile.permissions.renders.includes('read'))
  if (!canRender) {
    return jsonResponse({ success: false, error: 'Accès non autorisé' }, 403)
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
  if (!['photoreal', 'sketch', 'refine', 'upscale', 'detect'].includes(mode)) {
    return jsonResponse({ success: false, error: 'mode invalide' }, 400)
  }

  // ── Mode détection matériaux : renvoie du texte, pas une image ──
  if (mode === 'detect') {
    try {
      const materials = await detectMaterials(body.image, body.mime || 'image/png')
      return jsonResponse({ success: true, materials })
    } catch (e) {
      return jsonResponse({ success: false, error: e instanceof Error ? e.message : 'Échec détection' }, 502)
    }
  }
  // gpt-image-2 sort directement une version HD imprimable : photo/esquisse/refine
  // en 2K (2560x1440), upscale optionnel en 4K. Qualité high (~110s @ 2K).
  const size = body.size || (mode === 'upscale' ? '4K' : '2K')
  const quality = 'high'
  const mime = body.mime || 'image/png'
  const prompt = buildPrompt(mode, body.presets || {}, body.instructions)

  try {
    const out = await generateImage(prompt, body.image, mime, size, quality)
    return jsonResponse({ success: true, ...out })
  } catch (e) {
    return jsonResponse({
      success: false,
      error: e instanceof Error ? e.message : 'Échec de génération',
    }, 502)
  }
})
