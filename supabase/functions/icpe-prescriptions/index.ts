import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!
const GEMINI_MODEL = 'gemini-2.0-flash'
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`

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

// ─── CALL GEMINI ────────────────────────────────────────────

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

  const result = await response.json()
  if (result.error) throw new Error(result.error.message)
  return result.candidates[0].content.parts[0].text
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
    const { rubriques, mode } = await req.json()

    if (!rubriques || !Array.isArray(rubriques) || rubriques.length === 0) {
      throw new Error('Parametre "rubriques" requis (tableau)')
    }

    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY non configuree')
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

    if (mode === 'analyse') {
      const rub = rubriques[0]
      if (needsGrounding.has(rub.code)) {
        // No arrêté found even after grounding search — return fallback message
        finalResult = buildFallbackResponse(rub, mode)
      } else {
        const prompt = buildAnalysePrompt(rub, arretesTexts[rub.code] || '')
        const result = await callGemini(prompt)
        finalResult = JSON.parse(result)
      }
    } else {
      // Simulateur: one Gemini call PER rubrique, then merge
      const geminiPromises = rubriques.map(async (rub: { code: string, regime: string, intitule: string }) => {
        if (needsGrounding.has(rub.code)) {
          // No arrêté found — return fallback
          return { code: rub.code, data: buildFallbackResponse(rub, 'simulateur') }
        }
        const prompt = buildSimulateurSinglePrompt(rub, arretesTexts[rub.code] || '')
        const result = await callGemini(prompt)
        return { code: rub.code, data: JSON.parse(result) }
      })

      const results = await Promise.all(geminiPromises)
      finalResult = {}
      for (const r of results) {
        finalResult[r.code] = r.data[r.code] || r.data
      }
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

function buildSimulateurSinglePrompt(rubrique: { code: string, regime: string, intitule: string }, arreteText: string): string {
  return `Tu es un assistant specialise en reglementation ICPE.

MISSION : A partir du TEXTE REGLEMENTAIRE FOURNI CI-DESSOUS, extraire les prescriptions techniques pour la rubrique et le regime demande.

RUBRIQUE : ${rubrique.code} - ${rubrique.intitule || ''} — Regime : ${rubrique.regime}

TEXTE REGLEMENTAIRE SOURCE :
${arreteText}

REGLES :
- Extrais les informations presentes dans le texte ci-dessus
- IMPORTANT : Les prescriptions de l'arrete s'appliquent au regime demande meme si le texte ne mentionne pas explicitement le nom du regime. Un arrete type couvre generalement TOUS les regimes de la rubrique. Extrais les prescriptions du texte et attribue-les au regime demande.
- Si une categorie de prescription n'est veritablement pas abordee du tout dans le texte (pas un seul mot sur le sujet), indique "Non precise dans l'arrete"
- Utilise la terminologie exacte du texte (REI, EI, R15, R30, R60, Broof t3, etc.)
- Inclus les valeurs numeriques exactes telles qu'elles apparaissent dans l'arrete
- Pour Autorisation sans arrete type, indique "Selon arrete prefectoral"
- Sois CONCIS : donne les valeurs cles et exigences, pas de phrases de contexte inutiles. Ex: "REI 120, R15 structure" plutot que de recopier des paragraphes entiers

