import './styles/main.css';
import { MAINTENANCE_MODE } from './config';
import { showMaintenancePage } from './maintenance';
import { initializeMap } from './map';
import { loadCadastreLayer } from './cadastre';
import { setupLongPressInteraction } from './interactions';
import { setupSearchBar } from './search';

// Initialisation au chargement DOM
document.addEventListener('DOMContentLoaded', async () => {
  console.log('Bâti Pro - Initialisation...');

  // Vérifier si le mode maintenance est activé
  if (MAINTENANCE_MODE) {
    console.log('Mode maintenance activé - Affichage page construction');
    showMaintenancePage();
    return;
  }

  // Initialiser la carte
  const map = initializeMap();
  console.log('Carte initialisée');

  // Setup barre de recherche
  setupSearchBar(map);
  console.log('Barre de recherche configurée');

  // Setup interactions appui long
  setupLongPressInteraction(map);
  console.log('Interactions appui long configurées');

  // Charger cadastre quand zoom > 14
  map.on('zoomend moveend', async () => {
    if (map.getZoom() >= 14) {
      const bounds = map.getBounds();
      console.log('Zoom >= 14, chargement cadastre...');
      await loadCadastreLayer(map, bounds);
    }
  });

  console.log('Bâti Pro - Application prête ✅');
});
