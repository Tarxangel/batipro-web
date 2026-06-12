import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!
const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const INLINE_MAX_BYTES = 15_000_000 // 15 MB - au dela on utilise Files API
const PDF_EXTRACTOR_URL = Deno.env.get('PDF_EXTRACTOR_URL') || '' // URL du micro-service d'extraction PDF

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ─── IGN APIs ────────────────────────────────────────────────

interface IGNParcelleResponse {
  type: string
  features: Array<{
    properties: {
      nom_com: string
      section: string
      numero: string
      contenance: number
      code_dep: string
      code_com: string
      com_abs: string
      code_arr: string
    }
  }>
}

interface IGNZoneUrbaResponse {
  totalFeatures: number
  features: Array<{
    properties: {
      libelle: string
      partition: string
      gpu_doc_id: string
      nomfic: string
    }
  }>
}

// apicarto IGN (cadastre + GPU) est régulièrement instable : il renvoie des 500
// transitoires (et parfois 429/503), surtout quand le Géoportail de l'urbanisme
// est sous charge. Sans retry, le moindre hoquet faisait planter TOUTE l'analyse
// (« 0 retour »). On réessaie donc avec un backoff progressif sur les erreurs
// transitoires (5xx / 429) et les erreurs réseau.
async function fetchIGNWithRetry(url: string, label: string, retries = 4, baseDelayMs = 700): Promise<Response> {
  let lastStatus = 0
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url)
      if (resp.ok) return resp
      lastStatus = resp.status
      // 5xx / 429 = transitoire → on retente ; 4xx (hors 429) = définitif → on sort
      if (resp.status < 500 && resp.status !== 429) {
        throw new Error(`IGN ${label} API error: ${resp.status}`)
      }
    } catch (e) {
      // Erreur réseau (DNS/timeout) : on retente aussi, sauf au dernier tour
      if (attempt === retries) throw e
    }
    if (attempt < retries) {
      const delay = baseDelayMs * (attempt + 1) // 700, 1400, 2100, 2800 ms
      console.log(`⏳ IGN ${label} ${lastStatus || 'réseau'} — retry ${attempt + 1}/${retries} dans ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error(`IGN ${label} API error: ${lastStatus || 'réseau'} (après ${retries} retries)`)
}

async function fetchIGNParcelle(lat: number, lon: number): Promise<IGNParcelleResponse> {
  const geom = JSON.stringify({ type: 'Point', coordinates: [lon, lat] })
  const url = `https://apicarto.ign.fr/api/cadastre/parcelle?geom=${encodeURIComponent(geom)}`
  const resp = await fetchIGNWithRetry(url, 'Parcelle')
  return resp.json()
}

async function fetchIGNZoneUrba(lat: number, lon: number): Promise<IGNZoneUrbaResponse> {
  const geom = JSON.stringify({ type: 'Point', coordinates: [lon, lat] })
  const url = `https://apicarto.ign.fr/api/gpu/zone-urba?geom=${encodeURIComponent(geom)}`
  const resp = await fetchIGNWithRetry(url, 'Zone Urba')
  return resp.json()
}

// ─── Mérimée API (monuments historiques) ─────────────────────

export interface MonumentHistorique {
  reference: string       // ex: "PA25000077"
  name: string            // titre éditorial ou dénomination
  type: string | null     // ex: "hôtel", "église"
  protection: string | null  // ex: "classé MH", "inscrit MH"
  century: string | null  // ex: "16e siècle"
  distance_m: number      // calculé par Haversine
  lat: number
  lon: number
}

// Distance entre deux points lat/lon en mètres (Haversine).
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(a)))
}

