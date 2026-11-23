// Module principal - Gestion des Chantiers

import './styles.css';
import { createChantier, updateChantier, getChantiers, getChantier, deleteChantier, countArticlesByChantier, Chantier, NewChantier } from './database';
import { populateDepartmentSelect } from '../departments';
import { requirePermission, AppProfile } from '../auth/session';
import { initEventsUI, loadEventsFor } from './events-ui';
import { listOciDossiers, linkedOciIds, importOciDossier, formatSyncAge, prettyCity, searchKey, OciDossier } from '../oci';

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
  if (!userPerms.canCreate) {
    (elements.btnNewChantier as HTMLElement).hidden = true;
    (elements.btnImportErp as HTMLElement).hidden = true;
  }
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
  btnImportErp: document.getElementById('btn-import-erp')!,

  // Import ERP
  erpModal: document.getElementById('erp-modal')!,
  erpModalClose: document.getElementById('erp-modal-close')!,
  erpSearch: document.getElementById('erp-search') as HTMLInputElement,
  erpList: document.getElementById('erp-list')!,
  erpSyncAge: document.getElementById('erp-sync-age')!,
  erpPhaseBtns: document.querySelectorAll<HTMLButtonElement>('#erp-modal [data-phase]'),
  formErpNote: document.getElementById('form-erp-note')!,
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
  detailErpField: document.getElementById('detail-erp-field')!,
  detailErp: document.getElementById('detail-erp')!,
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

function typeLabel(c: Chantier): string {
  return c.project_type ? (PROJECT_TYPE_LABELS[c.project_type] || c.project_type) : 'À préciser';
}

function sectorLabel(c: Chantier): string {
  return c.client_sector ? (SECTOR_LABELS[c.client_sector] || c.client_sector) : 'à préciser';
}

function erpChip(c: Chantier): string {
  if (!c.oci) return '';
  const phase = c.oci.phase ? ` · ${escapeHtml(c.oci.phase)}` : '';
  return `<span class="erp-chip" title="Importé de l'ERP Batipro">${escapeHtml(c.oci.num_dossier)}${phase}</span>`;
}

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
        ${userPerms.canCreate ? `<div class="empty-actions">
          <button class="btn-secondary btn-small" id="empty-import-btn">Importer de l'ERP</button>
          <button class="btn-secondary btn-small" id="empty-new-btn">Créer un chantier</button>
        </div>` : ''}
      </div>
    `;
    document.getElementById('empty-new-btn')?.addEventListener('click', () => openModal());
    document.getElementById('empty-import-btn')?.addEventListener('click', () => openErpModal());
    return;
  }

  elements.chantiersList.innerHTML = state.chantiers.map(chantier => {
    const articleCount = state.articleCounts[chantier.id] || 0;
    return `
    <div class="chantier-card" data-id="${escapeHtml(chantier.id)}">
      <div class="chantier-card-header">
        <h3>${escapeHtml(chantier.name)}</h3>
        <div class="chantier-card-badges">
          ${erpChip(chantier)}
          <span class="status-badge ${STATUS_CLASSES[chantier.status]}">${STATUS_LABELS[chantier.status]}</span>
        </div>
      </div>
      <div class="chantier-card-body">
        ${chantier.client_name ? `<div class="chantier-meta"><span class="meta-label">Client</span> ${escapeHtml(chantier.client_name)}</div>` : ''}
        <div class="chantier-meta"><span class="meta-label">Lieu</span> ${escapeHtml(chantier.city || '—')}${chantier.department ? ` (${escapeHtml(chantier.department)})` : ''}</div>
        <div class="chantier-meta"><span class="meta-label">Type</span> <span class="${chantier.project_type ? '' : 'to-specify'}">${escapeHtml(typeLabel(chantier))}</span></div>
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
    elements.detailErpField.hidden = !chantier.oci;
    if (chantier.oci) {
      elements.detailErp.textContent = `${chantier.oci.num_dossier}${chantier.oci.phase ? ' — phase ' + chantier.oci.phase : ''}`;
    }
    elements.detailLocation.textContent = `${chantier.city || '—'}${chantier.department ? ` (${chantier.department})` : ''}${chantier.address ? ' — ' + chantier.address : ''}`;
    elements.detailType.textContent = `${typeLabel(chantier)} — ${sectorLabel(chantier)}`;
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
function openModal(chantier?: Chantier, opts: { justImported?: boolean } = {}) {
  elements.modalTitle.textContent = opts.justImported ? 'Compléter le projet importé' : chantier ? 'Modifier le chantier' : 'Nouveau chantier';
  elements.formErpNote.hidden = !chantier?.oci;
  if (chantier?.oci) {
    elements.formErpNote.textContent = opts.justImported
      ? `Repris de l'ERP (${chantier.oci.num_dossier}). Précisez le secteur et le type : ils guident la rédaction des articles.`
      : `Lié au dossier ERP ${chantier.oci.num_dossier}. Les modifications faites ici ne changent pas l'ERP.`;
  }
  elements.formId.value = chantier?.id || '';
  elements.formName.value = chantier?.name || '';
  elements.formClientName.value = chantier?.client_name || '';
  // Création manuelle : valeurs par défaut historiques ; chantier existant : « À préciser » si vide.
  elements.formClientSector.value = chantier ? (chantier.client_sector || '') : 'industriel';
  elements.formProjectType.value = chantier ? (chantier.project_type || '') : 'construction';
  elements.formAddress.value = chantier?.address || '';
  elements.formCity.value = chantier?.city || '';
  elements.formDepartment.value = chantier?.department || '25';
  elements.formSurface.value = chantier?.surface?.toString() || '';
  elements.formDescription.value = chantier?.description || '';
  elements.formKeywords.value = chantier?.seo_keywords || '';
  elements.formStartDate.value = chantier?.start_date || '';
  elements.modal.hidden = false;
  if (opts.justImported) elements.formClientSector.focus();
}

