// Module principal - Articles Chantier

import './styles.css';
import { generateArticle, fileToBase64, publishArticle, compressImage, convertHeicToJpeg, summarizeHistory, generateLinkedInPost, notifyReview, SeoContext } from './api';
import { createDraft, updateDraft, getDrafts, getDraftsByChantier, deleteDraft, markAsPublished, ArticleDraft } from './database';
import { getChantiers, getChantier, Chantier } from '../chantiers/database';
import { MAX_IMAGE_SIZE, WP_SITE_URL } from './config';
import { requirePermission, logout, AppProfile } from '../auth/session';
import { populateDepartmentSelect } from '../departments';
import { sendChat, ChatMessage, ChatDraft } from './chat-api';

// Permissions de l'utilisateur courant (rempli au démarrage)
let userPerms = {
  canCreate: false,
  canEdit: false,
  canPublish: false,
  canDelete: false,
};

function computePerms(profile: AppProfile) {
  const a = profile.permissions?.articles || [];
  const isAdmin = profile.is_admin;
  return {
    canCreate:  isAdmin || a.includes('create'),
    canEdit:    isAdmin || a.includes('edit'),
    canPublish: isAdmin || a.includes('publish'),
    canDelete:  isAdmin || a.includes('delete'),
  };
}

// Déclaration Quill (chargé via CDN)
declare const Quill: any;

// État de l'application
interface AppState {
  currentStep: 'upload' | 'loading' | 'chat' | 'editor' | 'success';
  selectedFile: File | null;
  currentDraft: ArticleDraft | null;
  drafts: ArticleDraft[];
  quillEditor: any | null;
  selectedChantier: Chantier | null;
  // ── Chat IA ──
  chatMessages: ChatMessage[];
  chatDraft: ChatDraft | null;
  chatPhotoBase64: string | null;
  chatPhotoMime: string | null;
  chatPhotoUrl: string | null;     // pour l'affichage local (data url)
  chatBusy: boolean;
}

const state: AppState = {
  currentStep: 'upload',
  selectedFile: null,
  currentDraft: null,
  drafts: [],
  quillEditor: null,
  selectedChantier: null,
  chatMessages: [],
  chatDraft: null,
  chatPhotoBase64: null,
  chatPhotoMime: null,
  chatPhotoUrl: null,
  chatBusy: false,
};