// Fetch Mérimée (data.culture.gouv.fr) — immeubles MH dans un rayon.
// Tolère les erreurs : renvoie [] si l'API tombe, n'interrompt pas l'analyse.
async function fetchMerimeeMonuments(
  lat: number,
  lon: number,
  radiusMeters = 500,
  limit = 30,
): Promise<MonumentHistorique[]> {
  try {
    const select = [
      'reference',
      'titre_editorial_de_la_notice',
      'denomination_de_l_edifice',
      'typologie_de_la_protection',
      'siecle_de_la_campagne_principale_de_construction',
      'coordonnees_au_format_wgs84',
    ].join(',')
    const where = `within_distance(coordonnees_au_format_wgs84,GEOM'POINT(${lon} ${lat})',${radiusMeters}m)`
    const url = `https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/liste-des-immeubles-proteges-au-titre-des-monuments-historiques/records?where=${encodeURIComponent(where)}&select=${encodeURIComponent(select)}&limit=${limit}`

    const resp = await fetch(url)
    if (!resp.ok) {
      console.warn(`⚠️ Mérimée API ${resp.status} — on continue sans MH`)
      return []
    }
    const data = await resp.json()
    const records = Array.isArray(data.results) ? data.results : []

    const items: MonumentHistorique[] = records
      .map((r: any) => {
        const coords = r.coordonnees_au_format_wgs84
        if (!coords || typeof coords.lat !== 'number' || typeof coords.lon !== 'number') return null
        return {
          reference: String(r.reference || ''),
          name: String(
            r.titre_editorial_de_la_notice
              || r.denomination_de_l_edifice
              || 'Monument sans titre'
          ),
          type: r.denomination_de_l_edifice || null,
          protection: r.typologie_de_la_protection || null,
          century: r.siecle_de_la_campagne_principale_de_construction || null,
          distance_m: haversineMeters(lat, lon, coords.lat, coords.lon),
          lat: coords.lat,
          lon: coords.lon,
        }
      })
      .filter((x: MonumentHistorique | null): x is MonumentHistorique => x !== null)
      .sort((a: MonumentHistorique, b: MonumentHistorique) => a.distance_m - b.distance_m)

    console.log(`🏛️ Mérimée: ${items.length} MH dans ${radiusMeters}m`)
    return items
  } catch (err) {
    console.warn(`⚠️ Mérimée fetch erreur — on continue sans MH:`, err)
    return []
  }
}

// ─── Parcel Info ─────────────────────────────────────────────

interface ParcelInfo {
  commune: string
  section: string
  numero: string
  surface: number
  url_parcelle: string
  zonage: string
  zone_code: string    // code complet affiché (ex: "UXA") — pour la réponse/affichage
  zone_parent: string  // zone mère réglementaire (ex: "UX") — pour l'extraction + le prompt
  zone_secteur: string // code complet si c'est un secteur (ex: "UXA"), sinon ''
}

// Dérive le code réglementaire à partir du libellé IGN.
// Les règlements PLU sont organisés par ZONE MÈRE (UX, UA, 1AU, N...). Les
// secteurs sont notés par un suffixe en minuscules (UXa, Nh...) et héritent des
// règles de leur zone mère. On analyse donc le chapitre de la zone mère, en
// signalant le secteur pour ses éventuelles spécificités.
// Ex: "UXa - Zone d'activités" → { full: "UXA", parent: "UX", isSecteur: true }
function deriveZone(libelle: string): { full: string; parent: string; isSecteur: boolean } {
  const raw = (libelle || '').trim().split(/\s+/)[0] || ''
  const full = raw.toUpperCase()
  // Zone mère = chiffres optionnels + lettres MAJUSCULES, sans le suffixe secteur en minuscules
  const parent = (raw.match(/^\d*[A-Z]+\d*/)?.[0] || raw).toUpperCase()
  return { full, parent, isSecteur: parent.length > 0 && parent !== full }
}

function buildParcelInfo(parcelle: IGNParcelleResponse, zoneUrba: IGNZoneUrbaResponse): ParcelInfo {
  const p = parcelle.features[0].properties
  const isRNU = zoneUrba.totalFeatures === 0
  const z = isRNU ? null : deriveZone(zoneUrba.features[0].properties.libelle)

  const url_parcelle = `https://www.geoportail-urbanisme.gouv.fr/map/parcel-info/${[
    p.code_dep, p.code_com, p.com_abs, p.code_arr, p.section, p.numero
  ].join('_')}/`

  return {
    commune: p.nom_com,
    section: p.section,
    numero: p.numero,
    surface: p.contenance,
    url_parcelle,
    zonage: isRNU ? 'RNU' : zoneUrba.features[0].properties.libelle,
    zone_code: isRNU ? 'RNU' : z!.full,
    zone_parent: isRNU ? 'RNU' : z!.parent,
    zone_secteur: isRNU ? '' : (z!.isSecteur ? z!.full : ''),
  }
}

