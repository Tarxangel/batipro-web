// Module principal - Articles Chantier

import './styles.css';
import { generateArticle, fileToBase64, publishArticle, compressImage, convertHeicToJpeg, summarizeHistory, generateLinkedInPost, reworkLinkedInPost, notifyReview, linkedinStatus, linkedinStart, linkedinPublish, linkedinDisconnect, SeoContext } from './api';

// Contexte de l'article courant (pour la publication / régénération LinkedIn)
let currentLinkedInUrl = '';
let currentLinkedInTitle = '';
let currentLinkedInContent = '';
import { createDraft, updateDraft, getDrafts, getDraftsByChantier, deleteDraft, markAsPublished, ArticleDraft } from './database';
import { getChantiers, getChantier, Chantier } from '../chantiers/database';
import { MAX_IMAGE_SIZE, WP_SITE_URL } from './config';
import { requirePermission, logout, AppProfile } from '../auth/session';
import { populateDepartmentSelect } from '../departments';
import { sendChat, createWpDraft, rewriteSelection, ChatMessage, ChatDraft } from './chat-api';

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
  btnPublishLinkedin: document.getElementById('btn-publish-linkedin') as HTMLButtonElement,
  btnConnectLinkedin: document.getElementById('btn-connect-linkedin') as HTMLButtonElement,
  linkedinAccountStatus: document.getElementById('linkedin-account-status')!,

  // Panneau de test LinkedIn (page upload)
  liTestStatus: document.getElementById('li-test-status')!,
  liTestConnect: document.getElementById('li-test-connect') as HTMLButtonElement,
  liTestPublishBox: document.getElementById('li-test-publish-box')!,
  liTestTextarea: document.getElementById('li-test-textarea') as HTMLTextAreaElement,
  liTestPublish: document.getElementById('li-test-publish') as HTMLButtonElement,
  liTestDisconnect: document.getElementById('li-test-disconnect') as HTMLButtonElement,

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

// --- LINKEDIN : état connexion / boutons ---

async function refreshLinkedInButtons() {
  const status = await linkedinStatus();
  if (status.connected && !status.expired) {
    elements.btnPublishLinkedin.hidden = false;
    elements.btnPublishLinkedin.disabled = false;
    elements.btnPublishLinkedin.textContent = 'Publier sur LinkedIn';
    elements.btnConnectLinkedin.hidden = true;
    elements.linkedinAccountStatus.textContent = status.name
      ? `Connecté en tant que ${status.name}` : 'Compte LinkedIn connecté';
  } else {
    elements.btnPublishLinkedin.hidden = true;
    elements.btnConnectLinkedin.hidden = false;
    elements.btnConnectLinkedin.disabled = false;
    elements.linkedinAccountStatus.textContent = status.expired
      ? 'Session LinkedIn expirée — reconnecte ton compte.'
      : 'Connecte ton compte pour publier en un clic (avec la page Batipro taguée).';
  }
}

// Panneau de test autonome (connexion + post de test, sans publier d'article)
async function setupLinkedInTestPanel() {
  const refresh = async () => {
    const s = await linkedinStatus();
    if (s.connected && !s.expired) {
      elements.liTestStatus.textContent = s.name ? `Connecté en tant que ${s.name}` : 'Compte LinkedIn connecté';
      elements.liTestConnect.hidden = true;
      elements.liTestPublishBox.hidden = false;
    } else {
      elements.liTestStatus.textContent = s.expired
        ? 'Session LinkedIn expirée — reconnecte ton compte.'
        : 'Pas encore connecté. Connecte ton compte pour tester (sans publier d\'article).';
      elements.liTestConnect.hidden = false;
      elements.liTestPublishBox.hidden = true;
    }
  };
  await refresh();

  elements.liTestConnect.addEventListener('click', async () => {
    try {
      elements.liTestConnect.disabled = true;
      window.location.href = await linkedinStart();
    } catch (err) {
      elements.liTestConnect.disabled = false;
      showToast(err instanceof Error ? err.message : 'Erreur connexion', 'error');
    }
  });

  elements.liTestPublish.addEventListener('click', async () => {
    const text = elements.liTestTextarea.value.trim();
    if (!text) return;
    elements.liTestPublish.disabled = true;
    elements.liTestPublish.textContent = 'Publication…';
    try {
      const url = await linkedinPublish(text, '');
      elements.liTestPublish.textContent = '✓ Publié';
      showToast('Post de test publié 🎉', 'success');
      window.open(url, '_blank');
    } catch (err) {
      elements.liTestPublish.disabled = false;
      elements.liTestPublish.textContent = 'Publier ce test sur LinkedIn';
      showToast('Échec : ' + (err instanceof Error ? err.message : 'erreur'), 'error');
    }
  });

  elements.liTestDisconnect.addEventListener('click', async () => {
    try { await linkedinDisconnect(); } catch { /* ignore */ }
    await refresh();
    showToast('Compte LinkedIn déconnecté', 'info');
  });
}

