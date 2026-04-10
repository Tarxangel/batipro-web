// Module principal - Gestion des Chantiers

import './styles.css';
import { createChantier, updateChantier, getChantiers, getChantier, deleteChantier, countArticlesByChantier, Chantier, NewChantier } from './database';
import { populateDepartmentSelect } from '../departments';
import { requirePermission, AppProfile } from '../auth/session';
import { initEventsUI, loadEventsFor } from './events-ui';

// Permissions de l'utilisateur courant (rempli au démarrage)
let userPerms = { canCreate: false, canEdit: false, canDelete: false };

function computePerms(profile: AppProfile) {
  const ch = profile.permissions?.chantiers || [];
  const isAdmin = profile.is_admin;
  return {
    canCreate: isAdmin || ch.includes('create'),
    canEdit:   isAdmin || ch.includes('edit'),
    canDelete: isAdmin || ch.includes('delete'),
  };
}

function applyPermissionGating() {
  if (!userPerms.canCreate) (elements.btnNewChantier as HTMLElement).hidden = true;
  if (!userPerms.canEdit) {
    (elements.btnEditChantier as HTMLElement).hidden = true;
    (elements.btnChangeStatus as HTMLElement).hidden = true;
  }
  if (!userPerms.canDelete) (elements.btnDeleteChantier as HTMLElement).hidden = true;
}

// État de l'application
interface AppState {
  chantiers: Chantier[];
  currentChantier: Chantier | null;
  currentView: 'list' | 'detail';
  statusFilter: string;
  articleCounts: Record<string, number>;
}

const state: AppState = {
  chantiers: [],
  currentChantier: null,
  currentView: 'list',
  statusFilter: 'active',
  articleCounts: {}
};

// Éléments DOM
const elements = {
  viewList: document.getElementById('view-list')!,
  viewDetail: document.getElementById('view-detail')!,
  chantiersList: document.getElementById('chantiers-list')!,
  chantiersCount: document.getElementById('chantiers-count')!,
  btnNewChantier: document.getElementById('btn-new-chantier')!,
  filterBtns: document.querySelectorAll('.filter-btn'),

  // Modal
  modal: document.getElementById('chantier-modal')!,
  modalTitle: document.getElementById('modal-title')!,
  modalClose: document.getElementById('modal-close')!,
  chantierForm: document.getElementById('chantier-form') as HTMLFormElement,
  formId: document.getElementById('form-id') as HTMLInputElement,
  formName: document.getElementById('form-name') as HTMLInputElement,
  formClientName: document.getElementById('form-client-name') as HTMLInputElement,
  formClientSector: document.getElementById('form-client-sector') as HTMLSelectElement,
  formProjectType: document.getElementById('form-project-type') as HTMLSelectElement,
  formAddress: document.getElementById('form-address') as HTMLInputElement,
  formCity: document.getElementById('form-city') as HTMLInputElement,
  formDepartment: document.getElementById('form-department') as HTMLSelectElement,
  formSurface: document.getElementById('form-surface') as HTMLInputElement,
  formDescription: document.getElementById('form-description') as HTMLTextAreaElement,
  formKeywords: document.getElementById('form-keywords') as HTMLInputElement,
  formStartDate: document.getElementById('form-start-date') as HTMLInputElement,
  btnSaveChantier: document.getElementById('btn-save-chantier')!,

  // Detail view
  detailName: document.getElementById('detail-name')!,
  detailStatus: document.getElementById('detail-status')!,
  detailClient: document.getElementById('detail-client')!,
  detailLocation: document.getElementById('detail-location')!,
  detailType: document.getElementById('detail-type')!,
  detailSurface: document.getElementById('detail-surface')!,
  detailDescription: document.getElementById('detail-description')!,
  detailArticleCount: document.getElementById('detail-article-count')!,
  detailArticlesList: document.getElementById('detail-articles-list')!,
  btnBackList: document.getElementById('btn-back-list')!,
  btnEditChantier: document.getElementById('btn-edit-chantier')!,
  btnDeleteChantier: document.getElementById('btn-delete-chantier')!,
  btnNewArticle: document.getElementById('btn-new-article')!,
  btnChangeStatus: document.getElementById('btn-change-status')!,

  // Confirm modal
  confirmModal: document.getElementById('confirm-modal')!,
  confirmTitle: document.getElementById('confirm-title')!,
  confirmMessage: document.getElementById('confirm-message')!,
  confirmCancel: document.getElementById('confirm-cancel')!,
  confirmOk: document.getElementById('confirm-ok')!,

  // Toast
  toastContainer: document.getElementById('toast-container')!
};