// Éléments DOM
const elements = {
  // Steps
  stepUpload: document.getElementById('step-upload')!,
  stepLoading: document.getElementById('step-loading')!,
  stepChat: document.getElementById('step-chat')!,
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
  btnStartChat: document.getElementById('btn-start-chat') as HTMLButtonElement,
  btnToggleFallback: document.getElementById('btn-toggle-fallback') as HTMLButtonElement,
  fallbackFields: document.getElementById('fallback-fields')!,

  // Chat
  chatChantierName: document.getElementById('chat-chantier-name')!,
  chatPhotoImg: document.getElementById('chat-photo-img') as HTMLImageElement,
  chatMessages: document.getElementById('chat-messages')!,
  chatInput: document.getElementById('chat-input') as HTMLTextAreaElement,
  chatSend: document.getElementById('chat-send') as HTMLButtonElement,
  chatRequestDraft: document.getElementById('chat-request-draft') as HTMLButtonElement,
  chatValidate: document.getElementById('chat-validate') as HTMLButtonElement,
  chatError: document.getElementById('chat-error')!,
  btnBackChat: document.getElementById('btn-back-chat') as HTMLButtonElement,

  // Loading
  loadingSteps: document.querySelectorAll('.loading-step'),

  // Editor
  editorImage: document.getElementById('editor-image') as HTMLImageElement,
  articleTitle: document.getElementById('article-title') as HTMLInputElement,
  articleContent: document.getElementById('article-content') as HTMLInputElement,
  quillEditor: document.getElementById('quill-editor')!,
  btnSaveDraft: document.getElementById('btn-save-draft')!,
  btnSubmitReview: document.getElementById('btn-submit-review')!,
  btnPublish: document.getElementById('btn-publish')!,

  // Success
  publishedUrl: document.getElementById('published-url') as HTMLAnchorElement,
  btnNewArticle: document.getElementById('btn-new-article')!,

  // LinkedIn
  linkedinSection: document.getElementById('linkedin-section')!,
  linkedinLoading: document.getElementById('linkedin-loading')!,
  linkedinContent: document.getElementById('linkedin-content')!,
  linkedinError: document.getElementById('linkedin-error')!,
  linkedinPost: document.getElementById('linkedin-post') as HTMLTextAreaElement,
  btnCopyLinkedin: document.getElementById('btn-copy-linkedin')!,
  btnShareLinkedin: document.getElementById('btn-share-linkedin') as HTMLAnchorElement,

  // Drafts
  draftsCount: document.getElementById('drafts-count')!,
  draftsList: document.getElementById('drafts-list')!,

  // Logout
  btnLogout: document.getElementById('btn-logout') as HTMLButtonElement | null,

  // Confirm modal
  confirmModal: document.getElementById('confirm-modal')!,
  confirmTitle: document.getElementById('confirm-title')!,
  confirmMessage: document.getElementById('confirm-message')!,
  confirmCancel: document.getElementById('confirm-cancel')!,
  confirmOk: document.getElementById('confirm-ok')!,

  // Toast
  toastContainer: document.getElementById('toast-container')!,

  // Chantier selector
  chantierSelect: document.getElementById('chantier-select') as HTMLSelectElement,
  chantierBadge: document.getElementById('chantier-badge')!,

  // SEO fields
  seoArticleType: document.getElementById('seo-article-type') as HTMLSelectElement,
  seoProjectType: document.getElementById('seo-project-type') as HTMLSelectElement,
  seoSector: document.getElementById('seo-sector') as HTMLSelectElement,
  seoCity: document.getElementById('seo-city') as HTMLInputElement,
  seoDepartment: document.getElementById('seo-department') as HTMLSelectElement,
  seoSurface: document.getElementById('seo-surface') as HTMLInputElement,
  seoKeywords: document.getElementById('seo-keywords') as HTMLInputElement
};

// --- TOAST NOTIFICATIONS ---

function showToast(message: string, type: 'success' | 'error' | 'info' = 'info', duration = 4000) {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  elements.toastContainer.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('visible'));

  setTimeout(() => {
    toast.classList.remove('visible');
    toast.addEventListener('transitionend', () => toast.remove());
  }, duration);
}

// --- CONFIRM MODAL (remplacement de confirm()) ---

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

// --- PERMISSIONS UI GATING ---

function applyPermissionGating() {
  // Bouton "Publier" : visible uniquement si canPublish
  if (elements.btnPublish) {
    elements.btnPublish.hidden = !userPerms.canPublish;
  }
  // Bouton "Soumettre pour validation" : visible uniquement si l'utilisateur peut
  // créer/éditer mais PAS publier (les publishers vont directement à publish)
  if (elements.btnSubmitReview) {
    elements.btnSubmitReview.hidden = userPerms.canPublish || !userPerms.canCreate;
  }
  // Bouton "Sauvegarder brouillon" : visible si peut éditer
  if (elements.btnSaveDraft) {
    elements.btnSaveDraft.hidden = !userPerms.canEdit && !userPerms.canCreate;
  }
  // Bouton "Générer" (création nouvel article) : désactivé si canCreate = false
  if (!userPerms.canCreate && elements.btnGenerate) {
    elements.btnGenerate.disabled = true;
    elements.btnGenerate.title = "Vous n'avez pas la permission de créer un article";
  }
}

// Détecter si on est sur mobile
function isMobile(): boolean {
  return window.innerWidth <= 768 || 'ontouchstart' in window;
}