// Applique une consigne IA sur le texte d'un textarea LinkedIn (retravail).
async function applyLinkedInRework(textarea: HTMLTextAreaElement, instruction: string) {
  const current = textarea.value.trim();
  if (!current || !instruction) return;
  const prev = textarea.value;
  textarea.disabled = true;
  textarea.value = '⏳ Retravail en cours…';
  try {
    const out = await reworkLinkedInPost(current, instruction);
    textarea.value = out || prev;
    if (!out) showToast('La modification IA n\'a rien renvoyé', 'error');
  } catch {
    textarea.value = prev;
    showToast('La modification IA a échoué', 'error');
  } finally {
    textarea.disabled = false;
  }
}

function setupLinkedInAiTools() {
  // Régénérer un post complet (section article publié)
  document.getElementById('btn-li-regenerate')?.addEventListener('click', async () => {
    if (!currentLinkedInTitle) return;
    const ta = elements.linkedinPost;
    const prev = ta.value;
    ta.disabled = true;
    ta.value = '⏳ Nouvelle génération…';
    try {
      const post = await generateLinkedInPost(currentLinkedInTitle, currentLinkedInContent, currentLinkedInUrl);
      ta.value = post || prev;
    } catch {
      ta.value = prev;
    } finally {
      ta.disabled = false;
    }
  });
  // Boutons rapides + champ libre (section article publié)
  document.querySelectorAll<HTMLButtonElement>('[data-li-rework]').forEach(b => {
    b.addEventListener('click', () => applyLinkedInRework(elements.linkedinPost, b.dataset.liRework!));
  });
  document.getElementById('btn-li-rework-go')?.addEventListener('click', () => {
    const inp = document.getElementById('li-rework-input') as HTMLInputElement;
    if (inp.value.trim()) { applyLinkedInRework(elements.linkedinPost, inp.value.trim()); inp.value = ''; }
  });
  // Panneau de test
  document.querySelectorAll<HTMLButtonElement>('[data-li-test-rework]').forEach(b => {
    b.addEventListener('click', () => applyLinkedInRework(elements.liTestTextarea, b.dataset.liTestRework!));
  });
  document.getElementById('btn-li-test-rework-go')?.addEventListener('click', () => {
    const inp = document.getElementById('li-test-rework-input') as HTMLInputElement;
    if (inp.value.trim()) { applyLinkedInRework(elements.liTestTextarea, inp.value.trim()); inp.value = ''; }
  });
}

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

  initCanvasMode();
}

// ─── MODE CANVAS (réécriture de sélection par l'IA) ─────────
//
// Quand l'utilisateur sélectionne du texte dans l'éditeur Quill, on affiche
// un floating bubble près de la sélection avec des raccourcis ("Raccourcir",
// "Reformuler"…) + un bouton "Personnalisé" qui ouvre un modal d'instruction
// libre. À chaque clic, on envoie à l'Edge Function rewrite-selection :
//   - l'article complet (contexte)
//   - le texte sélectionné
//   - l'instruction
// et on remplace le passage par la réponse de l'IA.

