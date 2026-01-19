import L from 'leaflet';
import type { ParcelGeoJSON, ParcelProperties } from './types';

let currentCadastreOpacity = 0.5; // Opacité par défaut à 50%
let highlightedLayer: L.Layer | null = null;
let globalCadastreLayer: L.GeoJSON | null = null; // Couche globale unique
let loadedBounds: Set<string> = new Set(); // Pour éviter de recharger les mêmes zones

// Initialiser la couche cadastre globale
export function initGlobalCadastreLayer(map: L.Map): L.GeoJSON {
  if (!globalCadastreLayer) {
    globalCadastreLayer = L.geoJSON(undefined, {
      style: () => {
        return {
          color: '#FFD700',
          weight: 2,
          opacity: currentCadastreOpacity,
          fillColor: '#FFD700',
          fillOpacity: currentCadastreOpacity * 0.2
        };
      },
      onEachFeature: (feature, layer) => {
        layer.on('click', () => {
          highlightParcel(layer, feature.properties as ParcelProperties);
        });
        (layer as any).feature = feature;
      }
    });
    globalCadastreLayer.addTo(map);
  }
  return globalCadastreLayer;
}

// Charger parcelles cadastrales dans la couche globale
export async function loadCadastreLayer(
  map: L.Map,
  bounds: L.LatLngBounds
): Promise<L.GeoJSON | null> {
  // Créer un identifiant unique pour cette zone
  const boundsKey = `${bounds.getWest().toFixed(4)},${bounds.getSouth().toFixed(4)},${bounds.getEast().toFixed(4)},${bounds.getNorth().toFixed(4)}`;

  // Si déjà chargée, ignorer
  if (loadedBounds.has(boundsKey)) {
    console.log('Zone déjà chargée, skip');
    return globalCadastreLayer;
  }

  const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;

  const url = `https://data.geopf.fr/wfs?` +
    `service=WFS&version=2.0.0&request=GetFeature&` +
    `typeName=CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle&` +
    `outputFormat=application/json&` +
    `srsName=EPSG:4326&` +
    `bbox=${bbox},EPSG:4326`;

  try {
    const response = await fetch(url);
    const geojson: ParcelGeoJSON = await response.json();

    // Initialiser la couche globale si nécessaire
    if (!globalCadastreLayer) {
      initGlobalCadastreLayer(map);
    }

    // Ajouter les features à la couche globale existante
    if (globalCadastreLayer && geojson.features) {
      globalCadastreLayer.addData(geojson);
      loadedBounds.add(boundsKey);
      console.log(`✅ ${geojson.features.length} parcelles ajoutées à la couche globale`);
    }

    return globalCadastreLayer;
  } catch (error) {
    console.error('Erreur chargement cadastre:', error);
    return null;
  }
}

// Obtenir la couche globale
export function getGlobalCadastreLayer(): L.GeoJSON | null {
  return globalCadastreLayer;
}

// Mettre à jour l'opacité de la couche cadastre
export function setCadastreOpacity(layer: L.GeoJSON, opacity: number): void {
  currentCadastreOpacity = opacity;
  layer.setStyle({
    opacity: opacity,
    fillOpacity: opacity * 0.2
  });

  // Réappliquer le highlight si une parcelle est sélectionnée
  if (highlightedLayer) {
    (highlightedLayer as any).setStyle({
      color: '#FF0000',
      weight: 3,
      opacity: Math.min(opacity + 0.3, 1),
      fillColor: '#FF0000',
      fillOpacity: Math.min(opacity * 0.4, 0.3)
    });
  }
}

// Highlight une parcelle en rouge
export function highlightParcelOnMap(layer: L.Layer): void {
  // Réinitialiser le précédent highlight
  if (highlightedLayer && highlightedLayer !== layer) {
    (highlightedLayer as any).setStyle({
      color: '#FFD700',
      weight: 2,
      opacity: currentCadastreOpacity,
      fillColor: '#FFD700',
      fillOpacity: currentCadastreOpacity * 0.2
    });
  }

  // Appliquer le nouveau highlight
  (layer as any).setStyle({
    color: '#FF0000',        // Rouge
    weight: 3,
    opacity: Math.min(currentCadastreOpacity + 0.3, 1),
    fillColor: '#FF0000',
    fillOpacity: Math.min(currentCadastreOpacity * 0.4, 0.3)
  });

  highlightedLayer = layer;
}

// Réinitialiser le highlight
export function resetParcelHighlight(): void {
  if (highlightedLayer) {
    (highlightedLayer as any).setStyle({
      color: '#FFD700',
      weight: 2,
      opacity: currentCadastreOpacity,
      fillColor: '#FFD700',
      fillOpacity: currentCadastreOpacity * 0.2
    });
    highlightedLayer = null;
  }
}

function highlightParcel(_layer: L.Layer, properties: ParcelProperties): void {
  // Implementation highlight (Phase 1 - console log, Phase 3 - card UI)
  console.log('Parcelle sélectionnée:', properties);
}