// Initialiser l'éditeur Quill (avec polling au lieu de setTimeout)
function initQuillEditor() {
  if (state.quillEditor) return;

  const container = document.getElementById('quill-editor');
  if (!container || container.offsetParent === null) {
    // Conteneur pas encore visible, réessayer
    requestAnimationFrame(() => initQuillEditor());
    return;
  }

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

// Définir le contenu HTML dans Quill (avec attente d'initialisation)
function setQuillContent(html: string) {
  if (state.quillEditor) {
    state.quillEditor.root.innerHTML = html;
    elements.articleContent.value = html;
    return;
  }
  // Quill pas encore prêt, réessayer
  requestAnimationFrame(() => setQuillContent(html));
}

// Navigation entre les étapes
function showStep(step: AppState['currentStep']) {
  state.currentStep = step;

  // Masquer toutes les étapes
  elements.stepUpload.classList.remove('active');
  elements.stepLoading.classList.remove('active');
  elements.stepChat.classList.remove('active');
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
    case 'chat':
      elements.stepChat.classList.add('active');
      break;
    case 'editor':
      elements.stepEditor.classList.add('active');
      initQuillEditor();
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
    const name = file?.name.toLowerCase() || '';
    if (file && (file.type.startsWith('image/') || name.endsWith('.heic') || name.endsWith('.heif'))) {
      handleFileSelect(file);
    }
  });

  // Suppression de la photo
  elements.removePhoto.addEventListener('click', (e) => {
    e.stopPropagation();
    removeSelectedFile();
  });
}

async function handleFileSelect(file: File) {
  // Convertir HEIC/HEIF en JPEG si nécessaire
  const name = file.name.toLowerCase();
  if (file.type === 'image/heic' || file.type === 'image/heif' || name.endsWith('.heic') || name.endsWith('.heif')) {
    showToast('Conversion du format HEIC en cours...', 'info', 3000);
    try {
      file = await convertHeicToJpeg(file);
    } catch {
      showToast('Impossible de convertir l\'image HEIC. Essayez un autre format (JPG, PNG).', 'error', 5000);
      return;
    }
  }

  // Vérifier la taille
  if (file.size > MAX_IMAGE_SIZE) {
    const sizeMB = (MAX_IMAGE_SIZE / 1024 / 1024).toFixed(0);
    showToast(`Image trop lourde (max ${sizeMB}MB). Elle sera compressée automatiquement.`, 'info', 3000);
  }

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
  const hasChantier = !!elements.chantierSelect.value;
  // Bouton "mode rapide" (n8n) : photo + description requis
  elements.btnGenerate.disabled = !hasPhoto || !hasDescription;
  // Bouton "chat IA" : photo + chantier requis
  elements.btnStartChat.disabled = !hasPhoto || !hasChantier;
}

// --- CHAT IA ---

async function handleStartChat() {
  if (!state.selectedFile || !state.selectedChantier) {
    showToast('Photo et chantier requis', 'error');
    return;
  }

  // Compresse la photo et la convertit en base64
  // Note: fileToBase64() retourne juste le base64 brut (sans le préfixe data:),
  // et compressImage() force toujours le type 'image/jpeg'.
  try {
    elements.btnStartChat.classList.add('loading');
    const compressed = await compressImage(state.selectedFile);
    const base64 = await fileToBase64(compressed);
    state.chatPhotoMime = compressed.type || 'image/jpeg';
    state.chatPhotoBase64 = base64;
    state.chatPhotoUrl = `data:${state.chatPhotoMime};base64,${base64}`;
    state.chatMessages = [];
    state.chatDraft = null;

    // Prépare l'UI chat
    elements.chatChantierName.textContent = `${state.selectedChantier.name} — ${state.selectedChantier.city}`;
    elements.chatPhotoImg.src = state.chatPhotoUrl;
    elements.chatMessages.innerHTML = '';
    elements.chatInput.value = '';
    elements.chatError.hidden = true;
    elements.chatValidate.setAttribute('disabled', 'true');

    showStep('chat');

    // Premier appel : on demande à l'IA d'amorcer la conversation
    await runChatTurn({ initialKickoff: true, mode: 'chat' });
  } catch (err) {
    showToast(`Erreur démarrage chat : ${(err as Error).message}`, 'error');
  } finally {
    elements.btnStartChat.classList.remove('loading');
  }
}

