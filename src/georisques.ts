// Lien vers la fiche risques Géorisques d'un point (parcelle).
//
// Géorisques n'expose pas d'API de « fiche parcelle » : le rapport public se
// construit par URL sur des coordonnées, et la page agrège ensuite PPR, TRI,
// sites pollués, canalisations, argiles, radon, sismique… C'est la même URL
// que celle déjà utilisée par la carte ICPE (icpe/index.html), gardée ici dans
// un module partageable par le module PLU.

export interface GeorisquesPoint {
  lat: number;
  lon: number;
  /** Nom de la commune, pour pré-remplir le formulaire Géorisques. */
  commune?: string | null;
  /** Code INSEE, si on l'a (déduit de l'URL Géoportail de la parcelle). */
  insee?: string | null;
}

/**
 * URL du rapport « Connaître les risques près de chez moi » centré sur le point.
 * lat/lon sont dupliqués (lat/lon + latitude/longitude) : Géorisques lit l'une
 * ou l'autre paire selon le chemin d'entrée, on fournit les deux.
 */
export function georisquesReportUrl({ lat, lon, commune, insee }: GeorisquesPoint): string {
  const params = new URLSearchParams({
    'form-adresse': 'true',
    isCadastre: 'false',
    type: 'adresse',
    typeForm: 'adresse',
    lon: String(lon),
    lat: String(lat),
    longitude: String(lon),
    latitude: String(lat),
    go_back: '/',
  });
  if (commune) {
    params.set('city', commune);
    params.set('commune', commune);
  }
  if (insee) params.set('codeInsee', insee);

  return `https://www.georisques.gouv.fr/mes-risques/connaitre-les-risques-pres-de-chez-moi/rapport2?${params.toString()}`;
}

// ─── Risques du terrain (API Géorisques, appel direct depuis le navigateur) ───
// API publique sans clé, CORS ouvert (vérifié le 2026-11-20). Trois indicateurs
// utiles dès l'esquisse : zone de sismicité réglementaire (Eurocode 8 / arrêté du
// 22/10/2010), exposition retrait-gonflement des argiles (étude G1/G2 loi ELAN)
// et potentiel radon. Tout échec est silencieux : la fiche s'affiche sans.

export interface RisquesTerrain {
  /** "1".."5" — null si inconnue. */
  sismiciteCode: string | null;
  /** ex : "3 - MODEREE" */
  sismiciteLibelle: string | null;
  /** "0".."3" (0 = non exposé / hors zone) — null si inconnue. */
  argilesCode: string | null;
  argilesLibelle: string | null;
  /** "1".."3" — null si inconnu. */
  radonClasse: string | null;
}

const GEORISQUES_API = 'https://georisques.gouv.fr/api/v1';
const risquesCache = new Map<string, Promise<RisquesTerrain | null>>();

async function getJson(url: string, timeoutMs = 8000): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sismicité + argiles + radon pour un point. Mise en cache par point (une
 * analyse rouverte ne relance pas les appels). Ne rejette jamais : renvoie
 * null si Géorisques ne répond pas.
 */
export function fetchRisquesTerrain(lat: number, lon: number, insee?: string | null): Promise<RisquesTerrain | null> {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const cached = risquesCache.get(key);
  if (cached) return cached;

  const latlon = `${lon},${lat}`; // Géorisques attend longitude,latitude
  const p = (async (): Promise<RisquesTerrain | null> => {
    const [sis, rga, radon] = await Promise.all([
      getJson(`${GEORISQUES_API}/zonage_sismique?latlon=${latlon}`)
        .then(j => j?.data?.length ? j : (insee ? getJson(`${GEORISQUES_API}/zonage_sismique?code_insee=${insee}`) : j)),
      getJson(`${GEORISQUES_API}/rga?latlon=${latlon}`),
      insee ? getJson(`${GEORISQUES_API}/radon?code_insee=${insee}`) : getJson(`${GEORISQUES_API}/radon?latlon=${latlon}`),
    ]);
    const s = sis?.data?.[0];
    const rd = radon?.data?.[0];
    const out: RisquesTerrain = {
      sismiciteCode: s?.code_zone ?? null,
      sismiciteLibelle: s?.zone_sismicite ?? null,
      argilesCode: rga?.codeExposition ?? null,
      argilesLibelle: rga?.exposition ?? null,
      radonClasse: rd?.classe_potentiel ?? null,
    };
    if (!out.sismiciteCode && !out.argilesCode && !out.radonClasse) return null;
    return out;
  })().catch(() => null);

  risquesCache.set(key, p);
  // Pas de cache des échecs : on retentera à la prochaine ouverture
  p.then(v => { if (!v) risquesCache.delete(key); });
  return p;
}

const SISMICITE_LABEL: Record<string, string> = {
  '1': 'très faible', '2': 'faible', '3': 'modérée', '4': 'moyenne', '5': 'forte',
};

/** "Zone 3 — modérée" */
export function sismiciteTexte(r: RisquesTerrain): string | null {
  if (!r.sismiciteCode) return null;
  return `Zone ${r.sismiciteCode} — ${SISMICITE_LABEL[r.sismiciteCode] ?? (r.sismiciteLibelle || '').replace(/^\d+\s*-\s*/, '').toLowerCase()}`;
}

/** Conséquence constructive courte de la zone sismique (bâtiments de catégorie II/III courante). */
export function sismiciteConsequence(code: string | null): string {
  switch (code) {
    case '1': return 'Pas de règle parasismique imposée (Eurocode 8 non requis).';
    case '2': return 'Eurocode 8 requis pour les bâtiments de catégorie III et IV (ERP cat. 1-3, etc.).';
    case '3':
    case '4': return 'Eurocode 8 requis dès la catégorie II (bureaux, logements, industrie courante).';
    case '5': return 'Eurocode 8 requis dès la catégorie II ; zone de forte sismicité (Antilles).';
    default: return '';
  }
}

/** "Moyenne — à intégrer à l'étude géotechnique (fondations)" */
export function argilesTexte(r: RisquesTerrain): string | null {
  if (r.argilesCode == null) return null;
  const lib = (r.argilesLibelle || '').replace(/^Exposition\s*/i, '');
  const label = lib ? lib.charAt(0).toUpperCase() + lib.slice(1) : `Niveau ${r.argilesCode}`;
  // Les obligations de la loi ELAN (G1 à la vente, G2 avant contrat) visent les
  // maisons individuelles ; pour un bâtiment d'activité, c'est la G2 qui le traite.
  const g = r.argilesCode === '2' || r.argilesCode === '3'
    ? ' — à intégrer à l\'étude géotechnique (fondations)'
    : '';
  return `${label}${g}`;
}

export function radonTexte(r: RisquesTerrain): string | null {
  if (!r.radonClasse) return null;
  const lib: Record<string, string> = { '1': 'faible', '2': 'faible avec facteurs aggravants', '3': 'significatif' };
  return `Potentiel ${lib[r.radonClasse] ?? r.radonClasse} (catégorie ${r.radonClasse})`;
}
