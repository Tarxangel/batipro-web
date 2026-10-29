// Panneau latéral avec liste des pins sauvegardés

import type { SavedAnalysis } from '../database';

export class PinsListPanel {
  private panel: HTMLElement | null = null;
  private isOpen: boolean = false;
  private onPinClick: (analysis: SavedAnalysis) => void;

  constructor(onPinClick: (analysis: SavedAnalysis) => void) {
    this.onPinClick = onPinClick;
  }

  // Créer et afficher le panneau
  show(analyses: SavedAnalysis[]): void {
    // Supprimer panneau existant
    if (this.panel) {
      this.panel.remove();
    }

    // Créer panneau
    this.panel = document.createElement('div');
    this.panel.className = 'pins-list-panel';

    // Header
    const header = document.createElement('div');
    header.className = 'pins-list-header';
    header.innerHTML = `
      <h3>📍 Analyses sauvegardées (${analyses.length})</h3>
      <button class="pins-list-close">×</button>
    `;

    // Liste
    const list = document.createElement('div');
    list.className = 'pins-list-content';

    if (analyses.length === 0) {
      list.innerHTML = `
        <div class="pins-list-empty">
          <p>Aucune analyse sauvegardée</p>
          <small>Faites un clic droit sur la carte pour créer une analyse</small>
        </div>
      `;
    } else {
      // Trier par date (plus récent en premier)
      const sortedAnalyses = [...analyses].sort((a, b) =>
        new Date(b.data.timestamp).getTime() - new Date(a.data.timestamp).getTime()
      );

      sortedAnalyses.forEach(analysis => {
        const item = this.createListItem(analysis);
        list.appendChild(item);
      });
    }

    this.panel.appendChild(header);
    this.panel.appendChild(list);
    document.body.appendChild(this.panel);

    // Ajouter événements
    const closeBtn = this.panel.querySelector('.pins-list-close');
    closeBtn?.addEventListener('click', () => this.hide());

    // Animation d'entrée
    setTimeout(() => {
      this.panel?.classList.add('visible');
    }, 10);

    this.isOpen = true;
  }

  // Créer un item de liste
  private createListItem(analysis: SavedAnalysis): HTMLElement {
    const item = document.createElement('div');
    item.className = 'pins-list-item';

    const { parcelle, zonage } = analysis.data;
    const date = new Date(analysis.data.timestamp);
    const dateStr = date.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const zoneColor = zonage.type === 'NON_PUBLIE' ? 'grey' : zonage.type === 'RNU' ? 'orange' : 'blue';

    item.innerHTML = `
      <div class="pins-list-item-header">
        <div class="pins-list-item-title">
          <strong>${parcelle.commune}</strong>
          <span class="zone-badge-small ${zoneColor}">${zonage.libelle}</span>
        </div>
        <small class="pins-list-item-date">${dateStr}</small>
      </div>
      <div class="pins-list-item-info">
        <span>Section ${parcelle.section} - N° ${parcelle.numero}</span>
        <span>${parcelle.surface} m²</span>
      </div>
    `;

    // Événement de clic sur l'item
    item.addEventListener('click', () => {
      this.onPinClick(analysis);
    });

    return item;
  }

  // Masquer le panneau
  hide(): void {
    if (this.panel) {
      this.panel.classList.remove('visible');
      setTimeout(() => {
        this.panel?.remove();
        this.panel = null;
      }, 300); // Durée de l'animation
    }
    this.isOpen = false;
  }

  // Toggle visibilité
  toggle(analyses: SavedAnalysis[]): void {
    if (this.isOpen) {
      this.hide();
    } else {
      this.show(analyses);
    }
  }

  // Vérifier si le panneau est ouvert
  isVisible(): boolean {
    return this.isOpen;
  }
}
