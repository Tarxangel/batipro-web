import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix pour les icônes Leaflet en production Vite
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

// ─── Fonds de carte Géoplateforme ────────────────────────────
// data.geopf.fr = infra derrière cartes.gouv.fr. Tuiles WMTS en accès libre
// sans clé. ⚠️ l'ancien domaine wxs.geopf.fr est mort depuis la fermeture de
// geoservices.ign.fr (mars 2026).
const geopfWmts = (layer: string, format: string) =>
  'https://data.geopf.fr/wmts?' +
  'SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&TILEMATRIXSET=PM&' +
  `LAYER=${layer}&STYLE=normal&FORMAT=${format}&` +
  'TILEMATRIX={z}&TILEROW={y}&TILECOL={x}';

// ─── Gestionnaire de couches unifié (fonds + overlays avec sliders) ───

interface OverlayEntry {
  label: string;
  layer: L.Layer;
  opacity: number;
  visible: boolean;
  /** Applique l'opacité (WMS = setOpacity, cadastre = setStyle custom). */
  applyOpacity: (opacity: number) => void;
}

let mapRef: L.Map | null = null;
let overlaysListEl: HTMLElement | null = null;

function buildOverlayRow(entry: OverlayEntry, insertFirst = false): void {
  if (!overlaysListEl || !mapRef) return;
  const map = mapRef;

  const row = document.createElement('div');
  row.className = 'bp-layer-row';
  row.innerHTML = `
    <label class="bp-layer-head">
      <input type="checkbox" ${entry.visible ? 'checked' : ''}>
      <span class="bp-layer-name">${entry.label}</span>
      <span class="bp-layer-pct">${Math.round(entry.opacity * 100)}%</span>
    </label>
    <input type="range" class="layer-opacity-slider" min="0" max="100" value="${Math.round(entry.opacity * 100)}">
  `;

  const checkbox = row.querySelector('input[type="checkbox"]') as HTMLInputElement;
  const slider = row.querySelector('input[type="range"]') as HTMLInputElement;
  const pct = row.querySelector('.bp-layer-pct') as HTMLSpanElement;

  checkbox.addEventListener('change', () => {
    entry.visible = checkbox.checked;
    if (entry.visible) {
      entry.layer.addTo(map);
      entry.applyOpacity(entry.opacity);
    } else {
      map.removeLayer(entry.layer);
    }
  });

  slider.addEventListener('input', () => {
    entry.opacity = parseInt(slider.value) / 100;
    pct.textContent = `${slider.value}%`;
    entry.applyOpacity(entry.opacity);
  });

  if (insertFirst && overlaysListEl.firstChild) {
    overlaysListEl.insertBefore(row, overlaysListEl.firstChild);
  } else {
    overlaysListEl.appendChild(row);
  }
}

/**
 * Enregistre une couche externe (ex : cadastre GeoJSON) dans le panneau de
 * couches, avec checkbox + slider. À appeler après initializeMap().
 */
export function registerOverlayLayer(
  label: string,
  layer: L.Layer,
  opacity: number,
  applyOpacity: (opacity: number) => void,
  options: { visible?: boolean; insertFirst?: boolean } = {},
): void {
  const entry: OverlayEntry = {
    label,
    layer,
    opacity,
    visible: options.visible ?? true,
    applyOpacity,
  };
  if (mapRef && entry.visible && !mapRef.hasLayer(layer)) {
    layer.addTo(mapRef);
  }
  entry.applyOpacity(entry.opacity);
  buildOverlayRow(entry, options.insertFirst);
}