async function runChatTurn(opts: { initialKickoff?: boolean; mode?: 'chat' | 'draft' } = {}) {
  if (!state.selectedChantier) return;
  if (state.chatBusy) return;
  state.chatBusy = true;
  setChatBusyUI(true);

  try {
    const result = await sendChat({
      chantier_id: state.selectedChantier.id,
      photo_base64: state.chatPhotoBase64 || undefined,
      mime_type: state.chatPhotoMime || undefined,
      messages: state.chatMessages,
      mode: opts.mode || 'chat',
    });

    // Ajoute la réponse de l'IA à l'historique + UI
    state.chatMessages.push({ role: 'assistant', content: result.message });
    appendChatBubble('assistant', result.message);

    if (result.draft) {
      state.chatDraft = result.draft;
      appendChatBubble('draft', formatDraftPreview(result.draft));
      elements.chatValidate.removeAttribute('disabled');
    }
  } catch (err) {
    elements.chatError.textContent = `Erreur : ${(err as Error).message}`;
    elements.chatError.hidden = false;
    if (opts.initialKickoff) {
      // Le démarrage a échoué : on revient à upload pour permettre de retenter
      setTimeout(() => showStep('upload'), 100);
    }
  } finally {
    state.chatBusy = false;
    setChatBusyUI(false);
  }
}

async function handleChatSend() {
  const text = elements.chatInput.value.trim();
  if (!text || state.chatBusy) return;

  state.chatMessages.push({ role: 'user', content: text });
  appendChatBubble('user', text);
  elements.chatInput.value = '';
  elements.chatError.hidden = true;
  // Mode 'chat' (flash) par défaut. Le serveur peut quand même bascule en draft
  // si l'utilisateur tape "donne-moi un brouillon" via la détection de mots-clés.
  await runChatTurn({ mode: 'chat' });
}

async function handleChatRequestDraft() {
  if (state.chatBusy) return;
  // Envoie un message implicite de l'utilisateur + force le mode draft (modèle pro)
  const text = "Produis maintenant le brouillon complet d'article avec ce qu'on a.";
  state.chatMessages.push({ role: 'user', content: text });
  appendChatBubble('user', text);
  elements.chatError.hidden = true;
  await runChatTurn({ mode: 'draft' });
}

async function handleValidateChatDraft() {
  if (!state.chatDraft || !state.selectedChantier) return;

  // Crée un brouillon supabase à partir du chat draft
  try {
    elements.chatValidate.setAttribute('disabled', 'true');
    elements.chatValidate.textContent = 'Création…';

    // Sauvegarde compression de la photo en datauri pour l'image_url
    const draft = await createDraft({
      title: state.chatDraft.title,
      content: state.chatDraft.content_html,
      description: null,
      image_url: state.chatPhotoUrl,
      wp_media_id: null,
      wp_post_id: null,         // pas de wp_post_id : la publication WP n'est pas dispo via le chat
      chantier_id: state.selectedChantier.id,
    });

    state.currentDraft = draft;

    // Bascule vers l'éditeur
    if (state.chatPhotoUrl) elements.editorImage.src = state.chatPhotoUrl;
    elements.articleTitle.value = draft.title;
    showStep('editor');
    setQuillContent(draft.content);
    applyPermissionGating();
    loadDrafts();
    showToast('Brouillon créé depuis le chat', 'success');
  } catch (err) {
    showToast(`Erreur : ${(err as Error).message}`, 'error');
    elements.chatValidate.removeAttribute('disabled');
  } finally {
    elements.chatValidate.textContent = 'Valider et passer à l\'éditeur';
  }
}

