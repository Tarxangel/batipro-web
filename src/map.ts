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

// Initialisation carte avec fond satellite IGN
export function initializeMap(): L.Map {
  const map = L.map('map', {
    center: [47.2380, 6.0243], // Besançon
    zoom: 13, // Zoom sur la ville
    zoomControl: true,
    attributionControl: true
  });

  // Couche OpenStreetMap (fallback, fonctionne partout)
  const osmLayer = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    }
  );

  // Couche satellite IGN (gratuite, HD) - Nouvelle API Géoplateforme
  const satelliteLayer = L.tileLayer(
    'https://wxs.geopf.fr/essentiels/geoportail/wmts?' +
    'REQUEST=GetTile&SERVICE=WMTS&VERSION=1.0.0&TILEMATRIXSET=PM&' +
    'LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&' +
    'TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
    {
      attribution: '© IGN-F/Geoportail',
      maxZoom: 19
    }
  );

  // Utiliser OSM par défaut (plus fiable)
  osmLayer.addTo(map);

  // Contrôle de couches pour basculer entre OSM et Satellite
  const baseMaps = {
    'OpenStreetMap': osmLayer,
    'Satellite IGN': satelliteLayer
  };

  L.control.layers(baseMaps).addTo(map);

  return map;
}
