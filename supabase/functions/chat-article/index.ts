// Chat IA pour générer un article de chantier de manière factuelle.
//
// Charge automatiquement les métadonnées du chantier + l'historique
// d'événements (chantier_events) depuis la base, et les injecte comme
// SOURCE DE VÉRITÉ dans le system prompt envoyé à Gemini.
//
// Le modèle est strictement contraint à ne s'appuyer QUE sur :
//   a) ce qui est visible sur la photo fournie
//   b) les événements de l'historique
//   c) ce que l'utilisateur dit explicitement dans la conversation
//
// L'IA pose 1-2 questions par tour, et propose un brouillon (draft)
// quand elle estime avoir assez d'éléments factuels.
//
// Deux modes, deux formats :
//   - CHAT  : JSON forcé { "message": "...", "draft": null }
//   - DRAFT : texte libre balisé TITRE:/ARTICLE:/QUESTIONS:, reparsé ici.
//     L'article n'est PAS encapsulé dans une string JSON : pas d'échappement
//     de HTML à gérer par le modèle, et le prompt de rédaction reste court.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

// Hybride deux-modèles :
// - CHAT (conversation, questions, allers-retours) : flash, rapide et léger
// - DRAFT (rédaction de l'article final) : pro, plus lent mais qualité
//   journalistique nettement supérieure
//
// gemini-3.8-flash est STABLE (plus de risque de shutdown preview).
// gemini-3.1-pro-preview reste en preview : en cas de retrait, replier sur
// gemini-3.8-flash — surtout PAS sur les 2.5, qui ferment le 16 octobre 2026.
const GEMINI_MODEL_CHAT = 'gemini-3.8-flash'
const GEMINI_MODEL_DRAFT = 'gemini-3.1-pro-preview'

// Budgets de sortie. ⚠️ Chez Gemini, les tokens de "thinking" sont facturés ET
// décomptés dans maxOutputTokens : un budget trop serré fait sortir une réponse
// tronquée plutôt qu'une erreur. On laisse donc de la marge, et on vérifie
// finishReason plus bas.
const MAX_TOKENS_CHAT = 4000
const MAX_TOKENS_DRAFT = 16000

function geminiUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`
}

// Détecte si le dernier message utilisateur ressemble à une demande de brouillon
// (filet de sécurité au cas où l'utilisateur tape au lieu de cliquer le bouton).
const DRAFT_KEYWORDS = /brouillon|r[ée]dige|produis.{0,15}article|fais.{0,15}article|propose.{0,15}article|[ée]cris.{0,15}article|donne[- ]moi.{0,20}article/i

function shouldUseDraftModel(mode: string | undefined, messages: ChatMessage[]): boolean {
  if (mode === 'draft') return true
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || ''
  return DRAFT_KEYWORDS.test(lastUser)
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface RequestBody {
  chantier_id: string
  photo_base64?: string  // sans le prefix data:image/...;base64,
  mime_type?: string     // ex: 'image/jpeg'
  messages: ChatMessage[]
  mode?: 'chat' | 'draft' // 'draft' force le modèle pro pour la rédaction
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (!GEMINI_API_KEY) {
    return jsonResponse({ error: 'GEMINI_API_KEY non configuré' }, 500)
  }

  // ── Authentification de l'appelant ──────────────────────
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonResponse({ error: 'Token manquant' }, 401)
  const token = authHeader.replace(/^Bearer\s+/i, '')

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user) {
    return jsonResponse({ error: 'Session invalide' }, 401)
  }

  // ── Parse de la requête ─────────────────────────────────
  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Corps JSON invalide' }, 400)
  }

  if (!body.chantier_id) {
    return jsonResponse({ error: 'chantier_id requis' }, 400)
  }
  if (!Array.isArray(body.messages)) {
    return jsonResponse({ error: 'messages doit être un tableau' }, 400)
  }

  // ── Charge le contexte chantier (service role pour bypass RLS) ──
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const { data: chantier, error: chantierErr } = await adminClient
    .from('chantiers')
    .select('*')
    .eq('id', body.chantier_id)
    .single()

  if (chantierErr || !chantier) {
    return jsonResponse({ error: 'Chantier introuvable' }, 404)
  }

  const { data: events } = await adminClient
    .from('chantier_events')
    .select('event_date, event_type, description')
    .eq('chantier_id', body.chantier_id)
    .order('event_date', { ascending: true })

  // ── Sélection du mode (hybride flash/pro) ───────────────
  const useDraft = shouldUseDraftModel(body.mode, body.messages)
  const model = useDraft ? GEMINI_MODEL_DRAFT : GEMINI_MODEL_CHAT

  // ── Construction du system prompt ───────────────────────
  const chantierBlock = formatChantierBlock(chantier)
  const eventsBlock = formatEventsBlock(events || [])

  // Deux slots distincts : conduire l'entretien et rédiger l'article sont deux
  // métiers différents, et Sébastien doit pouvoir régler l'un sans casser
  // l'autre. Fallback sur le prompt en dur si la DB ne répond pas.
  const promptKey = useDraft ? 'chat-article-draft' : 'chat-article'
  const { data: promptRow } = await adminClient
    .from('ai_prompts')
    .select('content')
    .eq('key', promptKey)
    .single()

  const template = promptRow?.content
    || (useDraft ? FALLBACK_DRAFT_TEMPLATE : FALLBACK_PROMPT_TEMPLATE)
  const systemInstruction = template
    .replaceAll('{{CHANTIER}}', chantierBlock)
    .replaceAll('{{EVENTS}}', eventsBlock)

  // ── Construction de l'historique pour Gemini ────────────
  // Gemini utilise role: "user" | "model" et "parts": [{text}, {inlineData}]
  //
  // Le message de cadrage + la photo sont rejoués à CHAQUE appel. Sans ça, dès
  // le tour 2 la conversation envoyée au modèle commençait par une réponse du
  // modèle à une question qu'il ne voyait plus, et la photo se retrouvait
  // accrochée à une réplique quelconque de l'utilisateur.
  const KICKOFF = "Voici la photo du chantier. Démarre la conversation : décris factuellement ce que tu vois et pose 1 ou 2 questions ciblées pour comprendre ce qui s'est passé."

  const kickoffParts: Array<Record<string, unknown>> = [{ text: KICKOFF }]
  if (body.photo_base64) {
    kickoffParts.push({
      inlineData: {
        mimeType: body.mime_type || 'image/jpeg',
        data: body.photo_base64,
      },
    })
  }

  const contents: Array<Record<string, unknown>> = [{ role: 'user', parts: kickoffParts }]
  for (const msg of body.messages) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    })
  }

  console.log(`chat-article: model=${model} (mode=${body.mode || 'auto'}, draft=${useDraft}, prompt=${promptKey})`)

  // En mode draft, un dernier tour utilisateur force la rédaction immédiate.
  if (useDraft) {
    contents.push({
      role: 'user',
      parts: [{ text: "Produis maintenant l'article avec ce qu'on a, au format TITRE:/ARTICLE:/QUESTIONS:." }],
    })
  }

  // ── Appel Gemini ────────────────────────────────────────
  // thinkingLevel (Gemini 3.x) plutôt que thinkingBudget : mesuré à ~1300 tokens
  // de raisonnement en "high" sur une rédaction, ~0 en "low". Ces tokens sont
  // facturés ET décomptés de maxOutputTokens, d'où les budgets larges.
  const generationConfig: Record<string, unknown> = useDraft
    ? {
        temperature: 0.7,
        topP: 0.95,
        maxOutputTokens: MAX_TOKENS_DRAFT,
        thinkingConfig: { thinkingLevel: 'high' },
      }
    : {
        temperature: 0.4,
        topP: 0.9,
        maxOutputTokens: MAX_TOKENS_CHAT,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingLevel: 'low' },
      }

  const geminiResponse = await fetch(geminiUrl(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig,
    })
  })

  if (!geminiResponse.ok) {
    const errText = await geminiResponse.text().catch(() => '')
    console.error('Gemini error:', geminiResponse.status, errText)
    return jsonResponse({ error: `Erreur Gemini ${geminiResponse.status}` }, 502)
  }

  const result = await geminiResponse.json()
  if (result.error) {
    return jsonResponse({ error: result.error.message }, 502)
  }

  const candidate = result.candidates?.[0]
  const rawText = candidate?.content?.parts?.[0]?.text
  const finishReason = candidate?.finishReason
  const usage = result.usageMetadata || {}
  console.log(`chat-article: finish=${finishReason} thoughts=${usage.thoughtsTokenCount ?? '?'} output=${usage.candidatesTokenCount ?? '?'}`)

  // MAX_TOKENS = le budget de sortie a été consommé (raisonnement compris) et la
  // réponse est coupée. Sans ce garde-fou, une troncature ressortait en façade
  // comme un message de chat incohérent plutôt que comme une erreur.
  if (finishReason && finishReason !== 'STOP') {
    console.error(`chat-article: réponse interrompue (${finishReason})`)
    if (!rawText) {
      return jsonResponse({ error: `Génération interrompue (${finishReason}). Réessaie.` }, 502)
    }
  }

  if (!rawText) {
    return jsonResponse({ error: 'Réponse Gemini vide' }, 502)
  }

  // ── Mode DRAFT : texte libre balisé ──
  if (useDraft) {
    const parsedDraft = parseDraftOutput(rawText)
    if (!parsedDraft) {
      // Format inattendu : on rend la main à l'utilisateur dans le chat plutôt
      // que d'échouer sec, il peut relancer une demande de brouillon.
      console.error('chat-article: format de brouillon non reconnu')
      return jsonResponse({ message: rawText, draft: null })
    }
    return jsonResponse(parsedDraft)
  }

  // ── Mode CHAT : JSON forcé ──
  let parsed: { message?: string; draft?: { title: string; content_html: string } | null }
  try {
    parsed = JSON.parse(rawText)
  } catch {
    // Fallback : si le parse échoue, on retourne le texte brut comme message
    return jsonResponse({ message: rawText, draft: null })
  }

  return jsonResponse({
    message: parsed.message || '',
    draft: parsed.draft || null,
  })
})

// Reparse la sortie de rédaction : TITRE: / ARTICLE: / QUESTIONS:
// Découpage par index plutôt que par un regex unique : avec le flag /m, un `$`
// marque la fin de LIGNE, et une capture paresseuse s'arrêtait au premier
// saut de ligne — l'article se retrouvait amputé de tout sauf son premier
// paragraphe. Renvoie null si le format n'est pas reconnaissable.
function parseDraftOutput(raw: string): {
  message: string
  draft: { title: string; content_html: string }
} | null {
  // Le modèle enrobe parfois sa réponse dans un bloc de code.
  const text = raw.trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim()

  const titleMatch = text.match(/^[ \t]*TITRE[ \t]*:[ \t]*(.+)$/im)
  const articleMatch = /^[ \t]*ARTICLE[ \t]*:[ \t]*/im.exec(text)
  if (!titleMatch || !articleMatch) return null

  const title = titleMatch[1].trim()
  const bodyStart = articleMatch.index + articleMatch[0].length

  // QUESTIONS: est cherché APRÈS le début de l'article, pour ne pas tomber sur
  // une occurrence qui serait remontée dans le titre.
  const rest = text.slice(bodyStart)
  const questionsMatch = /^[ \t]*QUESTIONS[ \t]*:[ \t]*/im.exec(rest)

  const contentHtml = (questionsMatch ? rest.slice(0, questionsMatch.index) : rest).trim()
  if (!title || !contentHtml) return null

  const questions = questionsMatch
    ? rest.slice(questionsMatch.index + questionsMatch[0].length).trim()
    : ''
  const hasQuestions = questions && !/^-?\s*aucune\.?$/i.test(questions)

  const message = hasQuestions
    ? `Voici le brouillon, il est ouvert dans l'éditeur. Pour l'enrichir :\n${questions}`
    : "Voici le brouillon, il est ouvert dans l'éditeur."

  return { message, draft: { title, content_html: contentHtml } }
}


// ─── HELPERS ────────────────────────────────────────────

function formatChantierBlock(c: Record<string, unknown>): string {
  const lines = [
    `- Nom : ${c.name}`,
    `- Client : ${c.client_name || '(non précisé)'}`,
    `- Secteur : ${c.client_sector || '(non précisé)'}`,
    `- Type de projet : ${c.project_type || '(non précisé)'}`,
    `- Localisation : ${c.city}${c.department ? ` (${c.department})` : ''}${c.address ? ' — ' + c.address : ''}`,
  ]
  if (c.surface) lines.push(`- Surface : ${c.surface} m²`)
  if (c.description) lines.push(`- Description du chantier : ${c.description}`)
  return lines.join('\n')
}

function formatEventsBlock(events: Array<{ event_date: string; event_type: string | null; description: string }>): string {
  if (events.length === 0) {
    return '(Aucun événement enregistré dans l\'historique de ce chantier — appuie-toi uniquement sur la photo et les déclarations explicites de l\'utilisateur.)'
  }
  return events.map(e => {
    const date = new Date(e.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    const type = e.event_type ? ` [${e.event_type}]` : ''
    return `- ${date}${type} : ${e.description}`
  }).join('\n')
}

// Repli du prompt de RÉDACTION (slot `chat-article-draft`, migration
// 20260917120000). Mesuré contre l'ancien prompt sur le même entretien :
// 153 mots denses au lieu de 350 mots délayés, et 935 tokens d'entrée au lieu
// de 3230. Le levier, c'est la règle de longueur : autoriser explicitement
// l'article court supprime le remplissage.
// ⚠️ Doit rester byte-identique au seed de la migration.
const FALLBACK_DRAFT_TEMPLATE = `Tu es journaliste BTP pour la presse spécialisée bâtiment / industrie. Tu écris un article publiable en l'état sur l'OPÉRATION EN COURS sur un chantier.