// ─── Prompts ─────────────────────────────────────────────────

// Note expliquant à Gemini la relation secteur → zone mère (évite le
// "Non précisé pour la zone UXA" quand le règlement parle de la zone UX).
function buildSecteurNote(zoneParent: string, zoneSecteur: string): string {
  if (!zoneSecteur) return ''
  return `
IMPORTANT - SECTEUR : La parcelle est dans le SECTEUR ${zoneSecteur}, qui fait partie de la ZONE ${zoneParent}.
Le reglement de la zone ${zoneParent} S'APPLIQUE au secteur ${zoneSecteur}, sauf dispositions particulieres propres au secteur.
=> Analyse le chapitre de la ZONE ${zoneParent} et integre les eventuelles specificites du secteur ${zoneSecteur}.
=> Ne traite PAS les regles de la zone ${zoneParent} comme "une autre zone" : c'est bien la zone de la parcelle.
`
}

function buildPLUPrompt(commune: string, zonage: string, zoneParent: string, zoneSecteur: string): string {
  return `ROLE: Expert urbanisme.

CONTEXTE:
- Commune : ${commune}
- Zonage PLU : ${zonage}
- Zone reglementaire (chapitre a analyser) : ${zoneParent}${zoneSecteur ? `\n- Secteur de la parcelle : ${zoneSecteur}` : ''}
${buildSecteurNote(zoneParent, zoneSecteur)}
REGLEMENT de la zone ${zoneParent}

OBJECTIF: Analyser le reglement PLU (document PDF joint) pour extraire les contraintes constructives. Reponse visuelle, aeree et synthetique pour un architecte ou promoteur.

FORMATTAGE:
- TEXTE BRUT uniquement (pas de Markdown, pas de # ni **)
- Titres en MAJUSCULES
- Listes avec tirets (-)
- Emojis pour reperes visuels
- Maximum 15 lignes

STRUCTURE ATTENDUE:

📍 ZONAGE : ${zonage}
(courte definition)

🏗️ 1. USAGES & DESTINATIONS
- ✅ Autorise : [liste]
- 🚫 Interdit : [liste]
- ⚠️ Sous conditions : [liste]

📏 2. IMPLANTATION & DISTANCES
- 🛣️ Retrait voies : [metres]
- 🏡 Limites separatives : [metres ou regle]
- 🧱 Emprise au sol / Densite : [coef ou %]
- 🟩 Espaces verts : [regles]

📐 3. VOLUMETRIE
- ⬆️ Hauteur max : [metres]
- 🏠 Toiture : [regles]

🚗 4. STATIONNEMENT
- 🚙 Voitures : [regle]
- 🚲 Velos : [regle]

🚩 5. POINTS DE VIGILANCE
- 🏛️ Servitudes / ABF
- 🌊 Risques
- 🎨 Prescriptions

---
🚦 SYNTHESE DECISIONNELLE
🔴 BLOQUANT (Deal Breakers)
🟠 A SURVEILLER (Points attention)
🟢 FAVORABLE (Points forts)`
}

