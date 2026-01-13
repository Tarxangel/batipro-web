import type { AnalysePLUResponse } from './api';

let currentCard: HTMLElement | null = null;

export function showLoadingCard(): void {
  // Supprimer card existante
  if (currentCard) {
    currentCard.remove();
  }

  // Créer card de chargement
  const card = document.createElement('div');
  card.className = 'results-card loading';
  card.innerHTML = `
    <div class="results-card-header">
      <div class="spinner"></div>
      <h3>Analyse en cours...</h3>
    </div>
    <div class="results-card-body">
      <p class="loading-text">🔍 Identification de la parcelle</p>
      <p class="loading-text">📍 Récupération du zonage PLU/RNU</p>
      <p class="loading-text">🤖 Analyse IA en cours (20-30s)</p>
    </div>
  `;

  document.body.appendChild(card);
  currentCard = card;

  // Animation progressive des étapes
  animateLoadingSteps();
}

function animateLoadingSteps(): void {
  const steps = document.querySelectorAll('.loading-text');
  steps.forEach((step, index) => {
    setTimeout(() => {
      step.classList.add('active');
    }, index * 1000);
  });
}

export function showResultsCard(data: AnalysePLUResponse): void {
  // Supprimer card existante
  if (currentCard) {
    currentCard.remove();
  }

  const { parcelle, zonage, analyse } = data.data;

  // Déterminer couleur selon type de zonage
  const zoneColor = zonage.type === 'RNU' ? 'orange' : 'blue';

  // Créer card de résultats
  const card = document.createElement('div');
  card.className = 'results-card';
  card.innerHTML = `
    <div class="results-card-header">
      <div class="results-card-close" onclick="this.closest('.results-card').remove()">×</div>
      <div class="zone-badge ${zoneColor}">${zonage.libelle}</div>
      <h3>📍 ${parcelle.commune}</h3>
      <p class="parcelle-ref">Section ${parcelle.section} - N° ${parcelle.numero}</p>
    </div>
    <div class="results-card-body">
      <div class="info-row">
        <span class="info-label">Surface:</span>
        <span class="info-value">${parcelle.surface} m²</span>
      </div>
      <div class="info-row">
        <span class="info-label">Type:</span>
        <span class="info-value">${zonage.type === 'RNU' ? 'RNU - Règlement National' : 'PLU - Plan Local'}</span>
      </div>
      <hr>
      <div class="analyse-content">
        <h4>📋 Analyse Urbanistique</h4>
        <div class="analyse-text">${formatAnalyseText(analyse.texte)}</div>
      </div>
      <div class="card-actions">
        <a href="${parcelle.url_geoportail}" target="_blank" class="btn-link">
          🗺️ Voir sur Géoportail
        </a>
        ${zonage.url_document ? `
          <a href="${zonage.url_document}" target="_blank" class="btn-link">
            📄 Document PLU
          </a>
        ` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(card);
  currentCard = card;

  // Animation d'entrée
  setTimeout(() => {
    card.classList.add('visible');
  }, 10);
}

function formatAnalyseText(text: string): string {
  // Remplacer les retours à la ligne par <br>
  // Détecter les bullet points et les formater
  return text
    .split('\n')
    .map(line => {
      // Si la ligne commence par un emoji ou un tiret, c'est un bullet point
      if (line.match(/^[•\-–—]\s/) || line.match(/^[\u{1F300}-\u{1F9FF}]/u)) {
        return `<p class="bullet-point">${line}</p>`;
      }
      // Sinon ligne normale
      return line ? `<p>${line}</p>` : '';
    })
    .join('');
}

export function showErrorCard(error: string): void {
  // Supprimer card existante
  if (currentCard) {
    currentCard.remove();
  }

  // Créer card d'erreur
  const card = document.createElement('div');
  card.className = 'results-card error';
  card.innerHTML = `
    <div class="results-card-header">
      <div class="results-card-close" onclick="this.closest('.results-card').remove()">×</div>
      <h3>❌ Erreur</h3>
    </div>
    <div class="results-card-body">
      <p>${error}</p>
      <p class="error-hint">Vérifiez que vous avez cliqué sur une parcelle valide.</p>
    </div>
  `;

  document.body.appendChild(card);
  currentCard = card;

  // Animation d'entrée
  setTimeout(() => {
    card.classList.add('visible');
  }, 10);
}
