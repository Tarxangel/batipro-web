// Supabase Edge Function - Tableau PLU détaillé (14 catégories) via Gemini 2.5 Flash
//
// Reçoit un analysis_id, va chercher la ligne correspondante dans analyses_plu :
//   - Si detailed_table est déjà peuplé → renvoie le cache (pas de refacturation).
//   - Sinon : télécharge le règlement PDF, appelle le micro-service pdf-extractor
//     pour en extraire le texte de la zone + dispositions générales, envoie à
//     Gemini 2.5 Flash avec un prompt demandant une extraction exhaustive
//     structurée en JSON selon la grille "Urbanisme" du client (14 rubriques).
//
// Le résultat est sauvegardé dans analyses_plu.detailed_table pour les appels
// ultérieurs.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.90.1"

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!
const GEMINI_MODEL = 'gemini-3.1-pro-preview'
const PDF_EXTRACTOR_URL = Deno.env.get('PDF_EXTRACTOR_URL') || ''
const INLINE_MAX_BYTES = 15_000_000 // 15 MB - au dela on passe par l'extracteur texte

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ─── TYPES ──────────────────────────────────────────────────

interface DetailedTable {
  documents_graphiques: string
  occupations_sols_interdites: string
  ppri: string
  servitudes: string
  acces_voirie: string
  reseaux: {
    eaux_pluviales: string
    eaux_usees: string
    eaux_industrielles: string
    divers: string
  }
  implantation: {
    voies_emprises_publiques: string
    limites_separatives: string
    autres_sur_meme_terrain: string
    par_rapport_zone: string
  }
  emprise_sol: string
  hauteur: string
  aspect_exterieur: {
    materiaux: string
    couleurs: string
    clotures: string
    toitures: string
    divers: string
  }
  stationnement: string
  espaces_libres: {
    pourcentage_espaces_verts: string
    arbres: string
  }
  coefficient_occupation_sol: string
  remarques: string
}

interface AnalysisRow {
  id: string
  latitude: number
  longitude: number
  parcelle_commune: string
  parcelle_section: string
  parcelle_numero: string
  parcelle_surface: number
  parcelle_url_geoportail: string
  zonage_type: 'PLU' | 'RNU'
  zonage_libelle: string
  zonage_url_document: string | null
  detailed_table: DetailedTable | null
}

// ─── HELPERS ────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
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

function extractJSON(text: string): string {
  const trimmed = text.trim()
  const fence = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i)
  if (fence) return fence[1].trim()
  return trimmed
}

// ─── PDF extractor (texte via micro-service) ────────────────

interface ExtractResult {
  zone_text: string
  general_text: string
}

async function extractZoneFromPDF(pdfUrl: string, zoneCode: string): Promise<ExtractResult> {
  if (!PDF_EXTRACTOR_URL) {
    throw new Error('PDF_EXTRACTOR_URL non configure')
  }
  const resp = await fetch(`${PDF_EXTRACTOR_URL}/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdf_url: pdfUrl, zone_code: zoneCode }),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`PDF extractor error: ${resp.status} - ${err}`)
  }
  const data = await resp.json()
  return {
    zone_text: data.zone_text || '',
    general_text: data.general_text || '',
  }
}

// ─── Gemini calls ───────────────────────────────────────────

function geminiUrl(): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`
}

async function callGeminiWithText(prompt: string): Promise<string> {
  const resp = await fetch(geminiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 32000,
        responseMimeType: 'application/json',
      },
    }),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Gemini API error: ${resp.status} - ${err}`)
  }
  const data = await resp.json()
  return data.candidates[0].content.parts[0].text
}

async function callGeminiWithPDF(pdfBuffer: Uint8Array, prompt: string): Promise<string> {
  const base64 = uint8ArrayToBase64(pdfBuffer)
  const resp = await fetch(geminiUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'application/pdf', data: base64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 32000,
        responseMimeType: 'application/json',
      },
    }),
  })
  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Gemini API error: ${resp.status} - ${err}`)
  }
  const data = await resp.json()
  return data.candidates[0].content.parts[0].text
}