// --- TOAST ---
function showToast(message: string, type: 'success' | 'error' | 'info' = 'info', duration = 4000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    toast.addEventListener('transitionend', () => toast.remove());
  }, duration);
}

// --- CONFIRM MODAL ---
function showConfirm(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    elements.confirmTitle.textContent = title;
    elements.confirmMessage.textContent = message;
    elements.confirmModal.hidden = false;

    const cleanup = () => {
      elements.confirmModal.hidden = true;
      elements.confirmCancel.removeEventListener('click', onCancel);
      elements.confirmOk.removeEventListener('click', onOk);
    };

    const onCancel = () => { cleanup(); resolve(false); };
    const onOk = () => { cleanup(); resolve(true); };

    elements.confirmCancel.addEventListener('click', onCancel);
    elements.confirmOk.addEventListener('click', onOk);
  });
}

// --- HELPERS ---
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  paused: 'En pause',
  completed: 'Terminé'
};

const STATUS_CLASSES: Record<string, string> = {
  active: 'status-active',
  paused: 'status-paused',
  completed: 'status-completed'
};

const SECTOR_LABELS: Record<string, string> = {
  industriel: 'Industriel / Production',
  logistique: 'Logistique / Stockage',
  agroalimentaire: 'Agroalimentaire',
  medical: 'Médical / Pharmaceutique',
  tertiaire: 'Tertiaire / Bureaux',
  commercial: 'Commercial / Commerce',
  defense: 'Défense / Armement',
  autre: 'Autre'
};

const PROJECT_TYPE_LABELS: Record<string, string> = {
  construction: 'Construction neuve',
  extension: 'Extension',
  renovation: 'Rénovation',
  restructuration: 'Restructuration'
};

// --- VIEWS ---
function showView(view: 'list' | 'detail') {
  state.currentView = view;
  elements.viewList.classList.toggle('active', view === 'list');
  elements.viewDetail.classList.toggle('active', view === 'detail');
}

// --- LOAD CHANTIERS ---
async function loadChantiers() {
  try {
    state.chantiers = await getChantiers(state.statusFilter);

    // Charger les compteurs d'articles en parallèle
    const counts = await Promise.all(
      state.chantiers.map(c => countArticlesByChantier(c.id).then(count => ({ id: c.id, count })))
    );
    state.articleCounts = {};
    counts.forEach(({ id, count }) => { state.articleCounts[id] = count; });

    renderChantiersList();
  } catch (error) {
    console.error('Erreur chargement chantiers:', error);
    showToast('Erreur lors du chargement des chantiers', 'error');
  }
}