interface CanvasRange { index: number; length: number }
let canvasState: {
  bubble: HTMLElement | null;
  modal: HTMLElement | null;
  lastRange: CanvasRange | null;
  busy: boolean;
} = { bubble: null, modal: null, lastRange: null, busy: false };

const CANVAS_QUICK_ACTIONS: Array<{ label: string; instruction: string }> = [
  { label: '✂️ Raccourcir', instruction: 'Raccourcir significativement ce passage tout en gardant l\'idée principale et tous les faits importants.' },
  { label: '📝 Reformuler', instruction: 'Reformuler ce passage différemment, en gardant exactement le même sens et les mêmes faits, mais avec d\'autres tournures et un meilleur rythme.' },
  { label: '🔧 Plus technique', instruction: 'Rendre ce passage plus technique et précis dans le vocabulaire BTP, sans inventer de fait nouveau.' },
  { label: '💬 Plus accessible', instruction: 'Rendre ce passage plus accessible à un lecteur non spécialiste, en gardant la précision factuelle.' },
];

function initCanvasMode() {
  if (canvasState.bubble) return; // déjà initialisé

  // ── Bubble flottant ──
  const bubble = document.createElement('div');
  bubble.id = 'canvas-bubble';
  bubble.className = 'canvas-bubble';
  bubble.innerHTML = `
    <div class="canvas-bubble-actions">
      ${CANVAS_QUICK_ACTIONS.map((a, i) => `
        <button type="button" class="canvas-bubble-btn" data-canvas-idx="${i}">${escapeHtml(a.label)}</button>
      `).join('')}
      <button type="button" class="canvas-bubble-btn canvas-bubble-custom" data-canvas-custom="1">✨ Personnalisé…</button>
    </div>
  `;
  document.body.appendChild(bubble);
  canvasState.bubble = bubble;

  // ── Modal "instruction libre" ──
  const modal = document.createElement('div');
  modal.id = 'canvas-modal';
  modal.className = 'canvas-modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="canvas-modal-backdrop"></div>
    <div class="canvas-modal-card">
      <h3>Modifier ce passage avec l'IA</h3>
      <p class="canvas-modal-selection-label">Passage sélectionné :</p>
      <blockquote class="canvas-modal-selection"></blockquote>
      <label for="canvas-modal-instruction">Que dois-je faire ?</label>
      <textarea
        id="canvas-modal-instruction"
        rows="3"
        placeholder="Ex: ajoute un détail sur la méthode de pose, ou rends le ton plus journalistique…"
      ></textarea>
      <div class="canvas-modal-actions">
        <button type="button" class="btn-ghost" data-canvas-modal-action="cancel">Annuler</button>
        <button type="button" class="btn-primary" data-canvas-modal-action="apply">Appliquer</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  canvasState.modal = modal;

  // ── Listener sélection Quill ──
  state.quillEditor.on('selection-change', (range: CanvasRange | null, _old: any, _source: string) => {
    if (!range || range.length === 0) {
      // Ne pas masquer si le focus est passé sur le bubble lui-même
      const active = document.activeElement;
      if (active && bubble.contains(active)) return;
      hideCanvasBubble();
      return;
    }
    // On garde lastRange même en cas de blur ultérieur (utile pour le modal)
    canvasState.lastRange = { index: range.index, length: range.length };
    showCanvasBubbleAt(range);
  });

  // Repositionner le bubble si l'utilisateur scrolle pendant la sélection
  window.addEventListener('scroll', () => {
    if (canvasState.lastRange && bubble.classList.contains('visible')) {
      showCanvasBubbleAt(canvasState.lastRange);
    }
  }, { passive: true });

  // ── Clicks sur le bubble ──
  bubble.addEventListener('mousedown', (e) => {
    // Empêche le blur de la sélection Quill quand on clique sur un bouton
    e.preventDefault();
  });
  bubble.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!btn) return;
    if (!canvasState.lastRange) return;
    if (btn.dataset.canvasCustom) {
      openCanvasModal(canvasState.lastRange);
      return;
    }
    const idx = Number(btn.dataset.canvasIdx);
    const action = CANVAS_QUICK_ACTIONS[idx];
    if (!action) return;
    void applyCanvasRewrite(canvasState.lastRange, action.instruction);
  });

  // ── Modal handlers ──
  modal.querySelector('.canvas-modal-backdrop')?.addEventListener('click', closeCanvasModal);
  modal.querySelectorAll<HTMLButtonElement>('button[data-canvas-modal-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.canvasModalAction;
      if (action === 'cancel') {
        closeCanvasModal();
      } else if (action === 'apply') {
        const instructionInput = document.getElementById('canvas-modal-instruction') as HTMLTextAreaElement;
        const instruction = instructionInput.value.trim();
        if (!instruction || !canvasState.lastRange) return;
        const range = canvasState.lastRange;
        closeCanvasModal();
        void applyCanvasRewrite(range, instruction);
      }
    });
  });
}

