import L from 'leaflet';
import type { ParcelGeoJSON, ParcelProperties } from './types';

// Charger parcelles cadastrales via WFS IGN
export async function loadCadastreLayer(
  map: L.Map,
  bounds: L.LatLngBounds
): Promise<L.GeoJSON | null> {
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

    // Ajouter couche GeoJSON à la carte
    const cadastreLayer = L.geoJSON(geojson, {
      style: {
        color: '#FFD700',      // Jaune doré
        weight: 2,
        opacity: 0.8,
        fillColor: '#FFD700',
        fillOpacity: 0.1
      },
      onEachFeature: (feature, layer) => {
        // Click sur parcelle → highlight + infos
        layer.on('click', () => {
          highlightParcel(layer, feature.properties as ParcelProperties);
        });
      }
    });

    cadastreLayer.addTo(map);
    return cadastreLayer;
  } catch (error) {
    console.error('Erreur chargement cadastre:', error);
    return null;
  }
}

function highlightParcel(_layer: L.Layer, properties: ParcelProperties): void {
  // Implementation highlight (Phase 1 - console log, Phase 3 - card UI)
  console.log('Parcelle sélectionnée:', properties);
}
