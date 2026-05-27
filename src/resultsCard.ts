import type { AnalysePLUResponse, MonumentHistorique } from './api';
import { deleteAnalysis, SavedAnalysis } from './database';
import { showDetailedTableModal } from './detailedTable';
import { showMonumentsHistoriques, clearMonumentsHistoriques } from './monumentsHistoriques';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

// Extrait { insee, prefix, section } depuis l'URL Géoportail Urbanisme.
// Format URL : https://www.geoportail-urbanisme.gouv.fr/map/parcel-info/{dep}_{com}_{com_abs}_{code_arr}_{section}_{numero}/
// L'INSEE est dep+com (concat). com_abs sert de "prefix" pour cadastre.data.gouv.fr.
function parseCadastreCodes(urlGeoportail: string): { insee: string; prefix: string; section: string } | null {
  const m = urlGeoportail.match(/\/parcel-info\/([^/]+)/);
  if (!m) return null;
  const parts = m[1].split('_');
  if (parts.length < 6) return null;
  const [dep, com, com_abs, _code_arr, section] = parts;
  const insee = dep + com;
  const prefix = com_abs && com_abs.length === 3 ? com_abs : '000';
  return { insee, prefix, section };
}

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
  const monumentsHistoriques = data.data.monuments_historiques;

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
      ${renderMonumentsSection(monumentsHistoriques)}
      ${data.id ? `
        <button class="btn-detailed-table" title="Générer le tableau réglementaire détaillé (14 rubriques)">
          📋 Générer tableau détaillé
        </button>
      ` : ''}
      <button class="btn-download-cadastre" title="Télécharge toutes les feuilles DXF de la section pour import dans Allplan">
        📥 Télécharger cadastre DXF
      </button>
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

  // Afficher les MH sur la carte (vide la couche puis ajoute les markers)
  showMonumentsHistoriques(monumentsHistoriques);

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
        clearMonumentsHistoriques();
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

  // Ajouter handler du tableau détaillé (seulement si l'analyse est sauvegardée)
  if (data.id) {
    const detailedBtn = card.querySelector('.btn-detailed-table') as HTMLButtonElement;
    detailedBtn?.addEventListener('click', () => {
      showDetailedTableModal(data as SavedAnalysis);
    });
  }

  // Ajouter handler du téléchargement cadastre DXF
  const cadastreBtn = card.querySelector('.btn-download-cadastre') as HTMLButtonElement;
  cadastreBtn?.addEventListener('click', () => handleDownloadCadastre(data, cadastreBtn));

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

function escapeMhHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMonumentsSection(monuments: MonumentHistorique[] | null | undefined): string {
  // null = analyse legacy (avant la feature), on ne montre rien
  if (monuments == null) return '';

  if (monuments.length === 0) {
    return `
      <div class="mh-section">
        <h4>🏛️ Monuments Historiques</h4>
        <div class="mh-empty">Aucun MH dans un rayon de 500m. Pas de contrainte ABF à ce titre.</div>
      </div>
    `;
  }

  const top = monuments.slice(0, 5);
  const remaining = monuments.length - top.length;
  const items = top.map(m => {
    const proRef = m.reference
      ? ` <a href="https://pop.culture.gouv.fr/notice/merimee/${encodeURIComponent(m.reference)}" target="_blank" rel="noopener">↗</a>`
      : '';
    const protec = m.protection ? ` — ${escapeMhHtml(m.protection)}` : '';
    return `<li><strong>${escapeMhHtml(m.name)}</strong>${protec} <span class="mh-distance">(${m.distance_m} m)</span>${proRef}</li>`;
  }).join('');

  return `
    <div class="mh-section">
      <h4>🏛️ Monuments Historiques proches</h4>
      <div class="mh-badge-abf">⚠️ Périmètre ABF : ${monuments.length} MH dans 500m</div>
      <ul>${items}</ul>
      ${remaining > 0 ? `<div class="mh-distance" style="margin-top:6px;">+ ${remaining} autres (épingles sur la carte)</div>` : ''}
    </div>
  `;
}

// Fonction de partage
function handleShare(data: AnalysePLUResponse): void {
  const { parcelle, zonage, analyse } = data.data;

  // Créer le texte à partager
  const shareText = `📍 Analyse PLU - ${parcelle.commune}

Section ${parcelle.section} - N° ${parcelle.numero}
Surface: ${parcelle.surface} m²
Zone: ${zonage.libelle} (${zonage.type})

📋 ANALYSE COMPLÈTE:
${analyse.texte}

🔗 Plus d'infos: ${parcelle.url_geoportail}${zonage.url_document ? `\n📄 Document PLU: ${zonage.url_document}` : ''}`;

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

async function handleDownloadCadastre(data: AnalysePLUResponse, btn: HTMLButtonElement): Promise<void> {
  const codes = parseCadastreCodes(data.data.parcelle.url_geoportail);
  if (!codes) {
    alert('Impossible d\'identifier le code parcelle depuis l\'analyse. Téléchargement impossible.');
    return;
  }

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Téléchargement…';

  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/download-cadastre`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(codes),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(errJson.error || `Erreur ${response.status}`);
    }

    const feuillesCount = response.headers.get('X-Feuilles-Count') || '?';
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cadastre-${codes.insee}-${codes.section}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    btn.textContent = `✅ ${feuillesCount} feuille(s)`;
    setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2000);
  } catch (err) {
    console.error('Erreur téléchargement cadastre:', err);
    alert(`Erreur : ${(err as Error).message}`);
    btn.textContent = originalText;
    btn.disabled = false;
  }
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
