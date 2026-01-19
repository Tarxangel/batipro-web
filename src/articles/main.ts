// Module principal - Articles Chantier

import './styles.css';
import { generateArticle, fileToBase64, publishArticle } from './api';
import { createDraft, updateDraft, getDrafts, deleteDraft, markAsPublished, ArticleDraft } from './database';
import { N8N_ARTICLE_WEBHOOK } from './config';

// Déclaration Quill (chargé via CDN)
declare const Quill: any;

// État de l'application
interface AppState {
  currentStep: 'upload' | 'loading' | 'editor' | 'success';
  selectedFile: File | null;
  currentDraft: ArticleDraft | null;
  drafts: ArticleDraft[];
  quillEditor: any | null;
}

const state: AppState = {
  currentStep: 'upload',
  selectedFile: null,
  currentDraft: null,
  drafts: [],
  quillEditor: null
};

// Éléments DOM
const elements = {
  // Steps
  stepUpload: document.getElementById('step-upload')!,
  stepLoading: document.getElementById('step-loading')!,
  stepEditor: document.getElementById('step-editor')!,
  stepSuccess: document.getElementById('step-success')!,

  // Upload
  uploadZone: document.getElementById('upload-zone')!,
  photoInput: document.getElementById('photo-input') as HTMLInputElement,
  uploadPreview: document.getElementById('upload-preview')!,
  previewImage: document.getElementById('preview-image') as HTMLImageElement,
  removePhoto: document.getElementById('remove-photo')!,
  description: document.getElementById('description') as HTMLTextAreaElement,
  btnGenerate: document.getElementById('btn-generate') as HTMLButtonElement,

  // Loading
  loadingSteps: document.querySelectorAll('.loading-step'),

  // Editor
  editorImage: document.getElementById('editor-image') as HTMLImageElement,
  articleTitle: document.getElementById('article-title') as HTMLInputElement,
  articleContent: document.getElementById('article-content') as HTMLInputElement,
  quillEditor: document.getElementById('quill-editor')!,
  btnSaveDraft: document.getElementById('btn-save-draft')!,
  btnPublish: document.getElementById('btn-publish')!,

  // Success
  publishedUrl: document.getElementById('published-url') as HTMLAnchorElement,
  btnNewArticle: document.getElementById('btn-new-article')!,

  // Drafts
  draftsCount: document.getElementById('drafts-count')!,
  draftsList: document.getElementById('drafts-list')!
};

// Détecter si on est sur mobile
function isMobile(): boolean {
  return window.innerWidth <= 768 || 'ontouchstart' in window;
}

// Initialiser l'éditeur Quill
function initQuillEditor() {
  if (state.quillEditor) return;

  const mobile = isMobile();

  state.quillEditor = new Quill('#quill-editor', {
    theme: mobile ? 'bubble' : 'snow',
    placeholder: 'Contenu de l\'article...',
    modules: {
      toolbar: [
        [{ 'header': [2, 3, false] }],
        ['bold', 'italic', 'underline'],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        ['link'],
        ['clean']
      ]
    }
  });

  // Sync avec le champ hidden pour la sauvegarde
  state.quillEditor.on('text-change', () => {
    elements.articleContent.value = state.quillEditor.root.innerHTML;
  });
}

// Récupérer le contenu HTML de Quill
function getQuillContent(): string {
  if (!state.quillEditor) return '';
  return state.quillEditor.root.innerHTML;
}

// Définir le contenu HTML dans Quill
function setQuillContent(html: string) {
  if (!state.quillEditor) return;
  state.quillEditor.root.innerHTML = html;
  elements.articleContent.value = html;
}

// Navigation entre les étapes
function showStep(step: AppState['currentStep']) {
  state.currentStep = step;

  // Masquer toutes les étapes
  elements.stepUpload.classList.remove('active');
  elements.stepLoading.classList.remove('active');
  elements.stepEditor.classList.remove('active');
  elements.stepSuccess.classList.remove('active');

  // Afficher l'étape active
  switch (step) {
    case 'upload':
      elements.stepUpload.classList.add('active');
      break;
    case 'loading':
      elements.stepLoading.classList.add('active');
      break;
    case 'editor':
      elements.stepEditor.classList.add('active');
      // Initialiser Quill si pas encore fait
      setTimeout(() => initQuillEditor(), 100);
      break;
    case 'success':
      elements.stepSuccess.classList.add('active');
      break;
  }
}

// Mise à jour des étapes de chargement
function updateLoadingStep(stepName: string, status: 'pending' | 'active' | 'done' | 'error') {
  const stepEl = document.querySelector(`.loading-step[data-step="${stepName}"]`);
  if (!stepEl) return;

  stepEl.classList.remove('pending', 'active', 'done', 'error');
  stepEl.classList.add(status);

  const statusEl = stepEl.querySelector('.step-status');
  if (statusEl) {
    switch (status) {
      case 'pending':
        statusEl.textContent = 'En attente';
        break;
      case 'active':
        statusEl.textContent = 'En cours...';
        break;
      case 'done':
        statusEl.textContent = 'Terminé';
        break;
      case 'error':
        statusEl.textContent = 'Erreur';
        break;
    }
  }
}