// ─── Prompts ────────────────────────────────────────────────

function buildDetailedPromptPDF(commune: string, zonage: string, zoneCode: string): string {
  return `ROLE: Expert en droit de l'urbanisme.

CONTEXTE:
- Commune : ${commune}
- Zonage PLU : ${zonage}
- Code Zone : ${zoneCode}

Le document PDF joint est le reglement du PLU.

MISSION : Extraire EXHAUSTIVEMENT les prescriptions reglementaires applicables a la zone ${zoneCode} pour les 14 rubriques suivantes. Tu dois citer VERBATIM ou reformuler TRES FIDELEMENT les passages du reglement, PAS en faire un resume laconique. Si le reglement de la zone renvoie aux dispositions generales, combine les deux pour avoir la regle complete.

REGLES CRITIQUES :
- EXHAUSTIF : recopie ou paraphrase tres fidelement TOUS les articles pertinents pour chaque rubrique.
- Conserve les valeurs chiffrees EXACTES (metres, pourcentages, hauteurs, coefficients).
- Si une rubrique n'est pas reglementee dans le PLU pour cette zone, ecris litteralement : "Non reglemente" ou "Non precise dans le reglement de la zone ${zoneCode}".
- NE PAS inventer.
- NE PAS citer les autres zones.
- Repondre UNIQUEMENT en JSON valide, sans markdown, sans prose.

${buildJSONSchemaInstructions()}`
}

function buildDetailedPromptText(commune: string, zonage: string, zoneCode: string, zoneText: string, generalText: string): string {
  const generalSection = generalText
    ? `\n\nVoici les DISPOSITIONS GENERALES applicables a toutes les zones :\n\n---\n${generalText}\n---`
    : ''

  return `ROLE: Expert en droit de l'urbanisme.

CONTEXTE:
- Commune : ${commune}
- Zonage PLU : ${zonage}
- Code Zone : ${zoneCode}

Voici le texte extrait du reglement PLU specifique a la zone ${zoneCode} :

---
${zoneText}
---${generalSection}

MISSION : Extraire EXHAUSTIVEMENT les prescriptions reglementaires applicables a la zone ${zoneCode} pour les 14 rubriques suivantes. Tu dois citer VERBATIM ou reformuler TRES FIDELEMENT les passages du reglement, PAS en faire un resume laconique. Si le reglement de la zone renvoie aux dispositions generales, combine les deux pour avoir la regle complete.

REGLES CRITIQUES :
- EXHAUSTIF : recopie ou paraphrase tres fidelement TOUS les articles pertinents pour chaque rubrique.
- Conserve les valeurs chiffrees EXACTES (metres, pourcentages, hauteurs, coefficients).
- Si une rubrique n'est pas reglementee dans le PLU pour cette zone, ecris litteralement : "Non reglemente" ou "Non precise dans le reglement de la zone ${zoneCode}".
- NE PAS inventer.
- NE PAS citer les autres zones.
- Repondre UNIQUEMENT en JSON valide, sans markdown, sans prose.

${buildJSONSchemaInstructions()}`
}