function showCanvasBubbleAt(range: CanvasRange) {
  const bubble = canvasState.bubble;
  if (!bubble || !state.quillEditor) return;
  const bounds = state.quillEditor.getBounds(range.index, range.length);
  const editorRect = state.quillEditor.container.getBoundingClientRect();

  // On rend visible AVANT de mesurer la largeur (sinon offsetWidth = 0)
  bubble.classList.add('visible');

  const bubbleWidth = bubble.offsetWidth || 320;
  const margin = 8;
  let left = editorRect.left + bounds.left + bounds.width / 2 - bubbleWidth / 2;
  // Clamp horizontal aux bords de viewport
  const maxLeft = window.innerWidth - bubbleWidth - margin;
  if (left < margin) left = margin;
  if (left > maxLeft) left = maxLeft;
  // Au-dessus de la sélection si possible, sinon en-dessous
  let top = editorRect.top + bounds.top + window.scrollY - bubble.offsetHeight - 10;
  if (top < window.scrollY + margin) {
    top = editorRect.top + bounds.top + bounds.height + window.scrollY + 10;
  }
  bubble.style.top = top + 'px';
  bubble.style.left = left + 'px';
}

function hideCanvasBubble() {
  canvasState.bubble?.classList.remove('visible');
}

function openCanvasModal(range: CanvasRange) {
  const modal = canvasState.modal;
  if (!modal || !state.quillEditor) return;
  const selectedText = state.quillEditor.getText(range.index, range.length).trim();
  const selectionEl = modal.querySelector('.canvas-modal-selection');
  if (selectionEl) selectionEl.textContent = selectedText;
  const instructionInput = document.getElementById('canvas-modal-instruction') as HTMLTextAreaElement;
  instructionInput.value = '';
  modal.hidden = false;
  hideCanvasBubble();
  setTimeout(() => instructionInput.focus(), 50);
}

function closeCanvasModal() {
  if (canvasState.modal) canvasState.modal.hidden = true;
}

