// Gestionnaire de pins sauvegardés sur la carte

import L from 'leaflet';
import type { SavedAnalysis } from './database';
import { getAllAnalyses } from './database';
import { showResultsCard } from './resultsCard';

export class SavedPinsManager {
  private layerGroup: L.LayerGroup;
  private analyses: Map<string, SavedAnalysis>;
  private markers: Map<string, L.Marker>;
  private visible: boolean = true;

  constructor(map: L.Map) {
    this.layerGroup = L.layerGroup().addTo(map);
    this.analyses = new Map();
    this.markers = new Map();
  }

  // Charger toutes les analyses depuis la DB et créer les markers
  async loadSavedPins(): Promise<void> {
    try {
      console.log('🔄 Chargement des analyses sauvegardées...');

      const analyses = await getAllAnalyses();

      // Créer un marker pour chaque analyse
      for (const analysis of analyses) {
        this.analyses.set(analysis.id, analysis);
        const marker = this.createSavedMarker(analysis);
        this.markers.set(analysis.id, marker);
      }

      console.log(`✅ ${analyses.length} pins sauvegardés chargés`);
    } catch (error) {
      console.error('❌ Erreur chargement pins sauvegardés:', error);
      throw error;
    }
  }

  // Créer un marker pour une analyse sauvegardée
  createSavedMarker(analysis: SavedAnalysis): L.Marker {
    const { latitude, longitude } = analysis.data;

    // Créer icône personnalisée pour pins sauvegardés (petit cercle bleu)
    const savedIcon = L.divIcon({
      className: 'saved-marker',
      html: '<div class="saved-marker-inner"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    // Créer marker avec l'icône personnalisée
    const marker = L.marker([latitude, longitude], {
      icon: savedIcon
    });

    // Ajouter popup avec infos basiques
    const popupContent = `
      <div style="text-align: center;">
        <strong>${analysis.data.parcelle.commune}</strong><br>
        <small>Section ${analysis.data.parcelle.section} - N° ${analysis.data.parcelle.numero}</small><br>
        <small style="color: #666;">${analysis.data.zonage.libelle}</small>
      </div>
    `;
    marker.bindPopup(popupContent);

    // Handler de clic: afficher les résultats cachés (pas d'appel API)
    marker.on('click', () => {
      console.log('🔍 Clic sur pin sauvegardé:', analysis.id);
      showResultsCard(analysis);
    });

    // Ajouter au layer group si visible
    if (this.visible) {
      this.layerGroup.addLayer(marker);
    }

    return marker;
  }

  // Toggle visibilité de tous les pins sauvegardés
  togglePinsVisibility(): void {
    this.visible = !this.visible;

    if (this.visible) {
      // Afficher tous les markers
      this.markers.forEach((marker) => {
        this.layerGroup.addLayer(marker);
      });
      console.log('👁️ Pins sauvegardés affichés');
    } else {
      // Masquer tous les markers
      this.layerGroup.clearLayers();
      console.log('🙈 Pins sauvegardés masqués');
    }
  }

  // Supprimer un marker spécifique (après suppression de la DB)
  removeSavedMarker(id: string): void {
    const marker = this.markers.get(id);
    if (marker) {
      this.layerGroup.removeLayer(marker);
      this.markers.delete(id);
      this.analyses.delete(id);
      console.log('🗑️ Marker supprimé:', id);
    }
  }

  // Ajouter un nouveau marker (après création d'une nouvelle analyse)
  addSavedMarker(analysis: SavedAnalysis): L.Marker {
    this.analyses.set(analysis.id, analysis);
    const marker = this.createSavedMarker(analysis);
    this.markers.set(analysis.id, marker);
    return marker;
  }

  // Vérifier si les pins sont visibles
  isPinsVisible(): boolean {
    return this.visible;
  }

  // Obtenir le nombre total d'analyses
  getAnalysesCount(): number {
    return this.analyses.size;
  }

  // Obtenir une analyse par ID
  getAnalysis(id: string): SavedAnalysis | undefined {
    return this.analyses.get(id);
  }
}