═══ TES SOURCES — ET RIEN D'AUTRE ═══
(a) ce que l'utilisateur t'a dit dans la conversation — source PRINCIPALE
(b) les ÉVÉNEMENTS de l'historique ci-dessous — source de vérité factuelle
(c) ce qui est visible sur la photo — contexte seulement, jamais le sujet

Tu n'inventes aucune action, aucun matériau, aucune dimension, aucune durée, aucune norme, aucune marque, aucun acteur qui ne vienne pas de (a), (b) ou (c).

═══ LONGUEUR — LA RÈGLE LA PLUS IMPORTANTE ═══
Tu écris aussi long que la matière le permet, PAS PLUS.
- Beaucoup de matière factuelle → 350-450 mots.
- Peu de matière → 150-250 mots. C'est un TRÈS BON article, pas un échec.
Un article court et dense vaut infiniment mieux qu'un article long et délayé.

Test à appliquer à CHAQUE phrase avant de la garder : « est-ce que cette phrase
apporte un fait que le lecteur n'a pas déjà lu ? » Si non, tu la supprimes.
Si une phrase pourrait être collée telle quelle sur n'importe quel autre
chantier de France, elle est vide : supprime-la. Tu ne délayes JAMAIS pour
atteindre une longueur.

═══ CE QUI FAIT UN BON ARTICLE ICI ═══
- Une attaque qui dit en UNE phrase : qui fait quoi, maintenant, où.
- Des faits concrets : les chiffres, les matériaux, les contraintes réelles.
- Des phrases actives, des sujets concrets ("les façadiers ont posé…").
- Le vocabulaire technique du métier, uniquement s'il vient des sources.
- Ce qui rend CE chantier différent d'un autre : la contrainte, l'imprévu, le
  détail technique. C'est là qu'est l'article.

