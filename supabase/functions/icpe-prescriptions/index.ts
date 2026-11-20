import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1"

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!
// Extraction depuis le texte d'arrêté : flash stable suffit et encaisse
// les 120k caractères d'entrée sans faire exploser la facture.
const GEMINI_MODEL = 'gemini-3.8-flash'
// Modèle du chat ICPE : raisonnement plus long, on prend le pro.
const CHAT_MODEL = 'gemini-3.1-pro-preview'
// Liste blanche : le front choisit son modèle, mais il ne peut pas faire appeler
// n'importe quoi sur notre clé Gemini.
const ALLOWED_MODELS = new Set([
  'gemini-3.8-flash',
  'gemini-3.1-pro-preview',
  'gemini-3.5-flash-lite',
])
const geminiUrl = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`
const GEMINI_URL = geminiUrl(GEMINI_MODEL)


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ─── ARRETES DATABASE ───────────────────────────────────────

const ARRETES_DB: Record<string, Record<string, { title: string, url: string }>> = {
  '1185': { declaration: { title: 'Arrete du 04/08/14', url: 'https://aida.ineris.fr/reglementation/arrete-040814-relatif-prescriptions-generales-applicables-installations-classees' } },
  '1435': {
    declaration: { title: 'Arrete du 15/04/10', url: 'https://aida.ineris.fr/reglementation/arrete-150410-relatif-prescriptions-generales-applicables-stations-service-0' },
    enregistrement: { title: 'Arrete du 15/04/10', url: 'https://aida.ineris.fr/reglementation/arrete-150410-relatif-prescriptions-generales-applicables-stations-service-relevant' },
    autorisation: { title: 'Arrete du 15/04/10', url: 'https://aida.ineris.fr/reglementation/arrete-150410-fixant-regles-generales-prescriptions-techniques-applicables-stations' }
  },
  '1436': {
    declaration: { title: 'Arrete du 22/12/08', url: 'https://aida.ineris.fr/reglementation/arrete-221208-relatif-prescriptions-generales-applicables-installations-classees-0' },
    autorisation: { title: 'Arrete du 03/10/10', url: 'https://aida.ineris.fr/reglementation/arrete-031010-relatif-stockage-reservoirs-aeriens-manufactures-liquides-0' }
  },
  '1450': { declaration: { title: 'Arrete du 05/12/16', url: 'https://aida.ineris.fr/reglementation/arrete-051216-relatif-prescriptions-applicables-a-certaines-installations-classees' } },
  '1510': {
    declaration: { title: 'Arrete du 11/04/17', url: 'https://aida.ineris.fr/reglementation/arrete-110417-relatif-prescriptions-generales-applicables-entrepots-couverts-soumis' },
    enregistrement: { title: 'Arrete du 11/04/17', url: 'https://aida.ineris.fr/reglementation/arrete-110417-relatif-prescriptions-generales-applicables-entrepots-couverts-soumis' },
    autorisation: { title: 'Arrete du 11/04/17', url: 'https://aida.ineris.fr/reglementation/arrete-110417-relatif-prescriptions-generales-applicables-entrepots-couverts-soumis' }
  },
  '1511': {
    declaration: { title: 'Arrete du 27/03/14', url: 'https://aida.ineris.fr/reglementation/arrete-270314-relatif-prescriptions-generales-applicables-installations-classees' },
    enregistrement: { title: 'Arrete du 15/04/10', url: 'https://aida.ineris.fr/reglementation/arrete-150410-relatif-prescriptions-generales-applicables-entrepots-frigorifiques' }
  },
  '1530': {
    declaration: { title: 'Arrete du 30/09/08', url: 'https://aida.ineris.fr/reglementation/arrete-300908-relatif-prescriptions-generales-applicables-depots-papier-carton' },
    enregistrement: { title: 'Arrete du 15/04/10', url: 'https://aida.ineris.fr/reglementation/arrete-150410-relatif-prescriptions-generales-applicables-depots-papier-carton' },
    autorisation: { title: 'Arrete du 29/09/08', url: 'https://aida.ineris.fr/reglementation/arrete-290908-relatif-a-prevention-sinistres-depots-papier-carton-soumis-a' }
  },
  '1532': {
    declaration: { title: 'Arrete du 05/12/16', url: 'https://aida.ineris.fr/reglementation/arrete-051216-relatif-prescriptions-applicables-a-certaines-installations-classees' },
    enregistrement: { title: 'Arrete du 11/09/13', url: 'https://aida.ineris.fr/reglementation/arrete-110913-relatif-prescriptions-generales-applicables-installations-relevant' }
  },
  '2160': {
    declaration: { title: 'Arrete du 28/12/07', url: 'https://aida.ineris.fr/reglementation/arrete-281207-relatif-prescriptions-generales-applicables-installations-classees' },
    enregistrement: { title: 'Arrete du 26/11/12', url: 'https://aida.ineris.fr/reglementation/arrete-261112-relatif-prescriptions-generales-applicables-installations-relevant' },
    autorisation: { title: 'Arrete du 29/03/04', url: 'https://aida.ineris.fr/reglementation/arrete-290304-relatif-a-prevention-risques-presentes-silos-cereales-grains-produits' }
  },
  '2515': {
    declaration: { title: 'Arrete du 30/06/97', url: 'https://aida.ineris.fr/reglementation/arrete-300697-relatif-prescriptions-generales-applicables-installations-classees' },
    enregistrement: { title: 'Arrete du 26/11/12', url: 'https://aida.ineris.fr/reglementation/arrete-261112-relatif-prescriptions-generales-applicables-installations-broyage' }
  },
  '2516': {
    declaration: { title: 'Arrete du 30/06/97', url: 'https://aida.ineris.fr/reglementation/arrete-300697-relatif-prescriptions-generales-applicables-installations-classees-0' },
    enregistrement: { title: 'Arrete du 10/12/13', url: 'https://aida.ineris.fr/reglementation/arrete-101213-relatif-prescriptions-generales-applicables-stations-transit-produits' }
  },
  '2517': {
    declaration: { title: 'Arrete du 30/06/97', url: 'https://aida.ineris.fr/reglementation/arrete-300697-relatif-prescriptions-generales-applicables-installations-classees-1' },
    enregistrement: { title: 'Arrete du 10/12/13', url: 'https://aida.ineris.fr/reglementation/arrete-101213-relatif-prescriptions-generales-applicables-stations-transit-0' }
  },
  '2518': {
    declaration: { title: 'Arrete du 26/11/11', url: 'https://aida.ineris.fr/reglementation/arrete-261111-relatif-prescriptions-generales-applicables-installations-0' },
    enregistrement: { title: 'Arrete du 08/08/11', url: 'https://aida.ineris.fr/reglementation/arrete-080811-relatif-prescriptions-generales-applicables-installations-relevant-0' }
  },
  '2560': {
    declaration: { title: 'Arrete du 27/07/15', url: 'https://aida.ineris.fr/reglementation/arrete-270715-relatif-prescriptions-generales-applicables-installations-classees' },
    enregistrement: { title: 'Arrete du 14/12/13', url: 'https://aida.ineris.fr/reglementation/arrete-141213-relatif-prescriptions-generales-applicables-installations-relevant-1' }
  },
  '2660': { declaration: { title: 'Arrete du 14/01/00', url: 'https://aida.ineris.fr/reglementation/arrete-140100-relatif-prescriptions-generales-applicables-installations-classees-1' } },
  '2662': {
    declaration: { title: 'Arrete du 14/01/00', url: 'https://aida.ineris.fr/reglementation/arrete-140100-relatif-prescriptions-generales-applicables-installations-classees-0' },
    enregistrement: { title: 'Arrete du 15/04/10', url: 'https://aida.ineris.fr/reglementation/arrete-150410-relatif-prescriptions-generales-applicables-stockages-polymeres' }
  },
  '2663': {
    declaration: { title: 'Arrete du 14/01/00', url: 'https://aida.ineris.fr/reglementation/arrete-140100-relatif-prescriptions-generales-applicables-installations-classees' },
    enregistrement: { title: 'Arrete du 15/04/10', url: 'https://aida.ineris.fr/reglementation/arrete-150410-relatif-prescriptions-generales-applicables-stockages-pneumatiques' }
  },
  '2710': {
    declaration: { title: 'Arrete du 27/03/12', url: 'https://aida.ineris.fr/reglementation/arrete-270312-relatif-prescriptions-generales-applicables-installations-classees' },
    enregistrement: { title: 'Arrete du 26/03/12', url: 'https://aida.ineris.fr/reglementation/arrete-260312-relatif-prescriptions-generales-applicables-installations-classees' },
    autorisation: { title: 'Arrete du 22/12/23', url: 'https://aida.ineris.fr/reglementation/arrete-221223-relatif-a-prevention-risque-dincendie-sein-installations-soumises-a' }
  },
  '2714': {
    declaration: { title: 'Arrete du 06/06/18', url: 'https://aida.ineris.fr/reglementation/arrete-060618-relatif-prescriptions-generales-applicables-installations-transit-1' },
    enregistrement: { title: 'Arrete du 06/06/18', url: 'https://aida.ineris.fr/reglementation/arrete-060618-relatif-prescriptions-generales-applicables-installations-transit-0' }
  },
  '2716': {
    declaration: { title: 'Arrete du 06/06/18', url: 'https://aida.ineris.fr/reglementation/arrete-060618-relatif-prescriptions-generales-applicables-installations-transit-1' },
    enregistrement: { title: 'Arrete du 06/06/18', url: 'https://aida.ineris.fr/reglementation/arrete-060618-relatif-prescriptions-generales-applicables-installations-transit-0' }
  },
  '2718': {
    declaration: { title: 'Arrete du 06/06/18', url: 'https://aida.ineris.fr/reglementation/arrete-060618-relatif-prescriptions-generales-applicables-installations-transit' },
    autorisation: { title: 'Arrete du 22/12/23', url: 'https://aida.ineris.fr/reglementation/arrete-221223-relatif-a-prevention-risque-dincendie-sein-installations-soumises-a' }
  },
  '2760': {
    enregistrement: { title: 'Arrete du 12/12/14', url: 'https://aida.ineris.fr/reglementation/arrete-121214-relatif-prescriptions-generales-applicables-installations-regime' },
    autorisation: { title: 'Arrete du 15/02/16', url: 'https://aida.ineris.fr/reglementation/arrete-150216-relatif-installations-stockage-dechets-non-dangereux' }
  },
  '2712': {
    enregistrement: { title: 'Arrete du 26/11/12', url: 'https://aida.ineris.fr/reglementation/arrete-261112-relatif-prescriptions-generales-applicables-installations-classees' }
  },
  '2791': {
    declaration: { title: 'Arrete du 23/11/11', url: 'https://aida.ineris.fr/reglementation/arrete-231111-relatif-prescriptions-generales-applicables-installations-classees' }
  },
  '2910': {
    declaration: { title: 'Arrete du 03/08/18', url: 'https://aida.ineris.fr/reglementation/arrete-030818-relatif-prescriptions-generales-applicables-installations-classees' },
    enregistrement: { title: 'Arrete du 03/08/18', url: 'https://aida.ineris.fr/reglementation/arrete-030818-relatif-prescriptions-generales-applicables-installations-relevant' },
    autorisation: { title: 'Arrete du 03/08/18', url: 'https://aida.ineris.fr/reglementation/arrete-030818-relatif-installations-combustion-dune-puissance-thermique-nominale' }
  },
  '2921': {
    declaration: { title: 'Arrete du 14/12/13', url: 'https://aida.ineris.fr/reglementation/arrete-141213-relatif-prescriptions-generales-applicables-installations-relevant' },
    enregistrement: { title: 'Arrete du 14/12/13', url: 'https://aida.ineris.fr/reglementation/arrete-141213-relatif-prescriptions-generales-applicables-installations-relevant-2' }
  },
  '2925': { declaration: { title: 'Arrete du 29/05/00', url: 'https://aida.ineris.fr/reglementation/arrete-290500-relatif-prescriptions-generales-applicables-installations-classees' } },
  '2930': {
    declaration: { title: 'Arrete du 04/06/04', url: 'https://aida.ineris.fr/reglementation/arrete-040604-relatif-prescriptions-generales-applicables-installations-classees' },
    enregistrement: { title: 'Arrete du 12/05/20', url: 'https://aida.ineris.fr/reglementation/arrete-120520-relatif-prescriptions-generales-applicables-installations-relevant-0' }
  },
  '2935': {
    declaration: { title: 'Arrete du 03/04/00', url: 'https://aida.ineris.fr/reglementation/arrete-030400-relatif-prescriptions-applicables-installations-classees-soumises-a' },
    autorisation: { title: 'Arrete du 03/04/00', url: 'https://aida.ineris.fr/reglementation/arrete-030400-relatif-prescriptions-applicables-installations-classees-soumises-a' }
  },
  '2940': {
    declaration: { title: 'Arrete du 02/05/02', url: 'https://aida.ineris.fr/reglementation/arrete-020502-relatif-prescriptions-generales-applicables-installations-classees-1' },
    enregistrement: { title: 'Arrete du 12/05/20', url: 'https://aida.ineris.fr/reglementation/arrete-120520-relatif-prescriptions-generales-applicables-installations-relevant-1' }
  }
}

// ─── FETCH & EXTRACT TEXT FROM AIDA (regex, no deno-dom) ────

function stripHtml(html: string): string {
  // Remove script/style/nav/footer blocks entirely
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')

  // Replace common block elements with newlines
  text = text.replace(/<\/(p|div|li|tr|h[1-6]|br|article|section)>/gi, '\n')
  text = text.replace(/<(br|hr)\s*\/?>/gi, '\n')
  text = text.replace(/<li[^>]*>/gi, '- ')
  text = text.replace(/<td[^>]*>/gi, ' | ')

  // Strip all remaining HTML tags
  text = text.replace(/<[^>]+>/g, '')

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n[ \t]+/g, '\n')
  text = text.replace(/\n{3,}/g, '\n\n')
  text = text.trim()

  return text
}

async function fetchAidaText(url: string): Promise<string> {
  console.log(`Fetching AIDA page: ${url}`)
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; BatiproBot/1.0)',
      'Accept': 'text/html',
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch AIDA page (${response.status}): ${url}`)
  }

  const html = await response.text()

  // Strip the full HTML — don't try to extract a specific container
  // AIDA pages have varied structures, regex container extraction is unreliable
  let text = stripHtml(html)

  // Gemini 2.0 Flash handles 1M tokens input, so 120k chars is fine
  if (text.length > 120000) {
    text = text.substring(0, 120000) + '\n\n[... texte tronque ...]'
  }

  console.log(`Extracted ${text.length} chars from AIDA page`)
  return text
}