function buildRNUPrompt(parcel: ParcelInfo): string {
  return `ROLE: Expert urbanisme.

CONTEXTE:
- Commune : ${parcel.commune}
- Parcelle : Section ${parcel.section} Numero ${parcel.numero}
- Surface : ${parcel.surface} m²
- Fiche parcelle : ${parcel.url_parcelle}

Cette commune ne dispose PAS de PLU ni de carte communale. Elle est soumise au RNU (Reglement National d'Urbanisme).

OBJECTIF: Analyser la faisabilite d'un projet sur cette parcelle en appliquant les regles du Code de l'Urbanisme (Articles R.111-1 et suivants). Reponse visuelle, aeree et synthetique pour un architecte ou promoteur.

FORMATTAGE:
- TEXTE BRUT uniquement (pas de Markdown, pas de # ni **)
- Titres en MAJUSCULES
- Listes avec tirets (-)
- Emojis pour reperes visuels
- Maximum 15 lignes

STRUCTURE ATTENDUE:

⚠️ ZONE SOUS RNU (Reglement National d'Urbanisme)

🏗️ 1. USAGES & CONSTRUCTIBILITE
- 🛑 Regle de constructibilite limitee (Article L.111-3) : construction autorisee uniquement dans les Parties Actuellement Urbanisees (PAU)
- ✅ Exceptions : interet public, agricole, extension mesuree
- ⚠️ A VERIFIER : La localisation dans la PAU est la condition sine qua non

📏 2. IMPLANTATION & DISTANCES
- 🛣️ Retrait voirie : regles d'alignement (R.111-17)
- 🏡 Limites separatives : 3m min ou moitie hauteur (R.111-18)
- 🧱 Pas de CES fixe, insertion paysagere prime

📐 3. HAUTEURS & VOLUMES
- Article R.111-27 : ne pas porter atteinte au caractere des lieux avoisinants
- Monuments historiques a proximite ?

🚗 4. STATIONNEMENT & ACCES
- Securite des acces (R.111-2)
- Gestion eaux pluviales et reseaux

🚩 5. POINTS DE VIGILANCE RNU
- 🛑 Refus de permis si hors PAU (L.111-3)
- 🔌 Desserte reseaux obligatoire (L.111-11)
- 📋 Avis conforme du Prefet souvent requis

---
🚦 SYNTHESE DECISIONNELLE
🔴 BLOQUANT (Deal Breakers)
🟠 A SURVEILLER (Points attention)
🟢 FAVORABLE (Points forts)`
}

// ─── Gemini API ──────────────────────────────────────────────

function geminiUrl(path: string): string {
  return `${GEMINI_BASE}${path}?key=${GEMINI_API_KEY}`
}

async function callGeminiText(prompt: string): Promise<string> {
  const resp = await fetch(geminiUrl(`/models/${GEMINI_MODEL}:generateContent`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Gemini API error: ${resp.status} - ${err}`)
  }
  const data = await resp.json()
  return data.candidates[0].content.parts[0].text
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunks: string[] = []
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    chunks.push(String.fromCharCode(...chunk))
  }
  return btoa(chunks.join(''))
}

async function callGeminiWithInlinePDF(pdfBuffer: Uint8Array, prompt: string): Promise<string> {
  const base64 = uint8ArrayToBase64(pdfBuffer)

  const resp = await fetch(geminiUrl(`/models/${GEMINI_MODEL}:generateContent`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'application/pdf', data: base64 } },
        ],
      }],
    }),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Gemini API error: ${resp.status} - ${err}`)
  }
  const data = await resp.json()
  return data.candidates[0].content.parts[0].text
}

async function uploadToGeminiFiles(pdfUrl: string, pdfSize: number): Promise<string> {
  // Stream PDF directement de IGN vers Gemini (pas de buffering en memoire)
  console.log(`⬆️ Streaming ${(pdfSize / 1_000_000).toFixed(1)} MB vers Gemini Files API...`)

  const pdfResp = await fetch(pdfUrl)
  if (!pdfResp.ok) throw new Error(`PDF download failed: ${pdfResp.status}`)

  const uploadResp = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/pdf',
        'X-Goog-Upload-Protocol': 'raw',
        ...(pdfSize > 0 ? { 'Content-Length': String(pdfSize) } : {}),
      },
      body: pdfResp.body, // ReadableStream - zero buffering!
    }
  )
  if (!uploadResp.ok) {
    const err = await uploadResp.text()
    throw new Error(`Gemini upload error: ${uploadResp.status} - ${err}`)
  }
  const uploadData = await uploadResp.json()
  const fileName = uploadData.file.name
  const fileUri = uploadData.file.uri
  console.log(`✅ Uploaded: ${fileName}, state: ${uploadData.file.state}`)

  // Poll until ACTIVE (max 90s)
  let state = uploadData.file.state
  let attempts = 0
  while (state === 'PROCESSING' && attempts < 18) {
    await new Promise(r => setTimeout(r, 5000))
    const checkResp = await fetch(geminiUrl(`/${fileName}`))
    const checkData = await checkResp.json()
    state = checkData.state
    attempts++
    console.log(`⏳ File state: ${state} (attempt ${attempts})`)
  }

  if (state !== 'ACTIVE') {
    throw new Error(`File not ready after polling: state=${state}`)
  }

  return fileUri
}