function setChatBusyUI(busy: boolean) {
  if (busy) {
    elements.chatSend.classList.add('loading');
    elements.chatSend.setAttribute('disabled', 'true');
    elements.chatRequestDraft.setAttribute('disabled', 'true');
    elements.chatInput.setAttribute('disabled', 'true');
    appendChatBubble('typing', '');
  } else {
    elements.chatSend.classList.remove('loading');
    elements.chatRequestDraft.removeAttribute('disabled');
    elements.chatInput.removeAttribute('disabled');
    elements.chatInput.focus();
    // Met à jour le bouton send selon l'input
    elements.chatSend.disabled = elements.chatInput.value.trim().length === 0;
    // Retire le bubble "typing"
    document.querySelectorAll('.chat-bubble.typing').forEach(el => el.remove());
  }
}

function appendChatBubble(kind: 'user' | 'assistant' | 'draft' | 'typing', content: string) {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${kind}`;
  if (kind === 'typing') {
    bubble.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';
  } else if (kind === 'draft') {
    bubble.innerHTML = content;
  } else {
    bubble.textContent = content;
  }
  elements.chatMessages.appendChild(bubble);
  // Scroll au bas
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function formatDraftPreview(draft: ChatDraft): string {
  return `
    <div class="draft-preview">
      <div class="draft-preview-label">Brouillon proposé</div>
      <div class="draft-preview-title">${escapeHtml(draft.title)}</div>
      <div class="draft-preview-content">${draft.content_html}</div>
    </div>
  `;
}

// --- CHANTIER SELECTOR ---

async function loadChantierSelector() {
  try {
    const chantiers = await getChantiers('active');
    // Première option = placeholder vide (chantier requis pour le chat)
    elements.chantierSelect.innerHTML = '<option value="">Sélectionner un chantier…</option>';
    chantiers.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} — ${c.city} (${c.department})`;
      elements.chantierSelect.appendChild(opt);
    });

    // Check URL param for pre-selection
    const params = new URLSearchParams(window.location.search);
    const chantierId = params.get('chantier_id');
    if (chantierId) {
      elements.chantierSelect.value = chantierId;
      await handleChantierChange();
    }
  } catch (error) {
    console.error('Erreur chargement chantiers:', error);
  }
}

async function handleChantierChange() {
  const chantierId = elements.chantierSelect.value;

  if (!chantierId) {
    state.selectedChantier = null;
    setSeoFieldsLocked(false);
    elements.chantierBadge.hidden = true;
    updateGenerateButton();
    return;
  }

  try {
    const chantier = await getChantier(chantierId);
    if (!chantier) return;

    state.selectedChantier = chantier;

    // Auto-fill SEO fields
    elements.seoSector.value = chantier.client_sector;
    elements.seoProjectType.value = chantier.project_type;
    elements.seoCity.value = chantier.city;
    elements.seoDepartment.value = chantier.department;
    if (chantier.surface) elements.seoSurface.value = chantier.surface.toString();
    if (chantier.seo_keywords) elements.seoKeywords.value = chantier.seo_keywords;

    setSeoFieldsLocked(true);

    // Show article count badge
    const existingArticles = await getDraftsByChantier(chantierId);
    const articleNum = existingArticles.length + 1;
    elements.chantierBadge.textContent = `Article n°${articleNum} pour ce chantier`;
    elements.chantierBadge.hidden = false;

    updateGenerateButton();
  } catch (error) {
    console.error('Erreur sélection chantier:', error);
  }
}