// ─── PROMPTS ÉDITABLES (table ai_prompts) ───────────────────

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

// Charge un prompt éditable depuis l'admin. Repli sur le texte en dur si la
// table ne répond pas : une panne de DB ne doit pas couper le simulateur.
async function loadPrompt(key: string, fallback: string): Promise<string> {
  try {
    const { data, error } = await admin()
      .from('ai_prompts')
      .select('content')
      .eq('key', key)
      .single()
    if (error || !data?.content) {
      console.warn(`ai_prompts[${key}] indisponible (${error?.message ?? 'vide'}) — repli sur le prompt par defaut`)
      return fallback
    }
    return data.content as string
  } catch (err) {
    console.warn(`ai_prompts[${key}] : ${(err as Error).message} — repli sur le prompt par defaut`)
    return fallback
  }
}

// Remplace les {{PLACEHOLDER}}. Callback plutôt que chaîne de remplacement :
// les prescriptions peuvent contenir des $& / $1 qui seraient réinterprétés.
function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) => vars[name] ?? match)
}

// ─── MISE EN FORME DU CONTEXTE ICPE ─────────────────────────

interface RubriqueInput { code: string, regime: string, intitule: string }

// Le corps de requête vient du navigateur : on ne garde que des chaînes, et on
// borne la taille pour ne pas construire un prompt arbitrairement gros.
function normalizeRubriques(input: unknown): RubriqueInput[] {
  if (!Array.isArray(input)) return []
  return input.slice(0, 40).map((r) => ({
    code: String((r as RubriqueInput)?.code ?? '').slice(0, 20),
    regime: String((r as RubriqueInput)?.regime ?? '').slice(0, 40),
    intitule: String((r as RubriqueInput)?.intitule ?? '').slice(0, 300),
  })).filter((r) => r.code)
}