// Gestion de l'upload de photo
function setupPhotoUpload() {
  // Clic sur la zone d'upload
  elements.uploadZone.addEventListener('click', () => {
    if (!state.selectedFile) {
      elements.photoInput.click();
    }
  });

  // Sélection de fichier
  elements.photoInput.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  });

  // Drag & Drop
  elements.uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.uploadZone.classList.add('dragover');
  });

  elements.uploadZone.addEventListener('dragleave', () => {
    elements.uploadZone.classList.remove('dragover');
  });

  elements.uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.uploadZone.classList.remove('dragover');
    const file = e.dataTransfer?.files[0];
    if (file && file.type.startsWith('image/')) {
      handleFileSelect(file);
    }
  });

  // Suppression de la photo
  elements.removePhoto.addEventListener('click', (e) => {
    e.stopPropagation();
    removeSelectedFile();
  });
}

function handleFileSelect(file: File) {
  state.selectedFile = file;

  // Afficher la preview
  const reader = new FileReader();
  reader.onload = (e) => {
    elements.previewImage.src = e.target?.result as string;
    elements.uploadPreview.hidden = false;
    elements.uploadZone.querySelector('.upload-placeholder')?.classList.add('hidden');
  };
  reader.readAsDataURL(file);

  updateGenerateButton();
}

function removeSelectedFile() {
  state.selectedFile = null;
  elements.photoInput.value = '';
  elements.uploadPreview.hidden = true;
  elements.uploadZone.querySelector('.upload-placeholder')?.classList.remove('hidden');
  updateGenerateButton();
}

function updateGenerateButton() {
  const hasPhoto = state.selectedFile !== null;
  const hasDescription = elements.description.value.trim().length > 0;
  elements.btnGenerate.disabled = !hasPhoto || !hasDescription;
}