Reponds avec un objet JSON :
{
  "${rubrique.code}": {
    "${rubrique.regime}": {
      "implantation": {
        "Distances limites": "...",
        "Distances inter-batiments": "..."
      },
      "accessibilite": {
        "Acces au site": "...",
        "Voie engin": "...",
        "Echelles": "...",
        "Issues et quais": "..."
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
      "elec": {
        "Conformite": "...",
        "Coupure d'urgence": "..."
      },
      "chauffage": {
        "Type autorise": "...",
        "Implantation": "..."
      }
    }
  }
}`
}

function buildAnalysePrompt(rubrique: { code: string, regime: string, intitule: string, arrete?: string }, arreteText: string): string {
  return `Tu es un expert en reglementation ICPE.

MISSION : A partir du TEXTE REGLEMENTAIRE FOURNI CI-DESSOUS, generer l'analyse detaillee des prescriptions pour :

Rubrique : ${rubrique.code} ${rubrique.intitule ? '(' + rubrique.intitule + ')' : ''}
Regime : ${rubrique.regime}
${rubrique.arrete ? 'Arrete de reference : ' + rubrique.arrete : ''}

TEXTE REGLEMENTAIRE SOURCE :
${arreteText}

REGLES :
- Extrais les informations presentes dans le texte ci-dessus
- IMPORTANT : Les prescriptions de l'arrete s'appliquent au regime demande meme si le texte ne mentionne pas explicitement le nom du regime. Un arrete type couvre generalement TOUS les regimes de la rubrique. Extrais les prescriptions du texte et attribue-les au regime demande.
- Inclus les valeurs numeriques exactes (distances en m, surfaces en m2, debits, classes de resistance au feu REI/EI/R)
- Cite les normes (NF EN, NF C, etc.) mentionnees dans l'arrete
- Si une categorie de prescription n'est veritablement pas abordee du tout dans le texte, indique "Non precise dans l'arrete type"
- NE JAMAIS INVENTER de valeur
- Sois PRECIS mais CONCIS : donne les exigences cles avec valeurs, pas de recopie de paragraphes entiers. Ex: "Voie engin: largeur 6m min, hauteur libre 4,5m, force portante 16t, rayon interieur 11m"

Reponds avec un objet JSON :
{
  "reseaux_eau": "Prescriptions exactes extraites du texte...",
  "reseaux_eaux_pluviales": "...",
  "dechets": "...",
  "implantation": "...",
  "accessibilite_site": "...",
  "accessibilite_voie_engin": "...",
  "accessibilite_echelles": "...",
  "accessibilite_issues": "...",
  "locaux_risques": "...",
  "desenfumage": "...",
  "eau_incendie_retention": "...",
  "eau_incendie_isolement": "...",
  "eau_incendie_moyens": "...",
  "ventilation": "...",
  "installations_electriques": "...",
  "chauffage": "...",
  "exploitation_entretien": "..."
}`
}

// Fallback quand aucun arrêté n'a pu être trouvé/récupéré
function buildFallbackResponse(rubrique: { code: string, regime: string, intitule: string }, mode: string): Record<string, unknown> {
  const msg = rubrique.regime?.toLowerCase().includes('autor')
    ? 'Selon arrete prefectoral'
    : 'Arrete type non trouve - consulter aida.ineris.fr'

  if (mode === 'analyse') {
    return {
      reseaux_eau: msg, reseaux_eaux_pluviales: msg, dechets: msg,
      implantation: msg, accessibilite_site: msg, accessibilite_voie_engin: msg,
      accessibilite_echelles: msg, accessibilite_issues: msg, locaux_risques: msg,
      desenfumage: msg, eau_incendie_retention: msg, eau_incendie_isolement: msg,
      eau_incendie_moyens: msg, ventilation: msg, installations_electriques: msg,
      chauffage: msg, exploitation_entretien: msg
    }
  }

  return {
    [rubrique.code]: {
      [rubrique.regime]: {
        implantation: { 'Distances limites': msg, 'Distances inter-batiments': msg },
        accessibilite: { 'Acces au site': msg, 'Voie engin': msg, 'Echelles': msg, 'Issues et quais': msg },
        construction: { 'Structure': msg, 'Toiture': msg, 'Facades': msg, 'Portes et fermetures': msg },
        cantonnement: { 'Surface cellules': msg, 'Murs separatifs': msg, 'Ecrans de cantonnement': msg },
        desenfumage: { 'Surface utile': msg, 'Commandes': msg, 'Exutoires': msg },
        stockage: { 'Hauteur stockage': msg, 'Allees de circulation': msg, 'Distance aux parois': msg },
        lutte_incendie: { 'Extincteurs': msg, 'RIA': msg, 'Sprinkler': msg, 'Colonnes seches': msg },
        eau_incendie: { 'Besoins en eau': msg, 'Retention eaux extinction': msg },
        elec: { 'Conformite': msg, "Coupure d'urgence": msg },
        chauffage: { 'Type autorise': msg, 'Implantation': msg }
      }
    }
  }
}
