import L from 'leaflet';
import { analyserPLU } from './api';
import { showLoadingCard, showResultsCard, showErrorCard } from './resultsCard';
import { saveAnalysis } from './database';

let touchTimer: number | null = null;
let currentMarker: L.Marker | null = null;

export function setupLongPressInteraction(map: L.Map): void {
  // Désactiver le menu contextuel par défaut
  map.getContainer().addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // Appui long avec contextmenu (plus fiable sur desktop)
  map.on('contextmenu', (e: L.LeafletMouseEvent) => {
    console.log('Context menu (right-click) détecté');
    onLongPress(map, e.latlng);
  });

  // Appui long mobile avec touchstart/touchend
  let touchStartTime = 0;
  let touchStartLatLng: L.LatLng | null = null;

  map.on('touchstart', (e: L.LeafletEvent) => {
    const mouseEvent = e as L.LeafletMouseEvent;
    touchStartTime = Date.now();
    touchStartLatLng = mouseEvent.latlng;

    console.log('Touch start détecté');

    touchTimer = window.setTimeout(() => {
      console.log('Timer 500ms écoulé - appui long!');
      if (touchStartLatLng) {
        onLongPress(map, touchStartLatLng);
      }
    }, 500);
  });

  map.on('touchmove', () => {
    console.log('Touch move - annulation timer');
    if (touchTimer) {
      window.clearTimeout(touchTimer);
      touchTimer = null;
    }
  });

  map.on('touchend', () => {
    const duration = Date.now() - touchStartTime;
    console.log(`Touch end - durée: ${duration}ms`);

    if (touchTimer) {
      window.clearTimeout(touchTimer);
      touchTimer = null;
    }
  });

  // Alternative: Double-click pour desktop
  map.on('dblclick', (e: L.LeafletMouseEvent) => {
    console.log('Double-click détecté');
    onLongPress(map, e.latlng);
  });

  console.log('Interactions configurées: clic droit OU appui long (500ms) OU double-clic');
}

async function onLongPress(map: L.Map, latlng: L.LatLng): Promise<void> {
  console.log('🎯 onLongPress appelé!', latlng);

  // Supprimer marker précédent si existe
  if (currentMarker) {
    map.removeLayer(currentMarker);
  }

  // Placer pin marker (utilise icône par défaut Leaflet)
  currentMarker = L.marker(latlng).addTo(map);

  // Ajouter popup pour confirmer
  currentMarker.bindPopup(`📍 Analyse en cours...<br>Lat: ${latlng.lat.toFixed(5)}<br>Lng: ${latlng.lng.toFixed(5)}`).openPopup();

  console.log('✅ Pin placé à:', latlng);

  // Afficher card de chargement
  showLoadingCard();

  try {
    // Appeler l'API n8n pour analyser le PLU
    const resultat = await analyserPLU(latlng.lat, latlng.lng);

    // Sauvegarder dans la DB
    try {
      const savedAnalysis = await saveAnalysis({
        ...resultat,
        data: {
          ...resultat.data,
          latitude: latlng.lat,
          longitude: latlng.lng
        }
      });

      // Remplacer marker temporaire par marker sauvegardé
      if (currentMarker) {
        map.removeLayer(currentMarker);
      }

      const savedPinsManager = (window as any).savedPinsManager;
      if (savedPinsManager) {
        currentMarker = savedPinsManager.addSavedMarker(savedAnalysis);
        if (currentMarker) {
          currentMarker.bindPopup(`✅ Analyse sauvegardée<br>${resultat.data.parcelle.commune}`).openPopup();
        }
      }

      // Afficher les résultats avec l'ID de la DB
      showResultsCard(savedAnalysis);

      console.log('✅ Analyse sauvegardée:', savedAnalysis.id);
    } catch (dbError) {
      console.error('⚠️ Erreur sauvegarde DB (non bloquant):', dbError);
      // Ne pas bloquer l'UX si la DB échoue. On réinjecte les coordonnées du clic :
      // sans elles la card ne peut pas proposer la fiche Géorisques.
      showResultsCard({
        ...resultat,
        data: { ...resultat.data, latitude: latlng.lat, longitude: latlng.lng },
      });
      if (currentMarker) {
        currentMarker.bindPopup(`✅ Analyse terminée<br>${resultat.data.parcelle.commune}`).openPopup();
      }
    }
  } catch (error) {
    console.error('Erreur analyse PLU:', error);
    showErrorCard('Impossible d\'analyser cette parcelle. Vérifiez que vous avez cliqué sur une zone cadastrée.');

    // Mettre à jour la popup
    if (currentMarker) {
      currentMarker.bindPopup(`❌ Erreur d'analyse`).openPopup();
    }
  }
}

// Note: Les fonctions identifyParcel, highlightParcel et displayParcelInfo
// ne sont plus nécessaires car l'analyse est gérée directement par l'API n8n
