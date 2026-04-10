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
// Format de réponse de l'IA (forcé via responseMimeType JSON) :
//   { "message": "...", "draft": null | { "title": "...", "content_html": "..." } }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

// Hybride deux-modèles :
// - CHAT (conversation, questions, allers-retours) : modèle flash, rapide et léger
// - DRAFT (rédaction de l'article final) : modèle pro, plus lent mais qualité
//   journalistique nettement supérieure
//
// Aucun Gemini 3 n'est en GA (avril 2026), tous sont en preview. Le défunt
// gemini-3-pro-preview a été shutdown le 9 mars 2026 → à surveiller.
const GEMINI_MODEL_CHAT = 'gemini-3-flash-preview'
const GEMINI_MODEL_DRAFT = 'gemini-3.1-pro-preview'

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

  // ── Construction du system prompt ───────────────────────
  const chantierBlock = formatChantierBlock(chantier)
  const eventsBlock = formatEventsBlock(events || [])
  const systemInstruction = buildSystemInstruction(chantierBlock, eventsBlock)

  // ── Construction de l'historique pour Gemini ────────────
  // Gemini utilise role: "user" | "model" et "parts": [{text}, {inlineData}]
  // La photo est attachée au PREMIER tour utilisateur uniquement.
  const contents: Array<Record<string, unknown>> = []

  if (body.messages.length === 0) {
    // Premier appel : on demande à l'IA d'amorcer la conversation
    // en regardant la photo et l'historique.
    const firstUserParts: Array<Record<string, unknown>> = [
      { text: "Voici la photo du chantier. Démarre la conversation : décris factuellement ce que tu vois et pose 1 ou 2 questions ciblées pour comprendre ce qui s'est passé." }
    ]
    if (body.photo_base64) {
      firstUserParts.push({
        inlineData: {
          mimeType: body.mime_type || 'image/jpeg',
          data: body.photo_base64
        }
      })
    }
    contents.push({ role: 'user', parts: firstUserParts })
  } else {
    // Conversation en cours : on rebuild l'historique en attachant la photo
    // au tout premier tour utilisateur (pour que Gemini garde le contexte visuel)
    let photoAttached = false
    for (const msg of body.messages) {
      const parts: Array<Record<string, unknown>> = [{ text: msg.content }]
      if (msg.role === 'user' && !photoAttached && body.photo_base64) {
        parts.push({
          inlineData: {
            mimeType: body.mime_type || 'image/jpeg',
            data: body.photo_base64
          }
        })
        photoAttached = true
      }
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts
      })
    }
  }

  // ── Sélection du modèle (hybride flash/pro) ─────────────
  const useDraft = shouldUseDraftModel(body.mode, body.messages)
  const model = useDraft ? GEMINI_MODEL_DRAFT : GEMINI_MODEL_CHAT
  console.log(`chat-article: using model ${model} (mode=${body.mode || 'auto'}, draft=${useDraft})`)

  // En mode draft, on ajoute un dernier message système-utilisateur pour
  // forcer le modèle à produire un brouillon complet immédiatement, sans
  // re-poser de questions préalables.
  if (useDraft) {
    contents.push({
      role: 'user',
      parts: [{
        text: '[INSTRUCTION INTERNE — NE PAS RÉPÉTER] Produis MAINTENANT le brouillon complet d\'article (300+ mots, 3-5 paragraphes, ton journalistique BTP, RÈGLES #1 à #5 strictes). Aucune balise [à confirmer] dans le corps. Si des infos manquent, écris l\'article sans les évoquer et liste les questions de complément dans le champ "message" du JSON.'
      }]
    })
  }

  // ── Appel Gemini ────────────────────────────────────────
  const geminiResponse = await fetch(geminiUrl(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: {
        temperature: useDraft ? 0.55 : 0.4, // chat un peu plus stable, draft plus stylistique
        topP: 0.9,
        maxOutputTokens: 8000,
        responseMimeType: 'application/json',
      }
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

  const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text
  if (!rawText) {
    return jsonResponse({ error: 'Réponse Gemini vide' }, 502)
  }

  // Parse le JSON renvoyé par Gemini (forcé via responseMimeType)
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

function buildSystemInstruction(chantierBlock: string, eventsBlock: string): string {
  return `Tu es un journaliste BTP chevronné qui rédige pour la presse spécialisée bâtiment / industrie. Ton job : produire un article PUBLIABLE EN L'ÉTAT sur l'OPÉRATION en cours sur un chantier, à partir de ce que te raconte l'utilisateur dans la conversation, complété par l'HISTORIQUE FACTUEL du chantier ci-dessous. La photo sert de support visuel et de contexte, PAS de sujet d'article.

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
${chantierBlock}

═══════════════════════════════════════════════════════════
HISTORIQUE DES ÉVÉNEMENTS (SOURCE DE VÉRITÉ FACTUELLE)
═══════════════════════════════════════════════════════════
${eventsBlock}

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
}