function buildJSONSchemaInstructions(): string {
  return `STRUCTURE JSON ATTENDUE (respect strict des cles) :
{
  "documents_graphiques": "Reference aux documents graphiques / plans de zonage si mentionnes",
  "occupations_sols_interdites": "Occupations et utilisations du sol interdites dans cette zone (article 1). Liste complete.",
  "ppri": "Plan de Prevention des Risques d'Inondation - dispositions si presentes",
  "servitudes": "Servitudes d'utilite publique applicables (ABF, monuments historiques, etc.)",
  "acces_voirie": "Conditions d'acces aux parcelles et regles de voirie (article 3)",
  "reseaux": {
    "eaux_pluviales": "Regles de gestion des eaux pluviales",
    "eaux_usees": "Regles de raccordement eaux usees",
    "eaux_industrielles": "Regles specifiques eaux industrielles",
    "divers": "Eau potable, electricite, telecom, dechets, etc."
  },
  "implantation": {
    "voies_emprises_publiques": "Implantation par rapport aux voies et emprises publiques (article 6) - retraits exacts",
    "limites_separatives": "Implantation par rapport aux limites separatives (article 7) - distances et formules",
    "autres_sur_meme_terrain": "Implantation des constructions les unes par rapport aux autres sur un meme terrain (article 8)",
    "par_rapport_zone": "Regles specifiques par rapport a la zone (distances aux autres zones, transitions)"
  },
  "emprise_sol": "Emprise au sol maximale (article 9) - coefficient ou pourcentage exact",
  "hauteur": "Hauteur maximale des constructions (article 10) - valeurs precises en metres, R+X, etc.",
  "aspect_exterieur": {
    "materiaux": "Materiaux autorises / interdits (article 11)",
    "couleurs": "Palette de couleurs, teintes autorisees",
    "clotures": "Hauteurs et types de clotures",
    "toitures": "Pentes, formes, couleurs de toitures",
    "divers": "Autres prescriptions architecturales (insertion, facades, enseignes, climatisation)"
  },
  "stationnement": "Regles de stationnement (article 12) - ratios par destination, VL et velos",
  "espaces_libres": {
    "pourcentage_espaces_verts": "Pourcentage minimum d'espaces verts / pleine terre",
    "arbres": "Regles de plantation, arbres haute tige, essences"
  },
  "coefficient_occupation_sol": "COS si encore applicable (sinon 'Supprime par ALUR' ou 'Non reglemente')",
  "remarques": "Points de vigilance particuliers, dispositions specifiques transversales, renvoi a reglements annexes"
}`
}

// ─── MAIN HANDLER ───────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (!GEMINI_API_KEY) {
    return jsonResponse({ success: false, error: 'GEMINI_API_KEY non configure' }, 500)
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  try {
    const { analysis_id } = await req.json()
    if (!analysis_id) {
      return jsonResponse({ success: false, error: 'analysis_id requis' }, 400)
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // 1. Lookup analyse + verifier cache
    const { data: row, error: fetchErr } = await admin
      .from('analyses_plu')
      .select('*')
      .eq('id', analysis_id)
      .single<AnalysisRow>()

    if (fetchErr || !row) {
      return jsonResponse({ success: false, error: 'Analyse introuvable' }, 404)
    }

    if (row.detailed_table) {
      console.log(`✅ Cache hit pour ${analysis_id}`)
      return jsonResponse({ success: true, data: row.detailed_table, cached: true })
    }

    // 2. RNU : pas de règlement PDF → fallback vide avec message explicite
    if (row.zonage_type === 'RNU' || !row.zonage_url_document) {
      const rnuTable = buildRNUFallback()
      await admin
        .from('analyses_plu')
        .update({ detailed_table: rnuTable })
        .eq('id', analysis_id)
      return jsonResponse({ success: true, data: rnuTable, cached: false })
    }

    // 3. PLU : récupérer le PDF et extraire le tableau
    const pdfUrl = row.zonage_url_document
    const zoneCode = row.zonage_libelle.split(' ')[0].trim().toUpperCase()

    console.log(`📄 PDF: ${pdfUrl}`)
    const headResp = await fetch(pdfUrl, { method: 'HEAD' })
    const pdfSize = parseInt(headResp.headers.get('content-length') || '0')
    console.log(`📦 Taille: ${pdfSize > 0 ? `${(pdfSize / 1_000_000).toFixed(1)} MB` : 'inconnue'}`)

    let rawJSON: string

    if (pdfSize > 0 && pdfSize < INLINE_MAX_BYTES) {
      // Petit PDF : inline
      const pdfResp = await fetch(pdfUrl)
      if (!pdfResp.ok) throw new Error(`PDF download failed: ${pdfResp.status}`)
      const pdfBuffer = new Uint8Array(await pdfResp.arrayBuffer())

      if (pdfBuffer.byteLength > INLINE_MAX_BYTES) {
        console.log('📑 PDF plus gros que prevu, extraction zone...')
        const extracted = await extractZoneFromPDF(pdfUrl, zoneCode)
        const prompt = buildDetailedPromptText(row.parcelle_commune, row.zonage_libelle, zoneCode, extracted.zone_text, extracted.general_text)
        rawJSON = await callGeminiWithText(prompt)
      } else {
        console.log('📎 Envoi PDF inline a Gemini...')
        const prompt = buildDetailedPromptPDF(row.parcelle_commune, row.zonage_libelle, zoneCode)
        rawJSON = await callGeminiWithPDF(pdfBuffer, prompt)
      }
    } else {
      // Gros PDF ou taille inconnue : extraction zone via pdf-extractor
      console.log(`📑 Extraction zone ${zoneCode}...`)
      const extracted = await extractZoneFromPDF(pdfUrl, zoneCode)
      const prompt = buildDetailedPromptText(row.parcelle_commune, row.zonage_libelle, zoneCode, extracted.zone_text, extracted.general_text)
      rawJSON = await callGeminiWithText(prompt)
    }

    // 4. Parse + sauvegarder
    let detailedTable: DetailedTable
    try {
      detailedTable = JSON.parse(extractJSON(rawJSON))
    } catch (parseErr) {
      console.error('❌ Parse JSON Gemini a echoue:', parseErr, rawJSON.slice(0, 300))
      return jsonResponse({
        success: false,
        error: 'La reponse Gemini n\'est pas un JSON valide',
      }, 502)
    }

    const { error: updateErr } = await admin
      .from('analyses_plu')
      .update({ detailed_table: detailedTable })
      .eq('id', analysis_id)

    if (updateErr) {
      console.error('⚠️ Sauvegarde cache echouee (non bloquant):', updateErr)
    }

    console.log(`✅ Tableau detaille genere pour ${analysis_id}`)
    return jsonResponse({ success: true, data: detailedTable, cached: false })
  } catch (error) {
    console.error('❌ Erreur:', error)
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Erreur interne',
    }, 500)
  }
})

