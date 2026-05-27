// Affichage des Monuments Historiques (Mérimée) sur la carte Leaflet.
// Pattern : une LayerGroup persistante, vidée et re-remplie à chaque
// nouvelle analyse PLU (qu'elle soit fraîche ou rappelée depuis la DB).

import L from 'leaflet';
import type { MonumentHistorique } from './api';

let mhLayer: L.LayerGroup | null = null;

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

/** Vide les markers (à appeler quand on ferme une analyse sans en ouvrir une autre). */
export function clearMonumentsHistoriques(): void {
  if (mhLayer) mhLayer.clearLayers();
}