async function callGeminiWithFileURI(fileUri: string, prompt: string): Promise<string> {
  const resp = await fetch(geminiUrl(`/models/${GEMINI_MODEL}:generateContent`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { file_data: { mime_type: 'application/pdf', file_uri: fileUri } },
        ],
      }],
    }),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Gemini API error: ${resp.status} - ${err}`)
  }
  const data = await resp.json()
  return data.candidates[0].content.parts[0].text
}

async function extractZoneFromPDF(pdfUrl: string, zoneCode: string, nomfic: string): Promise<string> {
  if (!PDF_EXTRACTOR_URL) {
    throw new Error('PDF_EXTRACTOR_URL non configure - impossible de traiter les gros PDFs')
  }

  // Extraire le hint de page depuis nomfic (#page=69)
  let pageHint = 0
  const pageMatch = nomfic.match(/#page=(\d+)/)
  if (pageMatch) {
    pageHint = parseInt(pageMatch[1])
  }

  console.log(`🔧 Appel pdf-extractor pour zone ${zoneCode} (page hint: ${pageHint})...`)
  const resp = await fetch(`${PDF_EXTRACTOR_URL}/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdf_url: pdfUrl, zone_code: zoneCode, page_hint: pageHint }),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`PDF extractor error: ${resp.status} - ${err}`)
  }
  const data = await resp.json()
  console.log(`📄 Extrait: ${data.zone_pages.length} pages sur ${data.total_pages}, ${data.zone_text_length} chars`)
  return data.zone_text
}

function buildPLUTextPrompt(commune: string, zonage: string, zoneParent: string, zoneSecteur: string, zoneText: string): string {
  return `ROLE: Expert urbanisme.

CONTEXTE:
- Commune : ${commune}
- Zonage PLU : ${zonage}
- Zone reglementaire (chapitre a analyser) : ${zoneParent}${zoneSecteur ? `\n- Secteur de la parcelle : ${zoneSecteur}` : ''}
${buildSecteurNote(zoneParent, zoneSecteur)}
Voici le texte extrait du reglement PLU pour la zone ${zoneParent} :

---
${zoneText}
---

OBJECTIF: Analyser ce texte reglementaire pour extraire les contraintes constructives. Reponse visuelle, aeree et synthetique pour un architecte ou promoteur.

FORMATTAGE:
- TEXTE BRUT uniquement (pas de Markdown, pas de # ni **)
- Titres en MAJUSCULES
- Listes avec tirets (-)
- Emojis pour reperes visuels
- Maximum 15 lignes

STRUCTURE ATTENDUE:

📍 ZONAGE : ${zonage}
(courte definition)

🏗️ 1. USAGES & DESTINATIONS
- ✅ Autorise : [liste]
- 🚫 Interdit : [liste]
- ⚠️ Sous conditions : [liste]

📏 2. IMPLANTATION & DISTANCES
- 🛣️ Retrait voies : [metres]
- 🏡 Limites separatives : [metres ou regle]
- 🧱 Emprise au sol / Densite : [coef ou %]
- 🟩 Espaces verts : [regles]

📐 3. VOLUMETRIE
- ⬆️ Hauteur max : [metres]
- 🏠 Toiture : [regles]

🚗 4. STATIONNEMENT
- 🚙 Voitures : [regle]
- 🚲 Velos : [regle]

🚩 5. POINTS DE VIGILANCE
- 🏛️ Servitudes / ABF
- 🌊 Risques
- 🎨 Prescriptions

---
🚦 SYNTHESE DECISIONNELLE
🔴 BLOQUANT (Deal Breakers)
🟠 A SURVEILLER (Points attention)
🟢 FAVORABLE (Points forts)`
}

