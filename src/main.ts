import './styles/main.css';
import { MAINTENANCE_MODE } from './config';
import { showMaintenancePage } from './maintenance';
import { initializeMap } from './map';
import { loadCadastreLayer, initGlobalCadastreLayer } from './cadastre';
import { setupLongPressInteraction } from './interactions';
import { setupSearchBar } from './search';
import { SavedPinsManager } from './savedPins';
import { createToggleButton, updateToggleButtonState } from './ui/toggleButton';
import { testDatabaseConnection } from './database';
import { PinsListPanel } from './ui/pinsList';
import { showResultsCard } from './resultsCard';
import { createLayersUI, registerLayer } from './layers';
import { createGeolocationButton } from './geolocation';

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

  // Créer panneau de liste des pins
  const pinsListPanel = new PinsListPanel((analysis) => {
    // Callback appelé quand on clique sur un pin dans la liste
    // 1. Zoomer sur le pin
    const { latitude, longitude } = analysis.data;
    map.setView([latitude, longitude], 18, {
      animate: true,
      duration: 0.5
    });

    // 2. Afficher les résultats
    showResultsCard(analysis);

    // 3. Fermer le panneau
    pinsListPanel.hide();
  });
  (window as any).pinsListPanel = pinsListPanel;

  // Créer bouton toggle qui ouvre maintenant le panneau
  const toggleButton = createToggleButton(() => {
    const analyses = savedPinsManager.getAllAnalyses();
    pinsListPanel.toggle(analyses);
  });
  document.body.appendChild(toggleButton);
  updateToggleButtonState(true, savedPinsManager.getAnalysesCount());

  // Setup barre de recherche
  setupSearchBar(map);
  console.log('Barre de recherche configurée');

  // Setup interactions appui long
  setupLongPressInteraction(map);
  console.log('Interactions appui long configurées');

  // Créer l'UI de gestion des couches
  createLayersUI();
  console.log('UI gestion des couches créée');

  // Créer le bouton de géolocalisation
  createGeolocationButton(map);
  console.log('Bouton géolocalisation créé');

  // Initialiser la couche cadastre globale UNE SEULE FOIS
  const globalCadastreLayer = initGlobalCadastreLayer(map);

  // Enregistrer la couche dans le gestionnaire UNE SEULE FOIS
  registerLayer('Cadastre', globalCadastreLayer, 0.5);
  console.log('✅ Couche cadastre globale initialisée et enregistrée');

  // Charger les données cadastre quand zoom >= 14
  map.on('zoomend moveend', async () => {
    if (map.getZoom() >= 14) {
      const bounds = map.getBounds();
      // Cela ajoutera les features à la couche globale existante
      await loadCadastreLayer(map, bounds);
    }
  });

  console.log('Bâti Pro - Application prête ✅');
});