function formatRubriques(rubriques: RubriqueInput[]): string {
  return rubriques
    .map((r) => `Rubrique ${r.code} (${r.intitule}): Regime ${r.regime}`)
    .join('\n')
}

// Aplatit les prescriptions déjà extraites en lignes "categorie > champ: valeur",
// en sautant les cases que l'extraction n'a pas pu remplir.
function formatPrescriptions(
  prescriptions: unknown,
  rubriques: RubriqueInput[],
  header: string,
): string {
  if (!prescriptions || typeof prescriptions !== 'object') return ''
  const all = prescriptions as Record<string, Record<string, unknown>>
  let out = ''

  for (const rub of rubriques) {
    const rubData = all[rub.code]
    if (!rubData) continue
    const regime = Object.keys(rubData)[0]
    const presc = rubData[regime] as Record<string, unknown> | undefined
    if (!presc) continue

    out += `\n--- Rubrique ${rub.code} (${regime}) ---\n`
    for (const [cat, fields] of Object.entries(presc)) {
      if (typeof fields !== 'object' || fields === null) continue
      for (const [key, val] of Object.entries(fields as Record<string, unknown>)) {
        if (val && val !== "Non precise dans l'arrete" && val !== 'Selon arrete prefectoral') {
          out += `${cat} > ${key}: ${val}\n`
        }
      }
    }
  }

  return out ? `\n\n${header}\n${out}` : ''
}