async function applyCanvasRewrite(range: CanvasRange, instruction: string) {
  if (canvasState.busy) return;
  if (!state.quillEditor) return;
  const quill = state.quillEditor;

  canvasState.busy = true;
  hideCanvasBubble();

  // On marque la sélection visuellement (background) pendant l'appel
  const originalFormats = quill.getFormat(range.index, range.length);
  quill.formatText(range.index, range.length, { background: '#fff3cd' }, 'silent');

  showToast('Réécriture en cours…', 'info');

  try {
    const fullArticleHtml = quill.root.innerHTML;
    const selectedText = quill.getText(range.index, range.length).trim();
    if (!selectedText) {
      throw new Error('Sélection vide');
    }

    const rewritten = await rewriteSelection({
      full_article: fullArticleHtml,
      selection: selectedText,
      instruction,
      chantier_id: state.selectedChantier?.id,
    });

    // Retire le surlignage temporaire AVANT remplacement
    quill.formatText(range.index, range.length, { background: false }, 'silent');

    // Heuristique : si la réponse contient des balises HTML (<p>, <h2>…),
    // on utilise clipboard.dangerouslyPasteHTML pour préserver le formatage.
    // Sinon, simple insertText.
    const hasHtml = /<\/?(p|h2|h3|ul|li|strong|em|br)\b/i.test(rewritten);
    quill.deleteText(range.index, range.length, 'user');
    if (hasHtml) {
      quill.clipboard.dangerouslyPasteHTML(range.index, rewritten, 'user');
    } else {
      quill.insertText(range.index, rewritten, 'user');
    }
    showToast('Passage réécrit', 'success');
  } catch (err) {
    // Restore the original formatting (without temp background)
    if ('background' in originalFormats) {
      quill.formatText(range.index, range.length, { background: originalFormats.background }, 'silent');
    } else {
      quill.formatText(range.index, range.length, { background: false }, 'silent');
    }
    showToast(`Erreur réécriture : ${(err as Error).message}`, 'error');
  } finally {
    canvasState.busy = false;
    canvasState.lastRange = null;
  }
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
      // Nouveau flow : on enchaîne automatiquement vers l'éditeur sans
      // afficher de bulle "draft" intermédiaire ni attendre un clic sur
      // "Valider". L'utilisateur reverra le contenu directement dans Quill,
      // qu'il pourra retoucher (notamment via le mode Canvas).
      try {
        await transitionToEditor();
      } catch (transErr) {
        // Fallback dégradé : si la transition échoue (ex: createDraft KO),
        // on remonte une bulle classique + on ré-affiche le bouton Valider
        // pour permettre une retentative manuelle.
        console.error('Transition auto vers éditeur a échoué:', transErr);
        appendChatBubble('draft', formatDraftPreview(result.draft));
        elements.chatValidate.removeAttribute('disabled');
        elements.chatValidate.hidden = false;
        showToast(`Ouverture éditeur impossible : ${(transErr as Error).message}`, 'error');
      }
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

// transitionToEditor — appelée automatiquement par runChatTurn dès qu'un
// draft est reçu de l'IA. Crée le brouillon Supabase, ouvre l'éditeur
// immédiatement, et lance la création WP en arrière-plan.
//
// Stratégie "snappy" : l'utilisateur arrive en moins d'une seconde dans
// l'éditeur (juste le temps de l'INSERT Supabase). Le brouillon WordPress
// se crée pendant qu'il commence à éditer, et l'image_url est mise à jour
// quand WP répond (silencieusement si OK, toast si KO).
async function transitionToEditor(): Promise<void> {
  if (!state.chatDraft || !state.selectedChantier) {
    throw new Error('Draft ou chantier manquant');
  }

  const chatDraft = state.chatDraft;
  const imageUrlLocal = state.chatPhotoUrl || '';

  // 1) Crée le brouillon Supabase (rapide, < 1s).
  const draft = await createDraft({
    title: chatDraft.title,
    content: chatDraft.content_html,
    description: null,
    image_url: imageUrlLocal, // data: URL local, sera remplacée par l'URL WP plus tard
    wp_media_id: null,
    wp_post_id: null,
    chantier_id: state.selectedChantier.id,
  });

  state.currentDraft = draft;

  if (imageUrlLocal) elements.editorImage.src = imageUrlLocal;
  elements.articleTitle.value = draft.title;
  showStep('editor');
  setQuillContent(draft.content);
  applyPermissionGating();
  loadDrafts();
  showToast('Brouillon Supabase créé — l\'éditeur s\'ouvre. Création WordPress en cours…', 'success');

  // 2) Crée le brouillon WP en arrière-plan (fire-and-forget).
  if (state.chatPhotoBase64) {
    createWpDraftInBackground(
      draft.id,
      state.chatPhotoBase64,
      state.chatPhotoMime,
      chatDraft,
    );
  }
}

async function createWpDraftInBackground(
  draftId: string,
  base64: string,
  mime: string | null,
  chatDraft: ChatDraft,
): Promise<void> {
  try {
    const wp = await createWpDraft({
      photo_base64: base64,
      mime_type: mime || 'image/jpeg',
      title: chatDraft.title,
      content_html: chatDraft.content_html,
    });
    const updated = await updateDraft(draftId, {
      wp_post_id: wp.wp_post_id,
      wp_media_id: wp.wp_media_id,
      image_url: wp.image_url,
    });
    // Si l'utilisateur est toujours sur le même brouillon, on rafraîchit l'image
    // et l'état local. S'il a déjà navigué ailleurs, on met juste à jour la DB.
    if (state.currentDraft?.id === draftId) {
      state.currentDraft = updated;
      elements.editorImage.src = wp.image_url;
    }
    showToast('Brouillon WordPress créé', 'success');
    loadDrafts();
  } catch (wpErr) {
    console.error('createWpDraft background a échoué:', wpErr);
    showToast(`Brouillon WP non créé : ${(wpErr as Error).message} (le brouillon Supabase reste disponible)`, 'error');
  }
}

// Conservé pour compat avec le bouton "chat-validate" du flow de fallback
// (auto-transition KO) — appelle simplement transitionToEditor.
async function handleValidateChatDraft() {
  if (!state.chatDraft || !state.selectedChantier) return;
  try {
    elements.chatValidate.setAttribute('disabled', 'true');
    elements.chatValidate.textContent = 'Ouverture éditeur…';
    await transitionToEditor();
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
          currentLinkedInUrl = result.link;
          currentLinkedInTitle = currentTitle;
          currentLinkedInContent = currentContent;
          refreshLinkedInButtons();
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

  // Retour du flow OAuth LinkedIn
  const liParam = new URLSearchParams(window.location.search).get('linkedin');
  if (liParam === 'connected') {
    showToast('Compte LinkedIn connecté ✓ Tu peux maintenant publier en un clic.', 'success', 6000);
    window.history.replaceState({}, '', window.location.pathname);
  } else if (liParam === 'error') {
    showToast('Connexion LinkedIn échouée. Réessaie.', 'error');
    window.history.replaceState({}, '', window.location.pathname);
  }

  // Panneau de test LinkedIn (connexion + post de test sans publier d'article)
  setupLinkedInTestPanel();
  setupLinkedInAiTools();

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

  // ── Publication directe LinkedIn ──
  elements.btnConnectLinkedin.addEventListener('click', async () => {
    try {
      elements.btnConnectLinkedin.disabled = true;
      const url = await linkedinStart();
      // Redirection pleine page vers LinkedIn (connexion unique, persistante)
      window.location.href = url;
    } catch (err) {
      elements.btnConnectLinkedin.disabled = false;
      showToast(err instanceof Error ? err.message : 'Erreur connexion LinkedIn', 'error');
    }
  });

  elements.btnPublishLinkedin.addEventListener('click', async () => {
    const post = elements.linkedinPost.value.trim();
    if (!post) return;
    elements.btnPublishLinkedin.disabled = true;
    elements.btnPublishLinkedin.textContent = 'Publication…';
    try {
      const url = await linkedinPublish(post, currentLinkedInUrl);
      elements.btnPublishLinkedin.textContent = '✓ Publié';
      showToast('Post publié sur LinkedIn 🎉', 'success');
      window.open(url, '_blank');
    } catch (err) {
      elements.btnPublishLinkedin.disabled = false;
      elements.btnPublishLinkedin.textContent = 'Publier sur LinkedIn';
      const msg = err instanceof Error ? err.message : 'Erreur';
      // Token expiré → proposer reconnexion
      if (/expir|reconnect|401/i.test(msg)) {
        showToast('Session LinkedIn expirée, reconnecte ton compte', 'error');
        refreshLinkedInButtons();
      } else {
        showToast('Publication LinkedIn échouée : ' + msg, 'error');
      }
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
