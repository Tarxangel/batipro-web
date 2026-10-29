// Affichage des Monuments Historiques (Mérimée) sur la carte Leaflet.
// Pattern : une LayerGroup persistante, vidée et re-remplie à chaque
// nouvelle analyse PLU (qu'elle soit fraîche ou rappelée depuis la DB).

import L from 'leaflet';
import type { MonumentHistorique, ServitudePatrimoine } from './api';

let mhLayer: L.LayerGroup | null = null;
let servitudesLayer: L.LayerGroup | null = null;

const ICON_HTML = `<div class="mh-marker-inner" title="Monument Historique">🏛️</div>`;

const mhIcon = L.divIcon({
  className: 'mh-marker',
  html: ICON_HTML,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
  popupAnchor: [0, -14],
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function popupHtml(mh: MonumentHistorique): string {
  const proRef = mh.reference
    ? `<a href="https://pop.culture.gouv.fr/notice/merimee/${encodeURIComponent(mh.reference)}" target="_blank" rel="noopener">Fiche Mérimée ↗</a>`
    : '';
  return `
    <div class="mh-popup">
      <strong>🏛️ ${escapeHtml(mh.name)}</strong>
      ${mh.type ? `<div class="mh-popup-row">Type : ${escapeHtml(mh.type)}</div>` : ''}
      ${mh.protection ? `<div class="mh-popup-row">${escapeHtml(mh.protection)}</div>` : ''}
      ${mh.century ? `<div class="mh-popup-row">${escapeHtml(mh.century)}</div>` : ''}
      <div class="mh-popup-row">À ${mh.distance_m} m de la parcelle</div>
      ${proRef ? `<div class="mh-popup-row">${proRef}</div>` : ''}
    </div>
  `;
}

/** À appeler une fois au boot de la carte. */
export function initMonumentsHistoriquesLayer(map: L.Map): void {
  if (mhLayer) return;
  // Les polygones de servitudes sous les markers MH.
  servitudesLayer = L.layerGroup().addTo(map);
  mhLayer = L.layerGroup().addTo(map);
}

/** Vide la couche et la remplit avec les MH d'une analyse. */
export function showMonumentsHistoriques(monuments: MonumentHistorique[] | null | undefined): void {
  if (!mhLayer) return;
  mhLayer.clearLayers();
  if (!monuments || monuments.length === 0) return;
  for (const mh of monuments) {
    const marker = L.marker([mh.lat, mh.lon], { icon: mhIcon });
    marker.bindPopup(popupHtml(mh));
    mhLayer.addLayer(marker);
  }
}

/** Vide la couche et dessine les assiettes de servitudes patrimoine (AC1/AC2/AC4). */
export function showServitudesPatrimoine(servitudes: ServitudePatrimoine[] | null | undefined): void {
  if (!servitudesLayer) return;
  servitudesLayer.clearLayers();
  if (!servitudes || servitudes.length === 0) return;
  for (const s of servitudes) {
    if (!s.geometry) continue;
    const poly = L.geoJSON(s.geometry as GeoJSON.Geometry, {
      style: {
        color: '#b0413e',
        weight: 2,
        dashArray: '6 4',
        fillColor: '#b0413e',
        fillOpacity: 0.08,
      },
    });
    poly.bindPopup(`
      <div class="mh-popup">
        <strong>🏛️ ${escapeHtml(s.nom)}</strong>
        <div class="mh-popup-row">${escapeHtml(s.libelle)}</div>
        ${s.type_assiette ? `<div class="mh-popup-row">${escapeHtml(s.type_assiette)}</div>` : ''}
      </div>
    `);
    servitudesLayer.addLayer(poly);
  }
}

/** Vide les markers (à appeler quand on ferme une analyse sans en ouvrir une autre). */
export function clearMonumentsHistoriques(): void {
  if (mhLayer) mhLayer.clearLayers();
  if (servitudesLayer) servitudesLayer.clearLayers();
}
