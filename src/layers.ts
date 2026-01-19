import L from 'leaflet';
import { setCadastreOpacity } from './cadastre';

interface LayerControl {
  name: string;
  layer: L.GeoJSON;
  opacity: number;
}

let layersControl: LayerControl[] = [];
let panelVisible = false;

// Créer l'UI de gestion des couches
export function createLayersUI(): void {
  // Créer le conteneur principal
  const layersPanel = document.createElement('div');
  layersPanel.className = 'layers-panel';
  layersPanel.id = 'layers-panel';

  layersPanel.innerHTML = `
    <div class="layers-panel-header">
      <h3>Gestion des couches</h3>
      <button class="layers-panel-close">×</button>
    </div>
    <div class="layers-panel-body" id="layers-list">
      <!-- Les couches seront ajoutées dynamiquement ici -->
    </div>
  `;

  document.body.appendChild(layersPanel);

  // Créer le bouton toggle pour ouvrir/fermer le panneau
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'layers-toggle-btn';
  toggleBtn.title = 'Gérer les couches';
  toggleBtn.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  document.body.appendChild(toggleBtn);

  // Event listeners
  toggleBtn.addEventListener('click', () => {
    toggleLayersPanel();
  });

  const closeBtn = layersPanel.querySelector('.layers-panel-close');
  closeBtn?.addEventListener('click', () => {
    hideLayersPanel();
  });

  // Fermer si on clique en dehors
  layersPanel.addEventListener('click', (e) => {
    if (e.target === layersPanel) {
      hideLayersPanel();
    }
  });
}

// Ajouter une couche au gestionnaire
export function registerLayer(name: string, layer: L.GeoJSON, defaultOpacity: number = 0.5): void {
  // Vérifier si la couche existe déjà
  const existingLayer = layersControl.find(lc => lc.name === name);
  if (existingLayer) {
    console.log(`⚠️ Couche "${name}" déjà enregistrée, skip`);
    return;
  }

  const layerControl: LayerControl = {
    name,
    layer,
    opacity: defaultOpacity
  };

  layersControl.push(layerControl);
  addLayerToUI(layerControl);
  console.log(`✅ Couche "${name}" enregistrée`);
}

// Ajouter une couche à l'UI
function addLayerToUI(layerControl: LayerControl): void {
  const layersList = document.getElementById('layers-list');
  if (!layersList) return;

  const layerItem = document.createElement('div');
  layerItem.className = 'layer-item';
  layerItem.innerHTML = `
    <div class="layer-header">
      <span class="layer-name">${layerControl.name}</span>
      <span class="layer-opacity-value">${Math.round(layerControl.opacity * 100)}%</span>
    </div>
    <div class="layer-controls">
      <input
        type="range"
        class="layer-opacity-slider"
        min="0"
        max="100"
        value="${Math.round(layerControl.opacity * 100)}"
        data-layer-name="${layerControl.name}"
      />
    </div>
  `;

  layersList.appendChild(layerItem);

  // Event listener pour le slider
  const slider = layerItem.querySelector('.layer-opacity-slider') as HTMLInputElement;
  const opacityValue = layerItem.querySelector('.layer-opacity-value') as HTMLSpanElement;

  slider?.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    const opacity = parseInt(target.value) / 100;
    layerControl.opacity = opacity;

    // Mettre à jour l'affichage
    opacityValue.textContent = `${Math.round(opacity * 100)}%`;

    // Mettre à jour la couche
    if (layerControl.name === 'Cadastre') {
      setCadastreOpacity(layerControl.layer, opacity);
    }
  });
}

// Toggle panneau
function toggleLayersPanel(): void {
  if (panelVisible) {
    hideLayersPanel();
  } else {
    showLayersPanel();
  }
}

function showLayersPanel(): void {
  const panel = document.getElementById('layers-panel');
  if (panel) {
    panel.classList.add('visible');
    panelVisible = true;
  }
}

function hideLayersPanel(): void {
  const panel = document.getElementById('layers-panel');
  if (panel) {
    panel.classList.remove('visible');
    panelVisible = false;
  }
}
