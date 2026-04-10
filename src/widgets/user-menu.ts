// Widget flottant "user menu" — bouton circulaire en bas à droite,
// affiché sur toutes les pages internes (chantiers, articles, map, icpe…).
//
// Fonctionnalités :
// - Affiche le nom de l'utilisateur connecté
// - Bouton "Envoyer un retour" → ouvre une modale formulaire SAV
// - Bouton "Administration" (si is_admin)
// - Bouton "Déconnexion"
//
// Le widget s'auto-monte au chargement du module : il suffit d'importer
// ce fichier (via <script type="module">) pour qu'il apparaisse.
//
// Si l'utilisateur n'est pas connecté, le widget reste invisible.

import './user-menu.css';
import { getCurrentProfile, logout } from '../auth/session';
import { submitFeedback } from './feedback-api';

const ICON_USER = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

const ICON_FEEDBACK = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

const ICON_ADMIN = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

const ICON_LOGOUT = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`;

const ICON_HOME = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;

(async function init() {
  const profile = await getCurrentProfile();
  if (!profile) return; // pas connecté → pas de widget

  const root = document.createElement('div');
  root.className = 'um-root';
  root.innerHTML = `
    <button type="button" class="um-fab" aria-label="Menu utilisateur" aria-expanded="false">
      ${ICON_USER}
    </button>

    <div class="um-menu" hidden>
      <div class="um-menu-header">
        <div class="um-menu-name">${escape(profile.full_name)}</div>
        <div class="um-menu-email">${escape(profile.email)}</div>
        ${profile.is_admin ? '<div class="um-menu-badge">Admin</div>' : ''}
      </div>
      <div class="um-menu-items">
        <button type="button" class="um-menu-item" data-action="home">
          ${ICON_HOME}<span>Accueil</span>
        </button>
        <button type="button" class="um-menu-item" data-action="feedback">
          ${ICON_FEEDBACK}<span>Envoyer un retour</span>
        </button>
        ${profile.is_admin ? `
        <button type="button" class="um-menu-item" data-action="admin">
          ${ICON_ADMIN}<span>Administration</span>
        </button>
        ` : ''}
        <button type="button" class="um-menu-item um-menu-item-danger" data-action="logout">
          ${ICON_LOGOUT}<span>Déconnexion</span>
        </button>
      </div>
    </div>

    <div class="um-modal" hidden>
      <div class="um-modal-overlay"></div>
      <div class="um-modal-content">
        <header class="um-modal-header">
          <h2>Envoyer un retour</h2>
          <button type="button" class="um-modal-close" aria-label="Fermer">×</button>
        </header>
        <form class="um-feedback-form">
          <p class="um-feedback-hint">Décrivez le problème, la suggestion ou la question. Votre message sera transmis à l'équipe Batipro.</p>
          <textarea
            class="um-feedback-textarea"
            placeholder="Votre retour…"
            maxlength="5000"
            required
          ></textarea>
          <div class="um-feedback-error" hidden></div>
          <div class="um-modal-footer">
            <button type="button" class="um-btn um-btn-ghost" data-action="cancel">Annuler</button>
            <button type="submit" class="um-btn um-btn-primary">Envoyer</button>
          </div>
        </form>
        <div class="um-feedback-success" hidden>
          <div class="um-feedback-success-icon">✓</div>
          <p>Merci ! Votre retour a bien été envoyé.</p>
          <button type="button" class="um-btn um-btn-primary" data-action="close-success">Fermer</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // ── Refs ──────────────────────────────────────────────
  const fab = root.querySelector<HTMLButtonElement>('.um-fab')!;
  const menu = root.querySelector<HTMLDivElement>('.um-menu')!;
  const modal = root.querySelector<HTMLDivElement>('.um-modal')!;
  const modalClose = root.querySelector<HTMLButtonElement>('.um-modal-close')!;
  const modalOverlay = root.querySelector<HTMLDivElement>('.um-modal-overlay')!;
  const form = root.querySelector<HTMLFormElement>('.um-feedback-form')!;
  const textarea = root.querySelector<HTMLTextAreaElement>('.um-feedback-textarea')!;
  const errorBox = root.querySelector<HTMLDivElement>('.um-feedback-error')!;
  const successBox = root.querySelector<HTMLDivElement>('.um-feedback-success')!;

  // ── Menu toggle ───────────────────────────────────────
  fab.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !menu.hidden;
    menu.hidden = isOpen;
    fab.setAttribute('aria-expanded', String(!isOpen));
  });

  document.addEventListener('click', (e) => {
    if (!root.contains(e.target as Node)) {
      menu.hidden = true;
      fab.setAttribute('aria-expanded', 'false');
    }
  });

  // ── Items du menu ─────────────────────────────────────
  menu.querySelectorAll<HTMLButtonElement>('.um-menu-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      menu.hidden = true;
      fab.setAttribute('aria-expanded', 'false');

      if (action === 'home') {
        window.location.href = '/';
      } else if (action === 'feedback') {
        openFeedbackModal();
      } else if (action === 'admin') {
        window.location.href = '/admin.html';
      } else if (action === 'logout') {
        await logout();
        window.location.href = '/login.html';
      }
    });
  });

  // ── Modale feedback ───────────────────────────────────
  function openFeedbackModal() {
    textarea.value = '';
    errorBox.hidden = true;
    successBox.hidden = true;
    form.hidden = false;
    modal.hidden = false;
    setTimeout(() => textarea.focus(), 50);
  }

  function closeModal() {
    modal.hidden = true;
  }

  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', closeModal);
  root.querySelector('[data-action="cancel"]')!.addEventListener('click', closeModal);
  root.querySelector('[data-action="close-success"]')!.addEventListener('click', closeModal);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Envoi…';

    try {
      await submitFeedback(textarea.value);
      form.hidden = true;
      successBox.hidden = false;
    } catch (err) {
      errorBox.textContent = (err as Error).message;
      errorBox.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Envoyer';
    }
  });
})();

function escape(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