// Génération de l'article
async function handleGenerate() {
  if (!state.selectedFile) return;

  showStep('loading');

  // Reset loading steps
  updateLoadingStep('upload', 'active');
  updateLoadingStep('ai', 'pending');
  updateLoadingStep('save', 'pending');

  try {
    // Convertir l'image en base64
    const photoBase64 = await fileToBase64(state.selectedFile);
    updateLoadingStep('upload', 'done');

    // Appeler n8n
    updateLoadingStep('ai', 'active');
    const result = await generateArticle({
      photo: photoBase64,
      description: elements.description.value.trim()
    });
    updateLoadingStep('ai', 'done');

    // Sauvegarder le brouillon
    updateLoadingStep('save', 'active');
    const draft = await createDraft({
      title: result.title,
      content: result.content,
      description: elements.description.value.trim(),
      image_url: result.image_url,
      wp_media_id: result.wp_media_id,
      wp_post_id: result.wp_post_id ?? null
    });
    updateLoadingStep('save', 'done');

    // Passer à l'éditeur
    state.currentDraft = draft;
    showEditor(draft);

  } catch (error) {
    console.error('❌ Erreur génération:', error);

    // Marquer l'étape en erreur
    const currentActive = document.querySelector('.loading-step.active');
    if (currentActive) {
      const stepName = currentActive.getAttribute('data-step') || '';
      updateLoadingStep(stepName, 'error');
    }

    // Afficher l'erreur et retourner à l'upload
    alert(`Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    setTimeout(() => showStep('upload'), 2000);
  }
}

// Afficher l'éditeur
function showEditor(draft: ArticleDraft) {
  elements.editorImage.src = draft.image_url || '';
  elements.articleTitle.value = draft.title;

  showStep('editor');

  // Charger le contenu dans Quill après un délai pour s'assurer qu'il est initialisé
  setTimeout(() => {
    setQuillContent(draft.content);
  }, 200);

  loadDrafts(); // Refresh drafts list
}

// Sauvegarder le brouillon
async function handleSaveDraft() {
  if (!state.currentDraft) return;

  try {
    elements.btnSaveDraft.textContent = '💾 Sauvegarde...';
    elements.btnSaveDraft.setAttribute('disabled', 'true');

    const content = getQuillContent();

    await updateDraft(state.currentDraft.id, {
      title: elements.articleTitle.value,
      content: content
    });

    state.currentDraft.title = elements.articleTitle.value;
    state.currentDraft.content = content;

    elements.btnSaveDraft.textContent = '✅ Sauvegardé !';
    setTimeout(() => {
      elements.btnSaveDraft.textContent = '💾 Sauvegarder';
      elements.btnSaveDraft.removeAttribute('disabled');
    }, 2000);

    loadDrafts();

  } catch (error) {
    console.error('❌ Erreur sauvegarde:', error);
    alert('Erreur lors de la sauvegarde');
    elements.btnSaveDraft.textContent = '💾 Sauvegarder';
    elements.btnSaveDraft.removeAttribute('disabled');
  }
}

// Publier l'article via n8n
async function handlePublish() {
  if (!state.currentDraft) return;

  // Vérifier qu'on a un wp_post_id (brouillon WP créé)
  if (!state.currentDraft.wp_post_id) {
    alert('Erreur: Pas de brouillon WordPress associé. Régénérez l\'article.');
    return;
  }

  const confirmed = confirm('Publier cet article sur le site ?');
  if (!confirmed) return;

  try {
    elements.btnPublish.textContent = '🚀 Publication...';
    elements.btnPublish.setAttribute('disabled', 'true');

    // Récupérer le contenu actuel de l'éditeur
    const currentTitle = elements.articleTitle.value;
    const currentContent = getQuillContent();

    // Publier via n8n avec les modifications
    const result = await publishArticle(
      state.currentDraft.wp_post_id,
      currentTitle,
      currentContent
    );

    // Marquer comme publié dans Supabase
    await markAsPublished(state.currentDraft.id, result.id, result.link);

    elements.publishedUrl.href = result.link;
    elements.publishedUrl.textContent = 'Voir l\'article →';

    showStep('success');
    loadDrafts();

  } catch (error) {
    console.error('❌ Erreur publication:', error);
    alert(`Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
    elements.btnPublish.textContent = '🚀 Publier sur le site';
    elements.btnPublish.removeAttribute('disabled');
  }
}

// Nouvel article
function handleNewArticle() {
  state.selectedFile = null;
  state.currentDraft = null;

  // Reset form
  elements.photoInput.value = '';
  elements.uploadPreview.hidden = true;
  elements.uploadZone.querySelector('.upload-placeholder')?.classList.remove('hidden');
  elements.description.value = '';
  elements.btnGenerate.disabled = true;

  // Reset loading steps
  elements.loadingSteps.forEach(step => {
    step.classList.remove('active', 'done', 'error');
    const statusEl = step.querySelector('.step-status');
    if (statusEl) statusEl.textContent = 'En attente';
  });

  // Reset editor
  elements.btnPublish.textContent = '🚀 Publier sur le site';
  elements.btnPublish.removeAttribute('disabled');

  // Vider Quill
  if (state.quillEditor) {
    state.quillEditor.root.innerHTML = '';
  }

  showStep('upload');
}

// Charger les brouillons
async function loadDrafts() {
  try {
    state.drafts = await getDrafts();
    renderDrafts();
  } catch (error) {
    console.error('❌ Erreur chargement brouillons:', error);
  }
}

// Afficher les brouillons
function renderDrafts() {
  elements.draftsCount.textContent = state.drafts.length.toString();

  if (state.drafts.length === 0) {
    elements.draftsList.innerHTML = `
      <div class="drafts-empty">
        <p>Aucun brouillon</p>
      </div>
    `;
    return;
  }

  elements.draftsList.innerHTML = state.drafts.map(draft => `
    <div class="draft-item" data-id="${draft.id}">
      <div class="draft-image">
        ${draft.image_url ? `<img src="${draft.image_url}" alt="" />` : '<div class="no-image">📷</div>'}
      </div>
      <div class="draft-info">
        <h3>${escapeHtml(draft.title)}</h3>
        <span class="draft-date">${formatDate(draft.created_at)}</span>
      </div>
      <div class="draft-actions">
        <button class="draft-edit" title="Éditer">✏️</button>
        <button class="draft-delete" title="Supprimer">🗑️</button>
      </div>
    </div>
  `).join('');

  // Event listeners
  elements.draftsList.querySelectorAll('.draft-item').forEach(item => {
    const id = item.getAttribute('data-id')!;

    item.querySelector('.draft-edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      editDraft(id);
    });

    item.querySelector('.draft-delete')?.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteDraft(id);
    });

    item.addEventListener('click', () => editDraft(id));
  });
}

// Éditer un brouillon
function editDraft(id: string) {
  const draft = state.drafts.find(d => d.id === id);
  if (!draft) return;

  state.currentDraft = draft;
  showEditor(draft);
}

// Supprimer un brouillon
async function handleDeleteDraft(id: string) {
  if (!confirm('Supprimer ce brouillon ?')) return;

  try {
    await deleteDraft(id);
    loadDrafts();

    // Si c'était le brouillon actuel, retourner à l'upload
    if (state.currentDraft?.id === id) {
      handleNewArticle();
    }
  } catch (error) {
    console.error('❌ Erreur suppression:', error);
    alert('Erreur lors de la suppression');
  }
}

// Helpers
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Initialisation
function init() {
  console.log('📝 Articles Chantier - Initialisation...');

  // Setup event listeners
  setupPhotoUpload();

  elements.description.addEventListener('input', updateGenerateButton);
  elements.btnGenerate.addEventListener('click', handleGenerate);
  elements.btnSaveDraft.addEventListener('click', handleSaveDraft);
  elements.btnPublish.addEventListener('click', handlePublish);
  elements.btnNewArticle.addEventListener('click', handleNewArticle);

  // Charger les brouillons existants
  loadDrafts();

  console.log('📝 Articles Chantier - Prêt ✅');
  console.log(`📡 Webhook n8n: ${N8N_ARTICLE_WEBHOOK}`);
}

// Démarrer
document.addEventListener('DOMContentLoaded', init);