function setSeoFieldsLocked(locked: boolean) {
  const fields = [elements.seoSector, elements.seoProjectType, elements.seoCity, elements.seoDepartment, elements.seoSurface];
  fields.forEach(field => {
    if (locked) {
      field.setAttribute('disabled', 'true');
      field.style.opacity = '0.7';
    } else {
      field.removeAttribute('disabled');
      field.style.opacity = '1';
    }
  });
}

// Collecter le contexte SEO depuis le formulaire
function collectSeoContext(): SeoContext {
  return {
    articleType: elements.seoArticleType.value,
    projectType: elements.seoProjectType.value,
    sector: elements.seoSector.value,
    city: elements.seoCity.value.trim(),
    department: elements.seoDepartment.value,
    surface: elements.seoSurface.value,
    keywords: elements.seoKeywords.value.trim()
  };
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
    // Compresser l'image si nécessaire puis convertir en base64
    let fileToProcess = state.selectedFile;
    if (state.selectedFile.size > MAX_IMAGE_SIZE) {
      fileToProcess = await compressImage(state.selectedFile);
    }

    const photoBase64 = await fileToBase64(fileToProcess);
    updateLoadingStep('upload', 'done');

    // Collecter le contexte SEO
    const seo = collectSeoContext();

    // Si chantier sélectionné, récupérer l'historique et le résumer
    let history = '';
    if (state.selectedChantier) {
      try {
        const existingArticles = await getDraftsByChantier(state.selectedChantier.id);
        const descriptions = existingArticles
          .filter(a => a.description)
          .map(a => a.description!);
        if (descriptions.length > 0) {
          history = await summarizeHistory(descriptions);
        }
      } catch (error) {
        console.error('Erreur récupération historique:', error);
        // Continue without history
      }
    }

    // Appeler n8n
    updateLoadingStep('ai', 'active');
    const result = await generateArticle({
      photo: photoBase64,
      description: elements.description.value.trim(),
      seo,
      ...(history ? { history } : {})
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
      wp_post_id: result.wp_post_id ?? null,
      chantier_id: state.selectedChantier?.id ?? null
    });
    updateLoadingStep('save', 'done');

    // Passer à l'éditeur
    state.currentDraft = draft;
    showEditor(draft);

  } catch (error) {
    console.error('Erreur génération:', error);

    // Marquer l'étape en erreur
    const currentActive = document.querySelector('.loading-step.active');
    if (currentActive) {
      const stepName = currentActive.getAttribute('data-step') || '';
      updateLoadingStep(stepName, 'error');
    }

    showToast(error instanceof Error ? error.message : 'Erreur lors de la génération', 'error');
    setTimeout(() => showStep('upload'), 2000);
  }
}

// Afficher l'éditeur
function showEditor(draft: ArticleDraft) {
  elements.editorImage.src = draft.image_url || '';
  elements.articleTitle.value = draft.title;

  showStep('editor');
  setQuillContent(draft.content);
  // Re-applique le gating au cas où le DOM des boutons aurait été refait
  applyPermissionGating();
  loadDrafts();
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

    showToast('Brouillon sauvegardé', 'success');
    elements.btnSaveDraft.textContent = '💾 Sauvegarder';
    elements.btnSaveDraft.removeAttribute('disabled');

    loadDrafts();

  } catch (error) {
    console.error('Erreur sauvegarde:', error);
    showToast('Erreur lors de la sauvegarde', 'error');
    elements.btnSaveDraft.textContent = '💾 Sauvegarder';
    elements.btnSaveDraft.removeAttribute('disabled');
  }
}

// Soumettre pour validation (utilisateur normal)
async function handleSubmitReview() {
  if (!state.currentDraft) return;

  try {
    // Sauvegarder d'abord le contenu actuel
    const content = getQuillContent();
    await updateDraft(state.currentDraft.id, {
      title: elements.articleTitle.value,
      content: content,
      status: 'pending_review' as any
    });

    // Notification email fire & forget
    notifyReview(elements.articleTitle.value, state.currentDraft.id);

    showToast('Article soumis pour validation !', 'success');
    handleNewArticle();
    loadDrafts();

  } catch (error) {
    console.error('Erreur soumission:', error);
    showToast('Erreur lors de la soumission', 'error');
  }
}