// --- RENDER LIST ---
function renderChantiersList() {
  elements.chantiersCount.textContent = state.chantiers.length.toString();

  if (state.chantiers.length === 0) {
    elements.chantiersList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏗️</div>
        <p>Aucun chantier ${state.statusFilter === 'active' ? 'actif' : state.statusFilter === 'completed' ? 'terminé' : ''}</p>
        <button class="btn-secondary btn-small" id="empty-new-btn">Créer un chantier</button>
      </div>
    `;
    document.getElementById('empty-new-btn')?.addEventListener('click', () => openModal());
    return;
  }

  elements.chantiersList.innerHTML = state.chantiers.map(chantier => {
    const articleCount = state.articleCounts[chantier.id] || 0;
    return `
    <div class="chantier-card" data-id="${escapeHtml(chantier.id)}">
      <div class="chantier-card-header">
        <h3>${escapeHtml(chantier.name)}</h3>
        <span class="status-badge ${STATUS_CLASSES[chantier.status]}">${STATUS_LABELS[chantier.status]}</span>
      </div>
      <div class="chantier-card-body">
        ${chantier.client_name ? `<div class="chantier-meta"><span class="meta-label">Client</span> ${escapeHtml(chantier.client_name)}</div>` : ''}
        <div class="chantier-meta"><span class="meta-label">Lieu</span> ${escapeHtml(chantier.city)} (${escapeHtml(chantier.department)})</div>
        <div class="chantier-meta"><span class="meta-label">Type</span> ${PROJECT_TYPE_LABELS[chantier.project_type] || chantier.project_type}</div>
        ${chantier.surface ? `<div class="chantier-meta"><span class="meta-label">Surface</span> ${chantier.surface.toLocaleString('fr-FR')} m²</div>` : ''}
      </div>
      <div class="chantier-card-footer">
        <span class="article-count">${articleCount} article${articleCount !== 1 ? 's' : ''}</span>
        <span class="last-update">${formatDate(chantier.updated_at)}</span>
      </div>
    </div>
  `}).join('');

  // Click handlers
  elements.chantiersList.querySelectorAll('.chantier-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-id')!;
      showChantierDetail(id);
    });
  });
}

// --- DETAIL VIEW ---
async function showChantierDetail(id: string) {
  try {
    const chantier = await getChantier(id);
    if (!chantier) {
      showToast('Chantier introuvable', 'error');
      return;
    }

    state.currentChantier = chantier;
    const articleCount = await countArticlesByChantier(id);

    elements.detailName.textContent = chantier.name;
    elements.detailStatus.className = `status-badge ${STATUS_CLASSES[chantier.status]}`;
    elements.detailStatus.textContent = STATUS_LABELS[chantier.status];
    elements.detailClient.textContent = chantier.client_name || 'Non renseigné';
    elements.detailLocation.textContent = `${chantier.city} (${chantier.department})${chantier.address ? ' — ' + chantier.address : ''}`;
    elements.detailType.textContent = `${PROJECT_TYPE_LABELS[chantier.project_type] || chantier.project_type} — ${SECTOR_LABELS[chantier.client_sector] || chantier.client_sector}`;
    elements.detailSurface.textContent = chantier.surface ? `${chantier.surface.toLocaleString('fr-FR')} m²` : 'Non renseigné';
    elements.detailDescription.textContent = chantier.description || 'Aucune description';
    elements.detailArticleCount.textContent = `${articleCount} article${articleCount !== 1 ? 's' : ''}`;

    // Update status button label
    if (chantier.status === 'active') {
      elements.btnChangeStatus.textContent = 'Marquer terminé';
    } else if (chantier.status === 'completed') {
      elements.btnChangeStatus.textContent = 'Réactiver';
    } else {
      elements.btnChangeStatus.textContent = 'Réactiver';
    }

    // Load articles for this chantier
    await loadChantierArticles(id);

    // Load events history for this chantier
    await loadEventsFor(id);

    showView('detail');
  } catch (error) {
    console.error('Erreur affichage détail:', error);
    showToast('Erreur lors du chargement', 'error');
  }
}

async function loadChantierArticles(chantierId: string) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import('../config');
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    const { data: articles, error } = await supabase
      .from('article_drafts')
      .select('id, title, status, created_at')
      .eq('chantier_id', chantierId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!articles || articles.length === 0) {
      elements.detailArticlesList.innerHTML = '<p class="no-articles">Aucun article pour ce chantier</p>';
      return;
    }

    elements.detailArticlesList.innerHTML = articles.map(article => {
      const statusLabel = article.status === 'published' ? 'Publié' : article.status === 'pending_review' ? 'En attente' : 'Brouillon';
      const statusClass = article.status === 'published' ? 'status-completed' : article.status === 'pending_review' ? 'status-paused' : 'status-active';
      return `
        <div class="article-item">
          <div class="article-item-info">
            <span class="article-item-title">${escapeHtml(article.title)}</span>
            <span class="article-item-date">${formatDate(article.created_at)}</span>
          </div>
          <span class="status-badge status-badge-small ${statusClass}">${statusLabel}</span>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Erreur chargement articles:', error);
    elements.detailArticlesList.innerHTML = '<p class="no-articles">Erreur de chargement</p>';
  }
}

// --- MODAL ---
function openModal(chantier?: Chantier) {
  elements.modalTitle.textContent = chantier ? 'Modifier le chantier' : 'Nouveau chantier';
  elements.formId.value = chantier?.id || '';
  elements.formName.value = chantier?.name || '';
  elements.formClientName.value = chantier?.client_name || '';
  elements.formClientSector.value = chantier?.client_sector || 'industriel';
  elements.formProjectType.value = chantier?.project_type || 'construction';
  elements.formAddress.value = chantier?.address || '';
  elements.formCity.value = chantier?.city || '';
  elements.formDepartment.value = chantier?.department || '25';
  elements.formSurface.value = chantier?.surface?.toString() || '';
  elements.formDescription.value = chantier?.description || '';
  elements.formKeywords.value = chantier?.seo_keywords || '';
  elements.formStartDate.value = chantier?.start_date || '';
  elements.modal.hidden = false;
}

function closeModal() {
  elements.modal.hidden = true;
}