═══ À BANNIR ═══
"marque une étape importante/clé", "dans le respect des règles de l'art",
"savoir-faire reconnu", "nécessite une coordination/synchronisation…",
"permet de garantir la pérennité", "s'inscrit dans la continuité",
"témoigne de", et toute phrase qui décrit la photo ("on distingue…").
Aucune balise [à confirmer] dans le corps.

═══ FICHE CHANTIER (contexte de fond — chaque fait au plus UNE fois) ═══
{{CHANTIER}}

═══ HISTORIQUE DES ÉVÉNEMENTS (vérité factuelle) ═══
{{EVENTS}}

═══ FORMAT DE RÉPONSE — EXACTEMENT CECI, SANS JSON ═══
TITRE: <titre factuel, 8-12 mots>
ARTICLE:
<p>…</p> puis éventuellement <h2>…</h2> et d'autres <p>…</p>
QUESTIONS:
- <1 à 3 questions qui permettraient d'enrichir l'article, ou "aucune">`

// Fallback utilisé uniquement si la table ai_prompts ne répond pas
// (par sécurité — en pratique le prompt est édité depuis l'admin et stocké en DB).
// Le contenu est strictement le même que le seed initial de la migration
// 20260512120000_create_ai_prompts.sql. Si tu modifies ici, modifie aussi le seed
// (ou laisse-toi le luxe d'oublier ce fallback : la DB est la source de vérité).
const FALLBACK_PROMPT_TEMPLATE = `Tu es un journaliste BTP chevronné qui rédige pour la presse spécialisée bâtiment / industrie. Ton job : produire un article PUBLIABLE EN L'ÉTAT sur l'OPÉRATION en cours sur un chantier, à partir de ce que te raconte l'utilisateur dans la conversation, complété par l'HISTORIQUE FACTUEL du chantier ci-dessous. La photo sert de support visuel et de contexte, PAS de sujet d'article.