// ─── Main Handler ────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { latitude, longitude } = await req.json()
    if (!latitude || !longitude) {
      return new Response(
        JSON.stringify({ success: false, error: 'latitude et longitude requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`📍 Analyse PLU: lat=${latitude}, lon=${longitude}`)

    // 1. Appels IGN + Mérimée en parallèle (MH tolérant aux erreurs)
    const [parcelle, zoneUrba, monumentsHistoriques] = await Promise.all([
      fetchIGNParcelle(latitude, longitude),
      fetchIGNZoneUrba(latitude, longitude),
      fetchMerimeeMonuments(latitude, longitude, 500),
    ])

    if (!parcelle.features || parcelle.features.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Aucune parcelle trouvee a ces coordonnees' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. Construction infos parcelle
    const parcelInfo = buildParcelInfo(parcelle, zoneUrba)
    const isRNU = zoneUrba.totalFeatures === 0
    console.log(`🏘️ ${parcelInfo.commune} - ${isRNU ? 'RNU' : `PLU zone ${parcelInfo.zone_code}`}`)

    let analyseTexte: string
    let sourceAnalyse: string
    let resolvedNomfic = '' // nom du PDF règlement, après éventuel fallback API geoportail-urbanisme

    if (isRNU) {
      // ─── RNU : analyse textuelle sans PDF ───
      console.log('📜 Analyse RNU via Gemini...')
      const prompt = buildRNUPrompt(parcelInfo)
      analyseTexte = await callGeminiText(prompt)
      sourceAnalyse = 'Google Gemini 3 Flash'
    } else {
      // ─── PLU : telecharger et analyser le reglement PDF ───
      const props = zoneUrba.features[0].properties
      let nomficClean = (props.nomfic || '').split('#')[0] // Enlever #page=XX
      resolvedNomfic = nomficClean

      // Fallback : l'IGN ne référence pas toujours nomfic dans zone-urba.
      // On va le chercher dans l'API geoportail-urbanisme.gouv.fr qui liste tous les fichiers.
      if (!nomficClean && props.gpu_doc_id) {
        console.log(`🔎 nomfic vide — recherche reglement via geoportail-urbanisme...`)
        try {
          const detailsResp = await fetch(
            `https://www.geoportail-urbanisme.gouv.fr/api/document/${props.gpu_doc_id}/details`
          )
          if (detailsResp.ok) {
            const details = await detailsResp.json()
            const files: string[] = Array.isArray(details.files) ? details.files : []
            // On préfère le règlement écrit (pas le graphique) — pattern : *_reglement_*.pdf sans "graphique"
            const reglement = files.find((f) => /_reglement_/.test(f) && !/graphique/.test(f) && f.endsWith('.pdf'))
            if (reglement) {
              nomficClean = reglement
              resolvedNomfic = reglement
              console.log(`✅ Reglement trouvé via fallback : ${nomficClean}`)
            }
          }
        } catch (e) {
          console.log(`⚠️ Fallback geoportail-urbanisme a échoué : ${e}`)
        }
      }

      if (!nomficClean) {
        // Aucun PDF trouvé même après fallback → analyse textuelle générique.
        console.log(`⚠️ Aucun PDF disponible pour ${parcelInfo.commune} (${parcelInfo.zone_code}) — analyse sans PDF`)
        const textPrompt = buildPLUTextPrompt(
          parcelInfo.commune,
          parcelInfo.zonage,
          parcelInfo.zone_parent,
          parcelInfo.zone_secteur,
          `Aucun document d'urbanisme référencé par l'IGN pour la zone ${parcelInfo.zone_parent} de ${parcelInfo.commune}. Produire une analyse générique basée sur le code de zonage standard.`
        )
        analyseTexte = await callGeminiText(textPrompt)
        sourceAnalyse = 'Google Gemini 3 Flash (PDF indisponible)'
      } else {
      const pdfUrl = `https://data.geopf.fr/annexes/gpu/documents/${props.partition}/${props.gpu_doc_id}/${nomficClean}`
      const prompt = buildPLUPrompt(parcelInfo.commune, parcelInfo.zonage, parcelInfo.zone_parent, parcelInfo.zone_secteur)

      // Verifier la taille du PDF
      console.log(`📄 PDF URL: ${pdfUrl}`)
      const headResp = await fetch(pdfUrl, { method: 'HEAD' })
      const pdfSize = parseInt(headResp.headers.get('content-length') || '0')
      console.log(`📦 PDF size: ${pdfSize > 0 ? `${(pdfSize / 1_000_000).toFixed(1)} MB` : 'inconnue'}`)

      if (pdfSize < INLINE_MAX_BYTES) {
        // PDF petit (< 15 MB) OU taille inconnue (HEAD sans content-length, fréquent
        // sur data.geopf.fr — cas Cléron). On télécharge et on décide sur la taille
        // RÉELLE : inline si possible (meilleure qualité que l'extraction de zone),
        // sinon on bascule sur l'extraction. Évite de forcer pdf-extractor à tort.
        console.log(pdfSize === 0 ? '📎 Taille inconnue — téléchargement pour décision...' : '📎 Envoi inline a Gemini...')
        const pdfResp = await fetch(pdfUrl)
        if (!pdfResp.ok) throw new Error(`PDF download failed: ${pdfResp.status}`)
        const pdfBuffer = new Uint8Array(await pdfResp.arrayBuffer())

        // Verifier la taille reelle apres telechargement
        if (pdfBuffer.byteLength > INLINE_MAX_BYTES) {
          console.log(`📎 PDF plus gros que prevu (${(pdfBuffer.byteLength / 1_000_000).toFixed(1)} MB), extraction zone...`)
          const zoneText = await extractZoneFromPDF(pdfUrl, parcelInfo.zone_parent, props.nomfic)
          const textPrompt = buildPLUTextPrompt(parcelInfo.commune, parcelInfo.zonage, parcelInfo.zone_parent, parcelInfo.zone_secteur, zoneText)
          analyseTexte = await callGeminiText(textPrompt)
          sourceAnalyse = 'Google Gemini 3 Flash (extraction zone)'
        } else {
          console.log(`📎 PDF ${(pdfBuffer.byteLength / 1_000_000).toFixed(1)} MB → envoi inline a Gemini...`)
          analyseTexte = await callGeminiWithInlinePDF(pdfBuffer, prompt)
          sourceAnalyse = 'Google Gemini 3 Flash'
        }
      } else if (pdfSize < 50_000_000) {
        // PDF moyen (15-50 MB) : stream vers Files API
        console.log('☁️ Stream via Gemini Files API...')
        const fileUri = await uploadToGeminiFiles(pdfUrl, pdfSize)
        analyseTexte = await callGeminiWithFileURI(fileUri, prompt)
        sourceAnalyse = 'Google Gemini 3 Flash'
      } else {
        // Tres gros PDF (> 50 MB) ou taille inconnue : extraction texte de la zone via micro-service
        console.log(`📑 PDF volumineux ou taille inconnue, extraction zone ${parcelInfo.zone_parent}...`)
        const zoneText = await extractZoneFromPDF(pdfUrl, parcelInfo.zone_parent, props.nomfic)
        const textPrompt = buildPLUTextPrompt(parcelInfo.commune, parcelInfo.zonage, parcelInfo.zone_parent, parcelInfo.zone_secteur, zoneText)
        analyseTexte = await callGeminiText(textPrompt)
        sourceAnalyse = 'Google Gemini 3 Flash (extraction zone)'
      }
      } // fin du else (nomfic non vide)
    }

    // 3. Reponse formatee (meme format que le n8n)
    const urlDocument = (isRNU || !resolvedNomfic)
      ? null
      : `https://data.geopf.fr/annexes/gpu/documents/${zoneUrba.features[0].properties.partition}/${zoneUrba.features[0].properties.gpu_doc_id}/${resolvedNomfic}`

    const response = {
      success: true,
      data: {
        parcelle: {
          commune: parcelInfo.commune,
          section: parcelInfo.section,
          numero: parcelInfo.numero,
          surface: parcelInfo.surface,
          url_geoportail: parcelInfo.url_parcelle,
          coordonnees: { lat: latitude, long: longitude },
        },
        zonage: {
          type: isRNU ? 'RNU' : 'PLU',
          code: parcelInfo.zone_code,
          libelle: parcelInfo.zonage,
          url_document: urlDocument,
        },
        analyse: {
          texte: analyseTexte,
          source: sourceAnalyse,
        },
        monuments_historiques: monumentsHistoriques,
        timestamp: new Date().toISOString(),
      },
    }

    console.log('✅ Analyse terminee')
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error('❌ Erreur:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Erreur interne',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