async function handleSaveChantier(e: Event) {
  e.preventDefault();

  const chantierData: NewChantier = {
    name: elements.formName.value.trim(),
    client_name: elements.formClientName.value.trim() || null,
    client_sector: elements.formClientSector.value,
    project_type: elements.formProjectType.value,
    address: elements.formAddress.value.trim() || null,
    city: elements.formCity.value.trim(),
    department: elements.formDepartment.value,
    surface: elements.formSurface.value ? parseInt(elements.formSurface.value) : null,
    description: elements.formDescription.value.trim() || null,
    seo_keywords: elements.formKeywords.value.trim() || null,
    start_date: elements.formStartDate.value || null,
    end_date: null
  };

  if (!chantierData.name || !chantierData.city || !chantierData.department) {
    showToast('Veuillez remplir les champs obligatoires', 'error');
    return;
  }

  try {
    elements.btnSaveChantier.textContent = 'Enregistrement...';
    elements.btnSaveChantier.setAttribute('disabled', 'true');

    const editId = elements.formId.value;
    if (editId) {
      await updateChantier(editId, chantierData);
      showToast('Chantier mis à jour', 'success');
    } else {
      await createChantier(chantierData);
      showToast('Chantier créé', 'success');
    }

    closeModal();
    await loadChantiers();

    // Si on était en vue detail, refresh
    if (state.currentView === 'detail' && editId) {
      await showChantierDetail(editId);
    }
  } catch (error) {
    console.error('Erreur sauvegarde:', error);
    showToast('Erreur lors de la sauvegarde', 'error');
  } finally {
    elements.btnSaveChantier.textContent = 'Enregistrer';
    elements.btnSaveChantier.removeAttribute('disabled');
  }
}

async function handleDeleteChantier() {
  if (!state.currentChantier) return;

  const confirmed = await showConfirm('Suppression', `Supprimer le chantier "${state.currentChantier.name}" ? Les articles liés ne seront pas supprimés.`);
  if (!confirmed) return;

  try {
    await deleteChantier(state.currentChantier.id);
    showToast('Chantier supprimé', 'info');
    state.currentChantier = null;
    showView('list');
    await loadChantiers();
  } catch (error) {
    console.error('Erreur suppression:', error);
    showToast('Erreur lors de la suppression', 'error');
  }
}

async function handleChangeStatus() {
  if (!state.currentChantier) return;

  const newStatus = state.currentChantier.status === 'active' ? 'completed' : 'active';
  const label = newStatus === 'completed' ? 'terminer' : 'réactiver';

  const confirmed = await showConfirm('Changement de statut', `Voulez-vous ${label} ce chantier ?`);
  if (!confirmed) return;

  try {
    await updateChantier(state.currentChantier.id, { status: newStatus } as Partial<Chantier>);
    showToast(`Chantier ${newStatus === 'completed' ? 'terminé' : 'réactivé'}`, 'success');
    await showChantierDetail(state.currentChantier.id);
    await loadChantiers();
  } catch (error) {
    console.error('Erreur changement statut:', error);
    showToast('Erreur lors du changement de statut', 'error');
  }
}

// --- INIT ---
async function init() {
  console.log('🏗️ Gestion Chantiers - Initialisation...');

  // Page guard : redirige si non authentifié ou sans permission de lecture
  const profile = await requirePermission('chantiers', 'read', '/');
  if (!profile) return;
  userPerms = computePerms(profile);
  applyPermissionGating();

  // Initialisation de l'historique chantier (timeline + modale)
  initEventsUI(userPerms.canEdit);

  // Peupler le select des départements
  populateDepartmentSelect(elements.formDepartment, { defaultValue: '25' });

  // New chantier button
  elements.btnNewChantier.addEventListener('click', () => openModal());

  // Filter buttons
  elements.filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.statusFilter = btn.getAttribute('data-filter') || 'active';
      loadChantiers();
    });
  });

  // Modal
  elements.modalClose.addEventListener('click', closeModal);
  elements.modal.addEventListener('click', (e) => {
    if (e.target === elements.modal) closeModal();
  });
  elements.chantierForm.addEventListener('submit', handleSaveChantier);

  // Detail view
  elements.btnBackList.addEventListener('click', () => {
    showView('list');
    loadChantiers();
  });
  elements.btnEditChantier.addEventListener('click', () => {
    if (state.currentChantier) openModal(state.currentChantier);
  });
  elements.btnDeleteChantier.addEventListener('click', handleDeleteChantier);
  elements.btnNewArticle.addEventListener('click', () => {
    if (state.currentChantier) {
      window.location.href = `/articles.html?chantier_id=${state.currentChantier.id}`;
    }
  });
  elements.btnChangeStatus.addEventListener('click', handleChangeStatus);

  // Confirm modal
  elements.confirmModal.addEventListener('click', (e) => {
    if (e.target === elements.confirmModal) elements.confirmModal.hidden = true;
  });

  // Load initial data
  loadChantiers();

  console.log('🏗️ Gestion Chantiers - Prêt');
}

document.addEventListener('DOMContentLoaded', init);