// Fallback pour les zones RNU (pas de règlement PDF à analyser)
function buildRNUFallback(): DetailedTable {
  const rnuMsg = 'Zone sous RNU - se referer aux articles R.111-1 et suivants du Code de l\'Urbanisme'
  return {
    documents_graphiques: rnuMsg,
    occupations_sols_interdites: 'Construction autorisee uniquement dans les Parties Actuellement Urbanisees (PAU) - Article L.111-3',
    ppri: 'A verifier aupres de la commune',
    servitudes: 'A verifier (monuments historiques, ABF)',
    acces_voirie: 'Securite des acces - Article R.111-2',
    reseaux: {
      eaux_pluviales: 'Desserte obligatoire - Article L.111-11',
      eaux_usees: 'Desserte obligatoire - Article L.111-11',
      eaux_industrielles: rnuMsg,
      divers: 'Desserte reseaux obligatoire - Article L.111-11',
    },
    implantation: {
      voies_emprises_publiques: 'Regles d\'alignement - Article R.111-17',
      limites_separatives: '3 m minimum ou moitie hauteur - Article R.111-18',
      autres_sur_meme_terrain: rnuMsg,
      par_rapport_zone: rnuMsg,
    },
    emprise_sol: 'Pas de CES fixe sous RNU',
    hauteur: 'Ne pas porter atteinte au caractere des lieux avoisinants - Article R.111-27',
    aspect_exterieur: {
      materiaux: 'Insertion paysagere - Article R.111-27',
      couleurs: rnuMsg,
      clotures: rnuMsg,
      toitures: rnuMsg,
      divers: rnuMsg,
    },
    stationnement: 'Securite des acces - Article R.111-2',
    espaces_libres: {
      pourcentage_espaces_verts: rnuMsg,
      arbres: rnuMsg,
    },
    coefficient_occupation_sol: 'Supprime par ALUR',
    remarques: 'Avis conforme du Prefet souvent requis. Refus de permis si hors PAU - Article L.111-3',
  }
}