// ─── CALL GEMINI ────────────────────────────────────────────

// Appel texte libre (analyse / chat). callGemini ci-dessous reste réservé à
// l'extraction, qui elle force le mode JSON.
async function callGeminiText(
  prompt: string,
  model: string,
  temperature: number,
  maxOutputTokens: number,
): Promise<string> {
  const response = await fetch(geminiUrl(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens },
    }),
  })

  const result = await response.json()
  if (result.error) throw new Error(result.error.message)
  return result.candidates?.[0]?.content?.parts?.[0]?.text || ''
}



async function callGemini(prompt: string): Promise<string> {
  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 32000,
        responseMimeType: 'application/json'
      }
    })
  })

  const rawBody = await response.text()
  let result: { error?: { message?: string }, candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  try {
    result = JSON.parse(rawBody)
  } catch {
    // Google a renvoyé une page HTML (5xx passerelle, quota, payload trop gros…)
    throw new Error(`Gemini a renvoyé une reponse non-JSON (HTTP ${response.status})`)
  }
  if (result.error) throw new Error(result.error.message)
  return result.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || ''
}

// ─── CALL GEMINI AVEC GOOGLE SEARCH GROUNDING ───────────────
// Pour les rubriques sans arrêté en base ET introuvables via l'index AIDA :
// on laisse Gemini chercher lui-même l'arrêté type sur le web (aida.ineris.fr)
// et en extraire les prescriptions, plutôt que de renvoyer "non trouvé".

async function callGeminiGrounded(prompt: string): Promise<string> {
  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      // ⚠️ responseMimeType:'application/json' est incompatible avec le grounding.
      // On demande donc le JSON dans le prompt et on parse en tolérant les fences.
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 32000
      }
    })
  })

  const result = await response.json()
  if (result.error) throw new Error(result.error.message)
  return result.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') || ''
}

// Parse JSON tolérant : retire les ```json ... ```, ignore le texte parasite
// avant/après, et gère le cas où le modèle émet plusieurs objets à la suite
// en extrayant le PREMIER objet {...} équilibré (comptage d'accolades, en
// tenant compte des chaînes et des échappements).
function parseJsonLoose(raw: string): Record<string, unknown> {
  let s = (raw || '').trim()
  // Retire les fences markdown
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    return JSON.parse(s)
  } catch {
    // Fallback : scanner le premier objet JSON équilibré
    const start = s.indexOf('{')
    if (start === -1) throw new Error('Réponse IA non parsable en JSON (aucun objet)')
    let depth = 0, inStr = false, esc = false
    for (let i = start; i < s.length; i++) {
      const c = s[i]
      if (esc) { esc = false; continue }
      if (c === '\\') { esc = true; continue }
      if (c === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) return JSON.parse(s.substring(start, i + 1))
      }
    }
    throw new Error('Réponse IA non parsable en JSON (objet non clos)')
  }
}

// ─── AIDA INDEX PAGES — Trouver l'URL d'un arrêté dynamiquement ───

const AIDA_INDEX_URLS: Record<string, string> = {
  declaration: 'https://aida.ineris.fr/reglementation/arretes-ministeriels-prescriptions-applicables-icpe-soumises-a-declaration',
  enregistrement: 'https://aida.ineris.fr/reglementation/arretes-ministeriels-prescriptions-applicables-icpe-soumises-a-enregistrement-guides',
  autorisation: 'https://aida.ineris.fr/reglementation/arretes-ministeriels-prescriptions-applicables-icpe-soumises-a-autorisation',
}

// Cache des pages d'index AIDA (évite de refetcher pour chaque rubrique dans la même requête)
const indexCache: Record<string, string> = {}

async function fetchAidaIndex(regime: string): Promise<string> {
  const key = regime.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (indexCache[key]) return indexCache[key]

  const url = AIDA_INDEX_URLS[key]
  if (!url) return ''

  console.log(`Fetching AIDA index for regime: ${key}`)
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; BatiproBot/1.0)',
      'Accept': 'text/html',
    }
  })

  if (!response.ok) {
    console.error(`Failed to fetch AIDA index (${response.status})`)
    return ''
  }

  const html = await response.text()
  indexCache[key] = html
  return html
}

function findArreteUrlInIndex(html: string, rubriqueCode: string): string | null {
  // Normaliser le code (enlever suffixes comme "a" dans "1510a", "2910a")
  const baseCode = rubriqueCode.replace(/[a-zA-Z]+$/, '')

  // Chercher dans le HTML les liens /reglementation/arrete-... associés à la rubrique
  // Pattern: le code rubrique apparaît dans le texte, suivi (proche) d'un lien vers un arrêté
  // On cherche des blocs qui contiennent le code rubrique ET un lien arrêté

  // Approche: extraire toutes les paires (rubrique mentionnée, URL arrêté)
  // Les pages AIDA ont un format: texte avec numéro rubrique + lien <a href="/reglementation/arrete-...">

  // Regex pour trouver des blocs contenant le code rubrique et un lien arrêté
  // On cherche le code rubrique suivi dans les 500 caractères d'un lien arrêté
  const escapedCode = baseCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Pattern 1: rubrique code suivi d'un lien arrêté (le plus courant)
  const pattern1 = new RegExp(
    `(?:rubrique[^"]*?)?\\b${escapedCode}\\b[\\s\\S]{0,500}?href="(/reglementation/arrete-[^"]+)"`,
    'gi'
  )

  // Pattern 2: lien arrêté dont le texte/contexte mentionne la rubrique
  const pattern2 = new RegExp(
    `href="(/reglementation/arrete-[^"]+)"[^>]*>[^<]*[\\s\\S]{0,300}?\\b${escapedCode}\\b`,
    'gi'
  )

  let match = pattern1.exec(html)
  if (match) {
    const url = `https://aida.ineris.fr${match[1]}`
    console.log(`Found arrêté URL for ${rubriqueCode} via pattern1: ${url}`)
    return url
  }

  match = pattern2.exec(html)
  if (match) {
    const url = `https://aida.ineris.fr${match[1]}`
    console.log(`Found arrêté URL for ${rubriqueCode} via pattern2: ${url}`)
    return url
  }

  console.log(`No arrêté URL found in index for rubrique ${rubriqueCode}`)
  return null
}