// Publier l'article via n8n (admin uniquement)
async function handlePublish() {
  if (!state.currentDraft) return;

  if (!userPerms.canPublish) {
    showToast("Vous n'avez pas la permission de publier", 'error');
    return;
  }

  // Vérifier qu'on a un wp_post_id (brouillon WP créé)
  if (!state.currentDraft.wp_post_id) {
    showToast('Pas de brouillon WordPress associé. Régénérez l\'article.', 'error');
    return;
  }

  const confirmed = await showConfirm('Publication', 'Publier cet article sur le site ?');
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

    // Reset LinkedIn section state
    elements.linkedinLoading.hidden = false;
    elements.linkedinContent.hidden = true;
    elements.linkedinError.hidden = true;

    showStep('success');
    loadDrafts();

    // Générer le post LinkedIn en async (ne bloque pas l'écran de succès)
    // Utiliser le shortlink WordPress pour une URL propre dans le post
    const shortArticleUrl = `${WP_SITE_URL}/?p=${result.id}`;
    generateLinkedInPost(currentTitle, currentContent, shortArticleUrl)
      .then(post => {
        elements.linkedinLoading.hidden = true;
        if (post) {
          elements.linkedinPost.value = post;
          elements.linkedinContent.hidden = false;
          const shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(result.link)}`;
          elements.btnShareLinkedin.href = shareUrl;
        } else {
          elements.linkedinError.hidden = false;
        }
      })
      .catch(() => {
        elements.linkedinLoading.hidden = true;
        elements.linkedinError.hidden = false;
      });

  } catch (error) {
    console.error('Erreur publication:', error);
    showToast(error instanceof Error ? error.message : 'Erreur lors de la publication', 'error');
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

  // Reset chantier selector
  state.selectedChantier = null;
  elements.chantierSelect.value = '';
  elements.chantierBadge.hidden = true;
  setSeoFieldsLocked(false);

  // Reset SEO fields
  elements.seoArticleType.value = 'chantier';
  elements.seoProjectType.value = 'construction';
  elements.seoSector.value = 'industriel';
  elements.seoCity.value = '';
  elements.seoDepartment.value = '25';
  elements.seoSurface.value = '';
  elements.seoKeywords.value = '';

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
    console.error('Erreur chargement brouillons:', error);
  }
}

// Sanitiser une URL pour insertion dans un attribut HTML
function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
    return '';
  } catch {
    return '';
  }
}

// Afficher les brouillons
function renderDrafts() {
  // Les utilisateurs avec la permission `articles:publish` (publishers) voient aussi
  // les `pending_review` (à valider). Les autres ne voient que les `draft`.
  const visibleDrafts = userPerms.canPublish
    ? state.drafts
    : state.drafts.filter(d => d.status === 'draft');

  elements.draftsCount.textContent = visibleDrafts.length.toString();

  if (visibleDrafts.length === 0) {
    elements.draftsList.innerHTML = `
      <div class="drafts-empty">
        <p>Aucun brouillon</p>
      </div>
    `;
    return;
  }

  elements.draftsList.innerHTML = visibleDrafts.map(draft => {
    const safeUrl = draft.image_url ? sanitizeUrl(draft.image_url) : '';
    const statusBadge = draft.status === 'pending_review'
      ? '<span class="badge badge-pending">En attente</span>'
      : '';
    return `
    <div class="draft-item" data-id="${escapeHtml(draft.id)}">
      <div class="draft-image">
        ${safeUrl ? `<img src="${safeUrl}" alt="" />` : '<div class="no-image">📷</div>'}
      </div>
      <div class="draft-info">
        <h3>${escapeHtml(draft.title)}</h3>
        <span class="draft-date">${formatDate(draft.created_at)}</span>
        ${statusBadge}
      </div>
      <div class="draft-actions">
        <button class="draft-edit" title="Éditer">✏️</button>
        <button class="draft-delete" title="Supprimer">🗑️</button>
      </div>
    </div>
  `}).join('');

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
  const confirmed = await showConfirm('Suppression', 'Supprimer ce brouillon ?');
  if (!confirmed) return;

  try {
    await deleteDraft(id);
    showToast('Brouillon supprimé', 'info');
    loadDrafts();

    // Si c'était le brouillon actuel, retourner à l'upload
    if (state.currentDraft?.id === id) {
      handleNewArticle();
    }
  } catch (error) {
    console.error('Erreur suppression:', error);
    showToast('Erreur lors de la suppression', 'error');
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
async function init() {
  console.log('📝 Articles Chantier - Initialisation...');

  // Page guard : redirige si non authentifié ou sans permission de lecture
  const profile = await requirePermission('articles', 'read', '/');
  if (!profile) return;
  document.body.classList.add('gate-passed');
  userPerms = computePerms(profile);
  applyPermissionGating();

  // Peupler le select des départements
  populateDepartmentSelect(elements.seoDepartment, { placeholder: '--', defaultValue: '25' });

  // Setup event listeners
  setupPhotoUpload();

  // Chantier selector
  await loadChantierSelector();
  elements.chantierSelect.addEventListener('change', handleChantierChange);

  elements.description.addEventListener('input', updateGenerateButton);
  elements.btnGenerate.addEventListener('click', handleGenerate);
  elements.btnSaveDraft.addEventListener('click', handleSaveDraft);
  elements.btnSubmitReview.addEventListener('click', handleSubmitReview);
  elements.btnPublish.addEventListener('click', handlePublish);
  elements.btnNewArticle.addEventListener('click', handleNewArticle);

  // Chat IA
  elements.btnStartChat.addEventListener('click', handleStartChat);
  elements.btnToggleFallback.addEventListener('click', () => {
    elements.fallbackFields.hidden = !elements.fallbackFields.hidden;
    elements.btnToggleFallback.textContent = elements.fallbackFields.hidden
      ? 'Mode rapide (génération directe) — pour publier directement sur WordPress'
      : 'Masquer le mode rapide';
  });
  elements.chatInput.addEventListener('input', () => {
    elements.chatSend.disabled = elements.chatInput.value.trim().length === 0 || state.chatBusy;
  });
  elements.chatInput.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + Enter pour envoyer
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleChatSend();
    }
  });
  elements.chatSend.addEventListener('click', handleChatSend);
  elements.chatRequestDraft.addEventListener('click', handleChatRequestDraft);
  elements.chatValidate.addEventListener('click', handleValidateChatDraft);
  elements.btnBackChat.addEventListener('click', () => showStep('upload'));

  // LinkedIn copy button
  elements.btnCopyLinkedin.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(elements.linkedinPost.value);
      elements.btnCopyLinkedin.textContent = 'Copié !';
      setTimeout(() => { elements.btnCopyLinkedin.textContent = 'Copier le texte'; }, 2000);
    } catch {
      // Fallback: select the textarea content
      elements.linkedinPost.select();
      showToast('Texte sélectionné, utilisez Ctrl+C pour copier', 'info');
    }
  });

  // Logout (remplace l'ancien admin-toggle)
  elements.btnLogout?.addEventListener('click', async () => {
    await logout();
    window.location.href = '/login.html';
  });

  // Fermer les modals en cliquant en dehors
  elements.confirmModal.addEventListener('click', (e) => {
    if (e.target === elements.confirmModal) elements.confirmModal.hidden = true;
  });

  // Charger les brouillons existants
  loadDrafts();

  console.log('📝 Articles Chantier - Prêt');
}

// Démarrer
document.addEventListener('DOMContentLoaded', init);