// Initialisation carte
export function initializeMap(): L.Map {
  const map = L.map('map', {
    center: [47.2380, 6.0243], // Besançon
    zoom: 13, // Zoom sur la ville
    zoomControl: true,
    attributionControl: true
  });
  mapRef = map;

  // ─── Fonds de carte ───

  // Plan IGN v2 : le fond de carte de cartes.gouv.fr
  const planIgnLayer = L.tileLayer(
    geopfWmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png'),
    {
      attribution: '© IGN — cartes.gouv.fr / Géoplateforme',
      maxZoom: 19
    }
  );

  // Couche OpenStreetMap (fallback, fonctionne partout)
  const osmLayer = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }
  );

  // Couche satellite IGN (gratuite, HD)
  const satelliteLayer = L.tileLayer(
    geopfWmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'),
    {
      attribution: '© IGN — Géoplateforme',
      maxZoom: 19
    }
  );

  // Mode hybride : satellite + routes + noms de lieux (couches PNG transparentes
  // de la Géoplateforme superposées à l'ortho, façon Google Maps "satellite").
  const hybridLayer = L.layerGroup([
    L.tileLayer(geopfWmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg'), {
      attribution: '© IGN — Géoplateforme',
      maxZoom: 19
    }),
    L.tileLayer(geopfWmts('TRANSPORTNETWORKS.ROADS', 'image/png'), { maxZoom: 19 }),
    L.tileLayer(geopfWmts('GEOGRAPHICALNAMES.NAMES', 'image/png'), { maxZoom: 19 })
  ]);

  const baseMaps: Record<string, L.Layer> = {
    'Satellite': satelliteLayer,
    'Satellite + repères': hybridLayer,
    'Plan IGN (cartes.gouv)': planIgnLayer,
    'OpenStreetMap': osmLayer
  };

  // Satellite brut par défaut
  let currentBase: L.Layer = satelliteLayer;
  currentBase.addTo(map);

  // ─── Overlays thématiques (mêmes flux que cartes.gouv.fr) ───
  // Zonages/MH : WMS IGN. Inondations : WMS Géorisques (c'est aussi lui que
  // fédère cartes.gouv — l'IGN n'héberge pas ces couches).
  // zIndex > 0 pour rester au-dessus du fond quand on change de fond.

  const zonageOverlay = L.tileLayer.wms('https://data.geopf.fr/wms-v/ows', {
    layers: 'zone_secteur',
    format: 'image/png',
    transparent: true,
    zIndex: 5,
    attribution: '© IGN / Géoportail de l\'urbanisme'
  });

  const rnuOverlay = L.tileLayer.wms('https://data.geopf.fr/wms-v/ows', {
    layers: 'municipality',
    format: 'image/png',
    transparent: true,
    zIndex: 6,
    attribution: '© IGN / Géoportail de l\'urbanisme'
  });

  const mhOverlay = L.tileLayer.wms('https://data.geopf.fr/wms-v/ows', {
    layers: 'monument_historique',
    format: 'image/png',
    transparent: true,
    zIndex: 7,
    attribution: '© IGN / Ministère de la Culture'
  });

  const ppriOverlay = L.tileLayer.wms('https://www.georisques.gouv.fr/services', {
    layers: 'PPRN_ZONE_INOND',
    format: 'image/png',
    transparent: true,
    zIndex: 8,
    attribution: '© Géorisques'
  });

  // EAIP : enveloppe large "inondation potentielle" (études EPRI), utile en
  // premier repérage là où aucun PPRi n'est approuvé.
  const eaipOverlay = L.tileLayer.wms('https://www.georisques.gouv.fr/services', {
    layers: 'MASQ_EAIP',
    format: 'image/png',
    transparent: true,
    zIndex: 9,
    attribution: '© Géorisques'
  });

  // ─── Panneau de couches custom (radios fonds + checkbox/slider par couche) ───

  const container = L.DomUtil.create('div', 'bp-layers-control leaflet-control');
  container.innerHTML = `
    <button class="bp-layers-toggle" title="Fonds et couches" type="button">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <div class="bp-layers-panel" hidden>
      <div class="bp-layers-section">Fond de carte</div>
      <div class="bp-base-list"></div>
      <div class="bp-layers-section">Couches</div>
      <div class="bp-overlay-list"></div>
    </div>
  `;

  // Empêcher les interactions du panneau de draguer/zoomer la carte
  L.DomEvent.disableClickPropagation(container);
  L.DomEvent.disableScrollPropagation(container);

  const toggleBtn = container.querySelector('.bp-layers-toggle') as HTMLButtonElement;
  const panel = container.querySelector('.bp-layers-panel') as HTMLElement;
  toggleBtn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
  });

  // Radios fonds de carte
  const baseList = container.querySelector('.bp-base-list') as HTMLElement;
  for (const [name, layer] of Object.entries(baseMaps)) {
    const label = document.createElement('label');
    label.className = 'bp-base-item';
    label.innerHTML = `<input type="radio" name="bp-basemap" ${layer === currentBase ? 'checked' : ''}> <span>${name}</span>`;
    (label.querySelector('input') as HTMLInputElement).addEventListener('change', () => {
      map.removeLayer(currentBase);
      currentBase = layer;
      currentBase.addTo(map);
    });
    baseList.appendChild(label);
  }

  overlaysListEl = container.querySelector('.bp-overlay-list') as HTMLElement;

  // Ordre d'affichage. Zonage + RNU affichés de base à 10%. Le cadastre
  // (15%, en tête de liste) est enregistré par main.ts via registerOverlayLayer.
  const wmsEntries: Array<[string, L.TileLayer.WMS, number, boolean]> = [
    ['🗺️ Zonage PLU (GPU)', zonageOverlay, 0.10, true],
    ['🏘️ Communes au RNU', rnuOverlay, 0.10, true],
    ['🏛️ Monuments historiques', mhOverlay, 0.80, false],
    ['🌊 PPR inondation', ppriOverlay, 0.60, false],
    ['💧 Zones inondables (EAIP)', eaipOverlay, 0.45, false],
  ];
  for (const [label, layer, opacity, visible] of wmsEntries) {
    registerOverlayLayer(label, layer, opacity, (o) => layer.setOpacity(o), { visible });
  }

  const LayersControl = L.Control.extend({
    onAdd: () => container,
  });
  new LayersControl({ position: 'topright' }).addTo(map);

  return map;
}