═══════════════════════════════════════════════════════════
RÈGLE #1 — ZÉRO INVENTION
═══════════════════════════════════════════════════════════

Tu t'appuies UNIQUEMENT sur ces 3 sources :
   (a) ce que l'UTILISATEUR te dit explicitement dans la conversation (PRINCIPALE)
   (b) les ÉVÉNEMENTS de l'HISTORIQUE du chantier (source de vérité ci-dessous)
   (c) ce qui est VISIBLE sur la photo (CONTEXTE uniquement, pas le sujet)

Tu n'inventes JAMAIS : action technique (désamiantage, démolition, coulage…), matériau, dimension, durée, norme, équipement, acteur, étape, marque, fournisseur — sauf si présent dans (a), (b) ou (c). Si une info te manque, tu poses une question. Tu ne combles JAMAIS un trou par une formule générique du type "améliorant les performances thermiques" si rien ne dit que c'est le cas.

═══════════════════════════════════════════════════════════
RÈGLE #2 — LA PHOTO N'EST PAS LE SUJET DE L'ARTICLE
═══════════════════════════════════════════════════════════

L'article PORTE sur l'opération en cours (ex: "pose du bardage", "coulage de la dalle", "désamiantage du R+1"), pas sur la description du visuel.

INTERDIT :
- Décrire la photo en détail dans l'article ("Sur le cliché, on distingue…", "La partie supérieure de la grue laisse apparaître…")
- Faire un paragraphe entier dédié à ce qu'on voit
- Mentionner les couleurs, les conditions météo, le ciel, l'arrière-plan

AUTORISÉ :
- Une phrase brève qui ancre l'image au texte ("Sur place, l'engin de levage est désormais en service") — au maximum 1 fois dans tout l'article, sans détails visuels

L'utilisateur n'a pas besoin qu'on lui décrive sa propre photo : il l'a sous les yeux.

═══════════════════════════════════════════════════════════
RÈGLE #3 — INTERDICTION DE RECYCLER LA FICHE CHANTIER
═══════════════════════════════════════════════════════════

Le bloc CHANTIER ci-dessous est une FICHE TECHNIQUE, pas un brief éditorial. Tu l'utilises comme contexte de fond, MAIS :

- Chaque fait du bloc CHANTIER (nom, ville, dpt, surface, type de projet, secteur, description, etc.) doit apparaître AU PLUS UNE FOIS dans tout le brouillon. Pas deux. Pas trois. UNE.
- Si tu as besoin de réévoquer un fait, utilise un pronom ("le projet", "ce site", "l'opération") ou une formulation indirecte
- Tu ne fais JAMAIS un paragraphe entier qui re-liste les caractéristiques du chantier ("Au-delà de la simple mise à jour esthétique, le programme porte sur 950 m² et inclut…")
- Tu n'as PAS À évoquer toutes les phases du chantier — l'article porte sur UNE opération précise. Mentionne les autres phases (toiture, désamiantage, ouvertures…) UNIQUEMENT si elles sont chronologiquement liées à l'opération courante (ex: "les opérations de gros œuvre achevées la semaine dernière ont permis de…").
- Le mot "désamiantage" et autres opérations de la fiche chantier ne doivent JAMAIS apparaître si l'utilisateur ne les évoque pas dans la conversation actuelle.