function closeModal() {
  elements.modal.hidden = true;
}

async function handleSaveChantier(e: Event) {
  e.preventDefault();

  const chantierData: NewChantier = {
    name: elements.formName.value.trim(),
    client_name: elements.formClientName.value.trim() || null,
    client_sector: elements.formClientSector.value || null,
    project_type: elements.formProjectType.value || null,
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

// --- IMPORT ERP (OCI) ---
const erpState = {
  dossiers: [] as OciDossier[],
  linked: new Map<string, string>(),  // id ERP → id chantier
  phase: 'Projet',
  importing: null as string | null,
};

async function openErpModal() {
  elements.erpModal.hidden = false;
  elements.erpSearch.value = '';
  elements.erpList.innerHTML = `<p class="erp-empty">Chargement des dossiers de l'ERP…</p>`;
  elements.erpSearch.focus();
  try {
    const [dossiers, linked] = await Promise.all([listOciDossiers(['Projet', 'Chantier']), linkedOciIds()]);
    erpState.dossiers = dossiers;
    erpState.linked = linked;
    const age = formatSyncAge(dossiers);
    elements.erpSyncAge.textContent = age ? `Données ERP mises à jour ${age}.` : '';
    document.querySelectorAll<HTMLElement>('#erp-modal [data-count]').forEach(el => {
      el.textContent = String(dossiers.filter(d => d.phase === el.dataset.count).length);
    });
    renderErpList();
  } catch (error) {
    console.error('Erreur chargement ERP:', error);
    elements.erpList.innerHTML = `<p class="erp-empty error">Impossible de charger les dossiers de l'ERP.</p>`;
  }
}

function closeErpModal() {
  elements.erpModal.hidden = true;
}

function renderErpList() {
  if (erpState.dossiers.length === 0) {
    elements.erpList.innerHTML = `<p class="erp-empty">Aucun dossier ERP disponible pour l'instant. La synchronisation avec l'ERP n'a pas encore tourné, réessayez dans une demi-heure.</p>`;
    return;
  }
  const q = searchKey(elements.erpSearch.value);
  const rows = erpState.dossiers.filter(d =>
    d.phase === erpState.phase && (!q || searchKey(d.nom, d.client_nom, d.ville, d.num_dossier, d.code_postal).includes(q))
  );
  if (rows.length === 0) {
    elements.erpList.innerHTML = `<p class="erp-empty">Aucun ${erpState.phase === 'Projet' ? 'projet' : 'chantier'} ne correspond à « ${escapeHtml(elements.erpSearch.value)} ».</p>`;
    return;
  }
  elements.erpList.innerHTML = rows.map(d => {
    const chantierId = erpState.linked.get(d.id);
    const place = [prettyCity(d.ville), d.code_postal].filter(Boolean).join(' ');
    const updated = d.erp_updated_at ? new Date(d.erp_updated_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
    const action = chantierId
      ? `<button type="button" class="erp-open" data-open="${escapeHtml(chantierId)}">Déjà importé · Ouvrir</button>`
      : `<button type="button" class="erp-import" data-import="${escapeHtml(d.id)}">Importer</button>`;
    return `
      <div class="erp-row${chantierId ? ' is-linked' : ''}">
        <div class="erp-row-main">
          <div class="erp-row-title"><span class="erp-num">${escapeHtml(d.num_dossier)}</span> ${escapeHtml(d.nom)}</div>
          <div class="erp-row-meta">${escapeHtml(place || 'Lieu non renseigné')}${d.responsable ? ` · ${escapeHtml(d.responsable)}` : ''}${updated ? ` · modifié le ${updated}` : ''}</div>
        </div>
        ${action}
      </div>`;
  }).join('');
}

async function handleErpImport(ociId: string, btn: HTMLButtonElement) {
  if (erpState.importing) return;
  erpState.importing = ociId;
  btn.disabled = true;
  btn.textContent = 'Import…';
  try {
    const { id, name } = await importOciDossier(ociId);
    erpState.linked.set(ociId, id);
    closeErpModal();
    showToast(`« ${name} » ajouté à la gestion chantier`, 'success');
    await loadChantiers();
    await showChantierDetail(id);
    if (userPerms.canEdit && state.currentChantier) openModal(state.currentChantier, { justImported: true });
  } catch (error) {
    console.error('Erreur import ERP:', error);
    showToast(`Import impossible : ${(error as Error).message}`, 'error');
    btn.disabled = false;
    btn.textContent = 'Importer';
  } finally {
    erpState.importing = null;
  }
}

function initErpModal() {
  elements.btnImportErp.addEventListener('click', openErpModal);
  elements.erpModalClose.addEventListener('click', closeErpModal);
  elements.erpModal.addEventListener('click', (e) => {
    if (e.target === elements.erpModal) closeErpModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !elements.erpModal.hidden) closeErpModal();
  });
  elements.erpSearch.addEventListener('input', renderErpList);
  elements.erpPhaseBtns.forEach(btn => btn.addEventListener('click', () => {
    elements.erpPhaseBtns.forEach(b => b.classList.toggle('active', b === btn));
    erpState.phase = btn.dataset.phase || 'Projet';
    renderErpList();
  }));
  elements.erpList.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!target) return;
    if (target.dataset.import) handleErpImport(target.dataset.import, target);
    else if (target.dataset.open) { closeErpModal(); showChantierDetail(target.dataset.open); }
  });
}

// --- INIT ---
async function init() {
  console.log('🏗️ Informations Chantier - Initialisation...');

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
  initErpModal();

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

  console.log('🏗️ Informations Chantier - Prêt');
}

document.addEventListener('DOMContentLoaded', init);
