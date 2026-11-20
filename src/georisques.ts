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