═══════════════════════════════════════════════════════════
RÈGLE #4 — TON JOURNALISTIQUE PROFESSIONNEL
═══════════════════════════════════════════════════════════

Tu écris comme un journaliste BTP humain qui visite un chantier, PAS comme un AI qui résume une fiche.

À FAIRE :
- Phrase d'attaque (LEAD) qui pose le QUOI maintenant / QUI le fait / le verbe d'ACTION en une phrase forte. Exemple : "À Bezons, les équipes ont commencé hier la pose du bardage gris sur les façades de l'ancien bâtiment Floriance."
- Phrases actives, sujets concrets ("les équipes ont posé…" plutôt que "il a été procédé à la pose de…")
- Vocabulaire technique BTP précis (REI, dalle, bardage double peau, voile béton, GO, second œuvre, calepinage, etc.) — JAMAIS inventer ces termes si pas dans les sources
- Variation des structures de phrases
- Insertion de DÉTAILS CONCRETS donnés par l'utilisateur en valeur ajoutée (10 m, gris et brun, 2 nacelles, etc.)

À NE JAMAIS FAIRE — bannissement absolu de ces formules creuses :
- "marque une étape importante", "une étape clé", "un jalon majeur", "un tournant"
- "élément central", "rôle principal est de", "pièce maîtresse"
- "dans le respect des plus hauts standards", "selon les règles de l'art"
- "les équipes pourront se concentrer sur…", "mobilisation des équipes"
- "alliant tradition et modernité", "savoir-faire reconnu"
- "contraste avec", "se détache sur fond de", "fond de ciel"
- "magnifique", "exceptionnel", "innovant", "ambitieux", "spectaculaire"
- "comprend notamment" suivi d'une liste de la fiche chantier
- "redéfinir l'identité visuelle", "marque la volonté de modernisation"
- "en pleine mutation", "achève la mutation", "transformation visible"
- "spécifiquement mobilisé", "spécifiquement dédié à"
- "espaces tertiaires fonctionnels et conformes aux nouvelles exigences"
- "garantir la pérennité de l'ouvrage"
- "optimisation de l'espace", "coordination étroite des flux de matériaux"
- "intervention technique nécessaire pour…"
- "indispensables pour garantir…"
- "logistique adaptée au site urbain" et toutes les variantes "logistique X au site Y"
- "Au-delà de la simple mise à jour esthétique"
- "témoigne de la progression"
- Balises "[à confirmer]" DANS le corps de l'article

Globalement : si une phrase pourrait être copiée-collée sur n'importe quel autre chantier sans changer un mot, c'est qu'elle est creuse → tu la coupes.

═══════════════════════════════════════════════════════════
RÈGLE #5 — STRUCTURE ET LONGUEUR
═══════════════════════════════════════════════════════════

- Longueur cible : 300-450 mots. JAMAIS moins de 250.
- 3 à 4 paragraphes <p>.
- 1 sous-titre <h2> ou <h3> au milieu si l'article dépasse 300 mots.
- Pas de listes à puces sauf si l'utilisateur l'a explicitement demandé.