async function findArreteUrlFromIndex(rubrique: { code: string, regime: string }): Promise<string | null> {
  const regimeKey = rubrique.regime?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || ''
  const html = await fetchAidaIndex(regimeKey)
  if (!html) return null
  return findArreteUrlInIndex(html, rubrique.code)
}

// ─── MAIN HANDLER ───────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { rubriques, mode } = body

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY non configuree')
    }

    // ─── MODE ANALYSE : bouton « Approfondir avec l'IA » (etape 3) ───
    // Le prompt est construit ICI, pas dans le navigateur : il est editable
    // depuis l'admin, et la fonction n'accepte plus de prompt libre.
    if (mode === 'analyse') {
      const list = normalizeRubriques(body.rubriques)
      if (list.length === 0) throw new Error('Parametre "rubriques" requis pour mode analyse')

      const template = await loadPrompt('icpe-approfondir', FALLBACK_APPROFONDIR)
      const prompt = renderPrompt(template, {
        RUBRIQUES: formatRubriques(list),
        PRESCRIPTIONS: formatPrescriptions(body.prescriptions, list, 'Prescriptions extraites des arretes:'),
      })

      const text = await callGeminiText(prompt, GEMINI_MODEL, 0.2, 4000)
      return new Response(JSON.stringify({ text }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ─── MODE CHATBOT : chat expert ICPE ───
    if (mode === 'chatbot') {
      const question = String(body.question ?? '').trim().slice(0, 4000)
      if (!question) throw new Error('Parametre "question" requis pour mode chatbot')

      const list = normalizeRubriques(body.rubriques)
      const template = await loadPrompt('icpe-chatbot', FALLBACK_CHATBOT)
      const projet = String(body.projet ?? '').trim().slice(0, 200)
      const localisation = String(body.localisation ?? '').trim().slice(0, 200)

      const prompt = renderPrompt(template, {
        RUBRIQUES: formatRubriques(list),
        PRESCRIPTIONS: formatPrescriptions(body.prescriptions, list, 'PRESCRIPTIONS EXTRAITES DES ARRETES :'),
        PROJET: projet ? `Projet: ${projet}` : '',
        LOCALISATION: localisation ? `Localisation: ${localisation}` : '',
        QUESTION: question,
      })

      const model = ALLOWED_MODELS.has(body.model) ? String(body.model) : CHAT_MODEL
      const text = await callGeminiText(prompt, model, 0.3, 2000)
      return new Response(JSON.stringify({ text }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ─── MODE SIMULATEUR : extraction des tableaux de prescriptions ───
    if (!rubriques || !Array.isArray(rubriques) || rubriques.length === 0) {
      throw new Error('Parametre "rubriques" requis (tableau)')
    }

    // For each rubrique, fetch the relevant arrêté text (if available)
    const arretesTexts: Record<string, string> = {}
    const needsGrounding: Set<string> = new Set()
    const fetchPromises: Promise<void>[] = []

    for (const rub of rubriques) {
      const regimeKey = rub.regime?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') || ''
      const db = ARRETES_DB[rub.code]

      if (!db) {
        // Pas d'arrêté en base → trouver l'URL via Google Search grounding
        needsGrounding.add(rub.code)
        arretesTexts[rub.code] = ''
        continue
      }

      const arrete = db[regimeKey] || Object.values(db)[0]
      if (!arrete) {
        needsGrounding.add(rub.code)
        arretesTexts[rub.code] = ''
        continue
      }

      fetchPromises.push(
        fetchAidaText(arrete.url)
          .then(text => {
            arretesTexts[rub.code] = `=== ARRETE pour rubrique ${rub.code} (${arrete.title}) ===\nSource: ${arrete.url}\n\n${text}`
          })
          .catch(err => {
            console.error(`Error fetching arrete for ${rub.code}:`, err)
            needsGrounding.add(rub.code)
            arretesTexts[rub.code] = ''
          })
      )
    }

    await Promise.all(fetchPromises)

    // Step 2: For rubriques not in ARRETES_DB, search AIDA index pages for the arrêté URL
    if (needsGrounding.size > 0) {
      const indexPromises = rubriques
        .filter((rub: { code: string }) => needsGrounding.has(rub.code))
        .map(async (rub: { code: string, regime: string, intitule: string }) => {
          try {
            const url = await findArreteUrlFromIndex(rub)
            if (url) {
              const text = await fetchAidaText(url)
              arretesTexts[rub.code] = `=== ARRETE pour rubrique ${rub.code} (trouvé via index AIDA) ===\nSource: ${url}\n\n${text}`
              needsGrounding.delete(rub.code) // Successfully resolved
            }
          } catch (err) {
            console.error(`Error fetching arrêté from AIDA index for ${rub.code}:`, err)
          }
        })

      await Promise.all(indexPromises)
    }

    let finalResult: Record<string, unknown>

    // Simulateur: one Gemini call PER rubrique, then merge
    // Un seul chargement du template pour toutes les rubriques de la requête.
    const extractionTemplate = await loadPrompt('icpe-tableau-prescriptions', FALLBACK_TABLEAU)

    const geminiPromises = rubriques.map(async (rub: { code: string, regime: string, intitule: string }) => {
      if (needsGrounding.has(rub.code)) {
        // Aucun arrêté en base ni via l'index AIDA → on laisse Gemini chercher
        // lui-même l'arrêté type (Google Search grounding) et l'extraire.
        try {
          const prompt = buildGroundedSinglePrompt(rub)
          const result = await callGeminiGrounded(prompt)
          return { code: rub.code, data: parseJsonLoose(result) }
        } catch (err) {
          console.error(`Grounding échoué pour ${rub.code}, fallback statique:`, err)
          return { code: rub.code, data: buildFallbackResponse(rub) }
        }
      }
      const prompt = buildSimulateurSinglePrompt(extractionTemplate, rub, arretesTexts[rub.code] || '')
      const result = await callGemini(prompt)
      return { code: rub.code, data: parseJsonLoose(result) }
    })

    const results = await Promise.all(geminiPromises)
    finalResult = {}
    for (const r of results) {
      const rub = rubriques.find((x: { code: string }) => x.code === r.code)
      finalResult[r.code] = normalizeRubriqueResult(
        (r.data[r.code] || r.data) as Record<string, unknown>,
        rub?.regime || '',
      )
    }

    return new Response(JSON.stringify(finalResult), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// ─── PROMPT BUILDERS ────────────────────────────────────────

// Replis des prompts editables, utilises si ai_prompts est injoignable.
// ⚠️ Doivent rester alignes avec les slots de la migration 20260917100000.
// Si tu modifies ici, modifie aussi le seed.
const FALLBACK_APPROFONDIR = `Tu es un expert ICPE specialise dans les entrepots et batiments industriels en France.

Voici les rubriques identifiees pour ce projet:
{{RUBRIQUES}}
{{PRESCRIPTIONS}}

A partir des prescriptions extraites ci-dessus, fournis une analyse contextuelle:
1. Interactions et cumuls entre les rubriques: quand plusieurs rubriques imposent des prescriptions sur le meme theme, identifie la valeur la PLUS CONTRAIGNANTE (ex: la distance la plus grande, le REI le plus eleve)
2. Points de vigilance specifiques a cette combinaison
3. Prescriptions qui se cumulent ou entrent en conflit — avec les valeurs chiffrees
4. Recommandations pratiques pour le maitre d'ouvrage

Reponds en JSON avec cette structure:
{
  "interactions": "texte sur les interactions entre rubriques",
  "vigilance": ["point 1", "point 2", ...],
  "cumuls": "texte sur les cumuls de prescriptions",
  "recommandations": ["reco 1", "reco 2", ...]
}`

const FALLBACK_CHATBOT = `Tu es un expert ICPE (Installations Classees pour la Protection de l'Environnement) specialise dans la reglementation francaise des batiments industriels et entrepots.

Contexte du projet en cours:
{{RUBRIQUES}}
{{PRESCRIPTIONS}}
{{PROJET}}
{{LOCALISATION}}

Question de l'utilisateur: {{QUESTION}}

INSTRUCTIONS :
- Base tes reponses sur les PRESCRIPTIONS EXTRAITES ci-dessus quand elles sont disponibles
- Quand plusieurs rubriques ont des prescriptions sur le meme theme, indique la valeur la plus contraignante
- Cite les rubriques sources (ex: "Rubrique 1510 impose REI 120, plus contraignant que la 1511 qui impose REI 60")
- Reponds de maniere precise et concise
- Emploie la terminologie ICPE avec rigueur : ne confonds JAMAIS des notions distinctes. Exemple : un "local a risque" (local a risques particuliers/importants au sens securite incendie : chaufferie, local de charge, stockage de matieres dangereuses...) n'est PAS l'ensemble des locaux du batiment. Si un terme reglementaire a une definition precise, applique-la strictement.

RIGUEUR ET POSTURE D'EXPERT (important) :
- Ne change PAS d'avis simplement parce que l'utilisateur affirme le contraire. S'il te corrige et que tu es sur de toi, maintiens ta position en citant l'article ou la prescription qui la fonde.
- Si l'utilisateur a effectivement raison, reconnais-le sobrement et corrige-toi, sans formules de remerciement excessives ni flagornerie ("vous avez tout a fait raison", "merci de cette precision"...). Va droit au fait.
- Si tu n'es pas certain, dis-le explicitement plutot que d'inventer ou de te ranger a l'avis de l'interlocuteur. Mieux vaut "je ne suis pas certain, a verifier dans l'arrete X" qu'une affirmation fausse.`

// Repli du prompt d'extraction, utilise si ai_prompts est injoignable.
// ⚠️ Doit rester alignee avec le slot `icpe-tableau-prescriptions` (derniere
// version : migration 20261120100000). Si tu modifies ici, ajoute une migration.
const FALLBACK_TABLEAU = `Tu es un assistant specialise en reglementation ICPE.

MISSION : A partir du TEXTE REGLEMENTAIRE FOURNI CI-DESSOUS, extraire les prescriptions techniques pour la rubrique et le regime demande.

RUBRIQUE : {{CODE}} - {{INTITULE}} — Regime : {{REGIME}}

TEXTE REGLEMENTAIRE SOURCE :
{{ARRETE}}

REGLES :
- Extrais les informations presentes dans le texte ci-dessus
- IMPORTANT : Les prescriptions de l'arrete s'appliquent au regime demande meme si le texte ne mentionne pas explicitement le nom du regime. Un arrete type couvre generalement TOUS les regimes de la rubrique. Extrais les prescriptions du texte et attribue-les au regime demande.
- Si une categorie de prescription n'est veritablement pas abordee du tout dans le texte (pas un seul mot sur le sujet), indique "Non precise dans l'arrete"
- Utilise la terminologie exacte du texte (REI, EI, R15, R30, R60, Broof t3, etc.)
- Inclus les valeurs numeriques exactes telles qu'elles apparaissent dans l'arrete
- Pour Autorisation sans arrete type, indique "Selon arrete prefectoral"
REDACTION — les prescriptions sont lues par des architectes et projeteurs qui ne sont PAS specialistes ICPE :
- Pour chaque theme, ecris 1 a 3 phrases completes et autoportantes : d'abord l'exigence avec ses valeurs exactes, puis A QUOI et QUAND elle s'applique (element concerne, seuil, condition d'application), puis les alternatives ou exceptions prevues par le texte (ex : "reductible a ... si extinction automatique").
- Pas de style telegraphique : "REI 120" seul ne suffit pas. Ecris par exemple : "Murs separatifs entre cellules REI 120 (coupe-feu 2 h), depassant d'au moins 1 m la couverture."
- Termine chaque valeur par la reference de l'article ou du point d'annexe entre crochets, par exemple [Annexe II, point 6] ou [Art. 11]. N'invente JAMAIS de reference : si tu ne peux pas la situer dans le texte fourni, n'en mets pas.
- Synthetise fidelement sans recopier de paragraphes entiers, et sans commentaire ni conseil personnel.

Reponds avec un objet JSON :
{
  "{{CODE}}": {
    "{{REGIME}}": {
      "reseaux": {
        "Eaux pluviales": "..."
      },
      "dechets": {
        "Gestion des dechets": "..."
      },
      "implantation": {
        "Distances limites": "...",
        "Distances inter-batiments": "..."
      },
      "accessibilite": {
        "Acces au site": "...",
        "Voie engin": "...",
        "Echelles": "...",
        "Issues et quais": "...",
        "Locaux a risques": "..."
      },
      "construction": {
        "Structure": "...",
        "Toiture": "...",
        "Facades": "...",
        "Portes et fermetures": "..."
      },
      "cantonnement": {
        "Surface cellules": "...",
        "Murs separatifs": "...",
        "Ecrans de cantonnement": "..."
      },
      "desenfumage": {
        "Surface utile": "...",
        "Commandes": "...",
        "Exutoires": "..."
      },
      "stockage": {
        "Hauteur stockage": "...",
        "Allees de circulation": "...",
        "Distance aux parois": "..."
      },
      "lutte_incendie": {
        "Extincteurs": "...",
        "RIA": "...",
        "Sprinkler": "...",
        "Colonnes seches": "..."
      },
      "eau_incendie": {
        "Besoins en eau": "...",
        "Retention eaux extinction": "..."
      },
      "ventilation": {
        "Dispositifs de ventilation": "..."
      },
      "elec": {
        "Conformite": "...",
        "Coupure d'urgence": "..."
      },
      "chauffage": {
        "Type autorise": "...",
        "Implantation": "..."
      },
      "exploitation": {
        "Consignes d'exploitation": "...",
        "Verifications periodiques": "..."
      }
    }
  }
}`

function buildSimulateurSinglePrompt(
  template: string,
  rubrique: { code: string, regime: string, intitule: string },
  arreteText: string,
): string {
  return renderPrompt(template, {
    CODE: rubrique.code,
    INTITULE: rubrique.intitule || '',
    REGIME: rubrique.regime,
    ARRETE: arreteText,
  })
}

// Prompt pour l'extraction "groundée" : Gemini cherche lui-même l'arrêté type
// sur le web (aida.ineris.fr / Légifrance) puis en extrait les prescriptions.
function buildGroundedSinglePrompt(rubrique: { code: string, regime: string, intitule: string }): string {
  return `Tu es un expert en reglementation ICPE (installations classees pour la protection de l'environnement, France).

RUBRIQUE : ${rubrique.code} - ${rubrique.intitule || ''} — Regime : ${rubrique.regime}

MISSION :
1. Utilise la recherche Google pour identifier, sur aida.ineris.fr de preference (ou Legifrance), l'ARRETE MINISTERIEL DE PRESCRIPTIONS GENERALES applicable a cette rubrique pour le regime "${rubrique.regime}".
2. A partir du contenu reel de cet arrete, extrais les prescriptions techniques demandees.

REGLES :
- Base-toi uniquement sur le texte reglementaire reel trouve via la recherche. N'invente aucune valeur.
- Si le regime "${rubrique.regime}" n'a PAS d'arrete type (frequent en Autorisation : prescriptions fixees au cas par cas) : mets "Selon arrete prefectoral" dans chaque champ.
- Si un theme precis n'est pas aborde dans l'arrete : "Non precise dans l'arrete".
- Si tu ne trouves vraiment aucun arrete type applicable : mets "Arrete type non trouve - consulter aida.ineris.fr" dans chaque champ.
- Terminologie exacte (REI 120, R15, R30, R60, Broof t3, etc.) et valeurs numeriques exactes.
- REDACTION (lecteurs : architectes non specialistes ICPE) : pour chaque theme, 1 a 3 phrases completes — l'exigence avec ses valeurs exactes, a quoi et quand elle s'applique (element, seuil, condition), les alternatives ou exceptions prevues. Pas de style telegraphique.
- Termine chaque valeur par la reference de l'article ou du point d'annexe entre crochets, ex : [Annexe II, point 6] ou [Art. 11]. N'invente jamais de reference : si tu ne peux pas la situer, n'en mets pas.

Reponds UNIQUEMENT avec un objet JSON valide, sans aucun texte autour ni balise markdown :
{
  "${rubrique.code}": {
    "${rubrique.regime}": {
      "reseaux": { "Eaux pluviales": "..." },
      "dechets": { "Gestion des dechets": "..." },
      "implantation": { "Distances limites": "...", "Distances inter-batiments": "..." },
      "accessibilite": { "Acces au site": "...", "Voie engin": "...", "Echelles": "...", "Issues et quais": "...", "Locaux a risques": "..." },
      "construction": { "Structure": "...", "Toiture": "...", "Facades": "...", "Portes et fermetures": "..." },
      "cantonnement": { "Surface cellules": "...", "Murs separatifs": "...", "Ecrans de cantonnement": "..." },
      "desenfumage": { "Surface utile": "...", "Commandes": "...", "Exutoires": "..." },
      "stockage": { "Hauteur stockage": "...", "Allees de circulation": "...", "Distance aux parois": "..." },
      "lutte_incendie": { "Extincteurs": "...", "RIA": "...", "Sprinkler": "...", "Colonnes seches": "..." },
      "eau_incendie": { "Besoins en eau": "...", "Retention eaux extinction": "..." },
      "ventilation": { "Dispositifs de ventilation": "..." },
      "elec": { "Conformite": "...", "Coupure d'urgence": "..." },
      "chauffage": { "Type autorise": "...", "Implantation": "..." },
      "exploitation": { "Consignes d'exploitation": "...", "Verifications periodiques": "..." }
    }
  }
}`
}

// ─── Remise en ordre de la structure renvoyée par le modèle ───
// Il arrive que le modèle referme l'objet du régime trop tôt : une partie des
// thèmes se retrouve au niveau de la rubrique (à côté de "Declaration") ou un
// item isolé atterrit directement dans le régime. Le simulateur ne lit que
// rubrique → régime → thème → item : ces valeurs s'affichaient alors « - ».
// On replace chaque thème / item à sa place, sans rien inventer ni perdre.

const CATEGORY_ITEMS: Record<string, string[]> = {
  reseaux: ['Eaux pluviales'],
  dechets: ['Gestion des dechets'],
  implantation: ['Distances limites', 'Distances inter-batiments'],
  accessibilite: ['Acces au site', 'Voie engin', 'Echelles', 'Issues et quais', 'Locaux a risques'],
  construction: ['Structure', 'Toiture', 'Facades', 'Portes et fermetures'],
  cantonnement: ['Surface cellules', 'Murs separatifs', 'Ecrans de cantonnement'],
  desenfumage: ['Surface utile', 'Commandes', 'Exutoires'],
  stockage: ['Hauteur stockage', 'Allees de circulation', 'Distance aux parois'],
  lutte_incendie: ['Extincteurs', 'RIA', 'Sprinkler', 'Colonnes seches'],
  eau_incendie: ['Besoins en eau', 'Retention eaux extinction'],
  ventilation: ['Dispositifs de ventilation'],
  elec: ['Conformite', "Coupure d'urgence"],
  chauffage: ['Type autorise', 'Implantation'],
  exploitation: ["Consignes d'exploitation", 'Verifications periodiques'],
}
// "Implantation" est à la fois un item (chauffage) et proche du thème
// "implantation" : la recherche d'item se fait donc en respectant la casse.
const ITEM_TO_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_ITEMS).flatMap(([cat, items]) => items.map(i => [i, cat])),
)

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function normalizeRubriqueResult(raw: Record<string, unknown>, regime: string): Record<string, unknown> {
  if (!isObj(raw)) return raw
  const keys = Object.keys(raw)
  // Clé du régime : celle demandée, sinon la première qui n'est pas un thème
  const regimeKey = (regime && isObj(raw[regime])) ? regime
    : keys.find(k => !(k in CATEGORY_ITEMS) && isObj(raw[k]))
  if (!regimeKey) return raw

  const out: Record<string, Record<string, unknown>> = {}
  const put = (cat: string, item: string, val: unknown) => {
    out[cat] = out[cat] || {}
    if (out[cat][item] === undefined) out[cat][item] = val
  }
  const absorb = (src: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(src)) {
      if (k in CATEGORY_ITEMS && isObj(v)) {
        for (const [item, val] of Object.entries(v)) put(k, item, val)
      } else if (k in ITEM_TO_CATEGORY && !isObj(v)) {
        put(ITEM_TO_CATEGORY[k], k, v)
      }
    }
  }
  absorb(raw[regimeKey] as Record<string, unknown>)
  // Thèmes ou items égarés au niveau de la rubrique
  const stray: Record<string, unknown> = {}
  for (const k of keys) if (k !== regimeKey) stray[k] = raw[k]
  absorb(stray)

  const repaired = Object.keys(stray).some(k => k in CATEGORY_ITEMS || k in ITEM_TO_CATEGORY) ||
    Object.keys(raw[regimeKey] as Record<string, unknown>).some(k => !(k in CATEGORY_ITEMS))
  if (repaired) console.warn(`icpe-prescriptions : structure réparée pour le régime ${regimeKey}`)

  // Les autres régimes éventuellement fournis (rares) sont conservés tels quels
  const result: Record<string, unknown> = { [regimeKey]: out }
  for (const k of keys) {
    if (k !== regimeKey && !(k in CATEGORY_ITEMS) && !(k in ITEM_TO_CATEGORY) && isObj(raw[k])) result[k] = raw[k]
  }
  return result
}

// Fallback quand aucun arrêté n'a pu être trouvé/récupéré
function buildFallbackResponse(rubrique: { code: string, regime: string, intitule: string }): Record<string, unknown> {
  const msg = rubrique.regime?.toLowerCase().includes('autor')
    ? 'Selon arrete prefectoral'
    : 'Arrete type non trouve - consulter aida.ineris.fr'

  return {
    [rubrique.code]: {
      [rubrique.regime]: {
        reseaux: { 'Eaux pluviales': msg },
        dechets: { 'Gestion des dechets': msg },
        implantation: { 'Distances limites': msg, 'Distances inter-batiments': msg },
        accessibilite: { 'Acces au site': msg, 'Voie engin': msg, 'Echelles': msg, 'Issues et quais': msg, 'Locaux a risques': msg },
        construction: { 'Structure': msg, 'Toiture': msg, 'Facades': msg, 'Portes et fermetures': msg },
        cantonnement: { 'Surface cellules': msg, 'Murs separatifs': msg, 'Ecrans de cantonnement': msg },
        desenfumage: { 'Surface utile': msg, 'Commandes': msg, 'Exutoires': msg },
        stockage: { 'Hauteur stockage': msg, 'Allees de circulation': msg, 'Distance aux parois': msg },
        lutte_incendie: { 'Extincteurs': msg, 'RIA': msg, 'Sprinkler': msg, 'Colonnes seches': msg },
        eau_incendie: { 'Besoins en eau': msg, 'Retention eaux extinction': msg },
        ventilation: { 'Dispositifs de ventilation': msg },
        elec: { 'Conformite': msg, "Coupure d'urgence": msg },
        chauffage: { 'Type autorise': msg, 'Implantation': msg },
        exploitation: { "Consignes d'exploitation": msg, 'Verifications periodiques': msg }
      }
    }
  }
}
