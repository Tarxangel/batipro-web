import type { AnalysePLUResponse } from './api';
import { deleteAnalysis } from './database';

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

  // Bouton supprimer si c'est une analyse sauvegardée
  const deleteButtonHtml = data.id ? `
    <button class="btn-delete" data-analysis-id="${data.id}">
      🗑️ Supprimer cette analyse
    </button>
  ` : '';

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
      ${deleteButtonHtml}
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
      <button class="btn-share">
        📤 Partager
      </button>
    </div>
  `;

  document.body.appendChild(card);
  currentCard = card;

  // Ajouter handler de suppression
  if (data.id) {
    const deleteBtn = card.querySelector('.btn-delete') as HTMLButtonElement;
    deleteBtn?.addEventListener('click', async () => {
      if (!confirm('Supprimer cette analyse définitivement ?')) return;

      deleteBtn.disabled = true;
      deleteBtn.textContent = '⏳ Suppression...';

      try {
        await deleteAnalysis(data.id!);
        const savedPinsManager = (window as any).savedPinsManager;
        if (savedPinsManager) {
          savedPinsManager.removeSavedMarker(data.id!);
        }
        card.remove();
        console.log('✅ Analyse supprimée:', data.id);
      } catch (error) {
        console.error('❌ Erreur suppression:', error);
        alert('Erreur lors de la suppression. Réessayez.');
        deleteBtn.disabled = false;
        deleteBtn.textContent = '🗑️ Supprimer cette analyse';
      }
    });
  }

  // Ajouter handler de partage
  const shareBtn = card.querySelector('.btn-share') as HTMLButtonElement;
  shareBtn?.addEventListener('click', () => {
    handleShare(data);
  });

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

// Fonction de partage
function handleShare(data: AnalysePLUResponse): void {
  const { parcelle, zonage, analyse } = data.data;

  // Créer le texte à partager
  const shareText = `📍 Analyse PLU - ${parcelle.commune}

Section ${parcelle.section} - N° ${parcelle.numero}
Surface: ${parcelle.surface} m²
Zone: ${zonage.libelle} (${zonage.type})

${analyse.texte.substring(0, 200)}...

Plus d'infos: ${parcelle.url_geoportail}`;

  // Créer un élément de dialogue personnalisé
  const shareDialog = document.createElement('div');
  shareDialog.className = 'share-dialog';
  shareDialog.innerHTML = `
    <div class="share-dialog-content">
      <div class="share-dialog-header">
        <h3>Partager l'analyse</h3>
        <button class="share-dialog-close">×</button>
      </div>
      <div class="share-dialog-body">
        <button class="share-option" data-method="email">
          📧 Email
        </button>
        <button class="share-option" data-method="sms">
          💬 SMS
        </button>
        <button class="share-option" data-method="copy">
          📋 Copier le texte
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(shareDialog);

  // Animation d'entrée
  setTimeout(() => {
    shareDialog.classList.add('visible');
  }, 10);

  // Gestionnaires d'événements
  const closeBtn = shareDialog.querySelector('.share-dialog-close');
  closeBtn?.addEventListener('click', () => {
    shareDialog.classList.remove('visible');
    setTimeout(() => shareDialog.remove(), 300);
  });

  const shareOptions = shareDialog.querySelectorAll('.share-option');
  shareOptions.forEach(option => {
    option.addEventListener('click', () => {
      const method = option.getAttribute('data-method');

      switch (method) {
        case 'email':
          const emailSubject = encodeURIComponent(`Analyse PLU - ${parcelle.commune}`);
          const emailBody = encodeURIComponent(shareText);
          window.location.href = `mailto:?subject=${emailSubject}&body=${emailBody}`;
          break;

        case 'sms':
          const smsBody = encodeURIComponent(shareText);
          // iOS et Android supportent tous deux le protocole sms:
          window.location.href = `sms:?body=${smsBody}`;
          break;

        case 'copy':
          navigator.clipboard.writeText(shareText).then(() => {
            alert('✅ Texte copié dans le presse-papier !');
          }).catch(err => {
            console.error('❌ Erreur copie:', err);
            // Fallback: afficher le texte pour copie manuelle
            const textarea = document.createElement('textarea');
            textarea.value = shareText;
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            alert('✅ Texte copié dans le presse-papier !');
          });
          break;
      }

      // Fermer le dialogue après action
      shareDialog.classList.remove('visible');
      setTimeout(() => shareDialog.remove(), 300);
    });
  });

  // Fermer si on clique en dehors
  shareDialog.addEventListener('click', (e) => {
    if (e.target === shareDialog) {
      shareDialog.classList.remove('visible');
      setTimeout(() => shareDialog.remove(), 300);
    }
  });
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