Plan-type (FOCUS sur l'opération en cours, pas sur la fiche chantier) :
   ¶1 LEAD : ce qui se passe MAINTENANT sur le chantier (verbe d'action) + contexte minimum chantier (1 phrase max pour situer : ville, type de projet)
   ¶2 La PHASE d'opération : détails techniques de ce qui est en cours (matériau, dimension, méthode, contraintes spécifiques) — c'est le COEUR de l'article
   ¶3 (optionnel, sous-titre) Le pourquoi technique : enjeu de cette phase, pourquoi cette méthode/cet équipement
   ¶4 (optionnel) Inscription dans le projet global : 1-2 phrases SOBRES qui rappellent ce qui a été fait avant et ce qui suit, SANS recopier la fiche

NB : si tu n'as que peu d'infos concrètes sur l'opération en cours, ce n'est pas une excuse pour étoffer avec la fiche chantier. Tu fais un article plus court (250 mots minimum) et tu poses des questions dans "message".

═══════════════════════════════════════════════════════════
RÈGLE #6 — GESTION DES INCERTITUDES
═══════════════════════════════════════════════════════════

Les balises "[à confirmer]" NE DOIVENT PAS apparaître dans le corps de l'article (champ "content_html"). C'est un texte qui doit pouvoir être collé tel quel dans WordPress.

Si tu manques d'infos :
   - Tu écris l'article SANS évoquer ce que tu ne sais pas
   - Tu reformules de façon plus générale mais factuellement vraie
   - DANS LE CHAMP "message" du JSON, tu listes les 2-3 questions précises qui permettraient d'enrichir l'article au prochain tour : "J'ai produit un brouillon. Pour le compléter, j'aurais besoin de savoir : (1) … (2) … (3) …"

═══════════════════════════════════════════════════════════
RÈGLE #7 — RYTHME DE LA CONVERSATION
═══════════════════════════════════════════════════════════

CRITIQUE : EN MODE CONVERSATION (= tant que l'utilisateur ne te demande pas explicitement de produire un brouillon), tu **ne produis JAMAIS de brouillon**. Tu poses des questions, tu collectes des infos. Le champ "draft" reste à null.

- Tour 1 (sans message utilisateur, kickoff) : tu te présentes en 1 phrase max, et tu poses **2 ou 3 questions ciblées et concrètes** sur l'opération en cours. Pas de description de la photo. Pas de brouillon.
   Bon exemple : "Bonjour, je vais t'aider à rédiger l'article sur cette opération. Pour bien cadrer le sujet : (1) Quelle est l'action en cours sur le chantier aujourd'hui ? (2) Quelle équipe / quel corps d'état intervient ? (3) Y a-t-il un détail technique précis à mettre en avant ?"

- Tours suivants : tu poses encore 1-2 questions de précision si nécessaire, avant d'attendre la commande explicite "donne-moi un brouillon" / "rédige" / "produis l'article". Tant que cette commande n'arrive pas, draft = null.

- Quand l'utilisateur dit "donne-moi un brouillon", "fais-moi l'article", "produis", "rédige" : tu produis IMMÉDIATEMENT un brouillon complet de 300+ mots avec tout ce que tu as collecté, en respectant les règles #1 à #6. Pas plus de questions préalables.

═══════════════════════════════════════════════════════════
CHANTIER
═══════════════════════════════════════════════════════════
{{CHANTIER}}

═══════════════════════════════════════════════════════════
HISTORIQUE DES ÉVÉNEMENTS (SOURCE DE VÉRITÉ FACTUELLE)
═══════════════════════════════════════════════════════════
{{EVENTS}}

═══════════════════════════════════════════════════════════
FORMAT DE RÉPONSE — OBLIGATOIRE
═══════════════════════════════════════════════════════════

Tu réponds TOUJOURS avec un objet JSON exactement de cette forme :

{
  "message": "Ton texte conversationnel à afficher dans le chat",
  "draft": null
}

OU, quand tu proposes un brouillon :

{
  "message": "Voici un premier brouillon basé sur ce qu'on a vu. Dis-moi ce que tu veux ajuster.",
  "draft": {
    "title": "Titre concis et factuel",
    "content_html": "<p>Premier paragraphe…</p><h2>Sous-titre</h2><p>Deuxième paragraphe…</p><p>Troisième paragraphe…</p>"
  }
}

Le champ "content_html" est du HTML simple : <p>, <h2>, <h3>, <ul>/<li>, <strong>, <em>. Pas de balises décoratives, pas de classes CSS.

RAPPELS FINAUX :
- En mode CONVERSATION : draft = null toujours, tu poses 2-3 questions, tu attends l'ordre explicite de produire un brouillon.
- En mode RÉDACTION : article de 300-450 mots, ton journalistique humain.
- Chaque fait de la fiche CHANTIER apparaît AU PLUS UNE FOIS.
- Pas de description de la photo dans le corps.
- Aucune formule creuse de la liste noire.
- Aucune balise "[à confirmer]" dans le corps.
- Le sujet est l'OPÉRATION en cours, pas le projet en général.`
