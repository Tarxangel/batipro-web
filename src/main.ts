import './styles/main.css';
import { MAINTENANCE_MODE } from './config';
import { showMaintenancePage } from './maintenance';
import { initializeMap } from './map';
import { loadCadastreLayer } from './cadastre';
import { setupLongPressInteraction } from './interactions';
import { setupSearchBar } from './search';
import { SavedPinsManager } from './savedPins';
import { createToggleButton, updateToggleButtonState } from './ui/toggleButton';
import { testDatabaseConnection } from './database';

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

  // Initialiser saved pins manager
  const savedPinsManager = new SavedPinsManager(map);
  (window as any).savedPinsManager = savedPinsManager; // Pour accès global

  // Tester connexion DB et charger pins sauvegardés
  try {
    const connected = await testDatabaseConnection();
    if (connected) {
      console.log('✅ Connexion Supabase établie');

      // Charger pins sauvegardés
      await savedPinsManager.loadSavedPins();
      const count = savedPinsManager.getAnalysesCount();
      console.log(`✅ ${count} analyses chargées`);
    } else {
      console.warn('⚠️ DB non disponible - mode dégradé');
    }
  } catch (error) {
    console.error('⚠️ Erreur initialisation DB:', error);
  }

  // Créer bouton toggle
  const toggleButton = createToggleButton(() => {
    savedPinsManager.togglePinsVisibility();
    updateToggleButtonState(
      savedPinsManager.isPinsVisible(),
      savedPinsManager.getAnalysesCount()
    );
  });
  document.body.appendChild(toggleButton);
  updateToggleButtonState(true, savedPinsManager.getAnalysesCount());

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
