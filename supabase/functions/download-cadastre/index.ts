// Supabase Edge Function — Téléchargement du cadastre DXF d'une section
//
// Reçoit { insee, prefix, section } et :
//   1. Liste les fichiers .tar.bz2 de la section sur cadastre.data.gouv.fr (latest)
//      URL : https://cadastre.data.gouv.fr/data/dgfip-pci-vecteur/latest/dxf/feuilles/{dept}/{insee}/
//      Pattern fichier : dxf-{insee}{prefix}{section}{NN}.tar.bz2
//   2. Télécharge toutes les feuilles matchant
//   3. Les fusionne dans un seul .zip (pass-through tar.bz2 — pas de décompression)
//   4. Renvoie le zip en téléchargement avec un nom propre
//
// Note Allplan : pour ouvrir, l'utilisateur extrait le .zip, puis chaque .tar.bz2
// contient des .dxf importables directement.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { BlobWriter, ZipWriter, Uint8ArrayReader } from "https://deno.land/x/zipjs@v2.7.45/index.js"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const CADASTRE_BASE = 'https://cadastre.data.gouv.fr/data/dgfip-pci-vecteur/latest/dxf/feuilles'

interface RequestBody {
  insee: string   // 5 chars (ex: "25056") ou 5 si Corse ("2A004") ; 6 pour outre-mer ("97411")
  prefix: string  // 3 chars (typiquement "000", ou code commune absorbée)
  section: string // 2 chars (ex: "AB", "ZA")
}

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Extrait le code département depuis l'INSEE.
// - Métropole : 2 premiers chars (sauf Corse 2A/2B où c'est "2A" ou "2B")
// - DOM-TOM : 3 premiers chars (97x)
function deptFromInsee(insee: string): string {
  if (insee.startsWith('2A') || insee.startsWith('2B')) return insee.slice(0, 2)
  if (insee.startsWith('97') || insee.startsWith('98')) return insee.slice(0, 3)
  return insee.slice(0, 2)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return jsonError('Corps JSON invalide')
  }

  const insee = (body.insee || '').trim()
  const prefix = (body.prefix || '000').trim()
  const section = (body.section || '').trim().toUpperCase()

  if (!insee.match(/^[0-9A-Z]{5,6}$/)) return jsonError(`INSEE invalide : "${insee}"`)
  if (!prefix.match(/^[0-9A-Z]{3}$/)) return jsonError(`Prefix invalide : "${prefix}"`)
  if (!section.match(/^[0-9A-Z]{1,2}$/)) return jsonError(`Section invalide : "${section}"`)

  // La section sur cadastre.data.gouv.fr est typiquement 2 chars, complétée à
  // gauche par "0" si single-char ("A" -> "0A").
  const sectionPadded = section.length === 1 ? '0' + section : section
  const dept = deptFromInsee(insee)
  const listingUrl = `${CADASTRE_BASE}/${dept}/${insee}/`

  // ── 1. Récupère le listing HTML ───────────────────────────
  let listingHtml: string
  try {
    const resp = await fetch(listingUrl)
    if (!resp.ok) return jsonError(`Listing introuvable (${resp.status}) : ${listingUrl}`, 404)
    listingHtml = await resp.text()
  } catch (err) {
    return jsonError(`Erreur fetch listing : ${(err as Error).message}`, 502)
  }

  // ── 2. Parse les fichiers .tar.bz2 matchant la section ────
  // Format attendu : dxf-{insee}{prefix}{section}{NN}.tar.bz2
  const filePattern = new RegExp(
    `href="(dxf-${insee}${prefix}${sectionPadded}\\d{2}\\.tar\\.bz2)"`,
    'gi'
  )
  const matches = [...listingHtml.matchAll(filePattern)].map(m => m[1])
  const filenames = [...new Set(matches)] // dédoublonne

  if (filenames.length === 0) {
    return jsonError(
      `Aucune feuille trouvée pour INSEE=${insee} prefix=${prefix} section=${sectionPadded}. ` +
      `Vérifiez le code parcelle ou consultez ${listingUrl}`,
      404
    )
  }

  // ── 3. Télécharge chaque fichier et l'ajoute au zip ───────
  const blobWriter = new BlobWriter('application/zip')
  const zipWriter = new ZipWriter(blobWriter, { level: 0 }) // level 0 = pas de recompression (déjà bz2)

  for (const fname of filenames) {
    const fileUrl = `${listingUrl}${fname}`
    try {
      const resp = await fetch(fileUrl)
      if (!resp.ok) {
        console.warn(`Skip ${fname}: HTTP ${resp.status}`)
        continue
      }
      const buf = new Uint8Array(await resp.arrayBuffer())
      await zipWriter.add(fname, new Uint8ArrayReader(buf))
    } catch (err) {
      console.warn(`Skip ${fname}: ${(err as Error).message}`)
    }
  }

  await zipWriter.close()
  const zipBlob = await blobWriter.getData()

  const zipFilename = `cadastre-${insee}-${sectionPadded}.zip`
  return new Response(zipBlob, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipFilename}"`,
      'X-Feuilles-Count': String(filenames.length),
    },
  })
})
