// Page admin — gestion des comptes utilisateurs.
//
// Accessible uniquement aux admins (gate via requireAdmin).

import { requireAdmin, logout } from '../auth/session';
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  resetPassword,
  ManagedUser,
} from './users-api';
import { MODULES, summarizePermissions } from './permissions-config';
import { initFeedbackTab } from './feedback';
import { initPromptsTab } from './prompts';

// État
let users: ManagedUser[] = [];
let currentEditId: string | null = null;
let currentUserId: string | null = null;

// DOM
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const usersList = $('users-list');
const btnNewUser = $<HTMLButtonElement>('btn-new-user');
const btnLogout = $<HTMLButtonElement>('btn-logout');

const userModal = $('user-modal');
const modalTitle = $('modal-title');
const modalClose = $('modal-close');
const userForm = $<HTMLFormElement>('user-form');
const formUserId = $<HTMLInputElement>('form-user-id');
const formName = $<HTMLInputElement>('form-name');
const formEmail = $<HTMLInputElement>('form-email');
const formPassword = $<HTMLInputElement>('form-password');
const formIsAdmin = $<HTMLInputElement>('form-is-admin');
const passwordRow = $('password-row');
const permissionsGrid = $('permissions-grid');
const formError = $('form-error');
const formCancel = $<HTMLButtonElement>('form-cancel');
const formSubmit = $<HTMLButtonElement>('form-submit');

const resetModal = $('reset-modal');
const resetClose = $('reset-close');
const resetForm = $<HTMLFormElement>('reset-form');
const resetUserId = $<HTMLInputElement>('reset-user-id');
const resetUserLabel = $('reset-user-label');
const resetPasswordInput = $<HTMLInputElement>('reset-password');
const resetError = $('reset-error');
const resetCancel = $<HTMLButtonElement>('reset-cancel');

// ── Init ────────────────────────────────────────────────

(async function init() {
  const profile = await requireAdmin('/');
  if (!profile) return;
  // Le gate a passé : on révèle la page (cachée par défaut via CSS)
  document.body.classList.add('gate-passed');
  currentUserId = profile.id;

  buildPermissionsGrid();
  await loadUsers();
  await initFeedbackTab();
  await initPromptsTab();
  setupTabs();

  btnNewUser.addEventListener('click', openCreateModal);
  btnLogout.addEventListener('click', async () => {
    await logout();
    window.location.href = '/login.html';
  });

  modalClose.addEventListener('click', closeModal);
  formCancel.addEventListener('click', closeModal);
  userForm.addEventListener('submit', handleSubmit);

  resetClose.addEventListener('click', closeResetModal);
  resetCancel.addEventListener('click', closeResetModal);
  resetForm.addEventListener('submit', handleResetSubmit);

  // Toggle: si admin coché, on grise les permissions (toutes implicites)
  formIsAdmin.addEventListener('change', () => {
    permissionsGrid.classList.toggle('disabled', formIsAdmin.checked);
  });
})();

// ── Onglets ─────────────────────────────────────────────

function setupTabs() {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.admin-tab');
  const contents = document.querySelectorAll<HTMLElement>('.admin-tab-content');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      contents.forEach(c => c.classList.toggle('active', c.id === `tab-content-${target}`));
    });
  });
}

// ── Liste des utilisateurs ──────────────────────────────

async function loadUsers() {
  usersList.innerHTML = '<div class="empty-state">Chargement…</div>';
  try {
    users = await listUsers();
    renderUsers();
  } catch (err) {
    usersList.innerHTML = `<div class="empty-state error">Erreur : ${(err as Error).message}</div>`;
  }
}

function renderUsers() {
  if (users.length === 0) {
    usersList.innerHTML = '<div class="empty-state">Aucun utilisateur. Créez le premier compte avec le bouton ci-dessus.</div>';
    return;
  }

  usersList.innerHTML = users.map(u => {
    const isCurrent = u.id === currentUserId;
    const badge = u.is_admin
      ? '<span class="badge badge-admin">Admin</span>'
      : '<span class="badge">Utilisateur</span>';
    const perms = u.is_admin
      ? '<em>Accès complet</em>'
      : escapeHtml(summarizePermissions(u.permissions));

    return `
      <article class="user-card" data-id="${u.id}">
        <div class="user-card-main">
          <div class="user-card-header">
            <h3>${escapeHtml(u.full_name)}</h3>
            ${badge}
            ${isCurrent ? '<span class="badge badge-self">Vous</span>' : ''}
          </div>
          <div class="user-card-email">${escapeHtml(u.email)}</div>
          <div class="user-card-perms">${perms}</div>
        </div>
        <div class="user-card-actions">
          <button class="btn-ghost" data-action="edit" data-id="${u.id}">Modifier</button>
          <button class="btn-ghost" data-action="reset" data-id="${u.id}">Reset MDP</button>
          ${isCurrent ? '' : `<button class="btn-danger" data-action="delete" data-id="${u.id}">Supprimer</button>`}
        </div>
      </article>
    `;
  }).join('');

  // Délégation des clics
  usersList.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id!;
      if (action === 'edit') openEditModal(id);
      else if (action === 'reset') openResetModal(id);
      else if (action === 'delete') handleDelete(id);
    });
  });
}

// ── Modal création / édition ────────────────────────────

function buildPermissionsGrid() {
  let html = '';
  for (const mod of MODULES) {
    html += `
      <div class="perm-module">
        <div class="perm-module-label">${mod.label}</div>
        <div class="perm-actions">
          ${mod.actions.map(a => `
            <label class="perm-checkbox">
              <input type="checkbox" data-module="${mod.key}" data-action="${a.key}">
              <span>${a.label}</span>
            </label>
          `).join('')}
        </div>
      </div>
    `;
  }
  permissionsGrid.innerHTML = '<legend>Permissions par module</legend>' + html;
}

function openCreateModal() {
  currentEditId = null;
  modalTitle.textContent = 'Nouveau compte';
  formUserId.value = '';
  formName.value = '';
  formEmail.value = '';
  formEmail.disabled = false;
  formPassword.value = '';
  formPassword.required = true;
  passwordRow.style.display = '';
  formIsAdmin.checked = false;
  permissionsGrid.classList.remove('disabled');
  setPermissionsCheckboxes({});
  hideError(formError);
  userModal.hidden = false;
  formName.focus();
}

function openEditModal(id: string) {
  const user = users.find(u => u.id === id);
  if (!user) return;
  currentEditId = id;
  modalTitle.textContent = 'Modifier le compte';
  formUserId.value = id;
  formName.value = user.full_name;
  formEmail.value = user.email;
  formEmail.disabled = true; // email non modifiable (implique re-auth)
  formPassword.value = '';
  formPassword.required = false;
  passwordRow.style.display = 'none'; // pour reset, on a un modal dédié
  formIsAdmin.checked = user.is_admin;
  permissionsGrid.classList.toggle('disabled', user.is_admin);
  setPermissionsCheckboxes(user.permissions || {});
  hideError(formError);
  userModal.hidden = false;
  formName.focus();
}

function closeModal() {
  userModal.hidden = true;
  currentEditId = null;
}

function setPermissionsCheckboxes(perms: Record<string, string[]>) {
  permissionsGrid.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(cb => {
    const mod = cb.dataset.module!;
    const action = cb.dataset.action!;
    cb.checked = Array.isArray(perms[mod]) && perms[mod].includes(action);
  });
}

function collectPermissions(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  permissionsGrid.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked').forEach(cb => {
    const mod = cb.dataset.module!;
    const action = cb.dataset.action!;
    if (!result[mod]) result[mod] = [];
    result[mod].push(action);
  });
  return result;
}

async function handleSubmit(e: Event) {
  e.preventDefault();
  hideError(formError);

  const fullName = formName.value.trim();
  const email = formEmail.value.trim().toLowerCase();
  const password = formPassword.value;
  const isAdmin = formIsAdmin.checked;
  const permissions = isAdmin ? {} : collectPermissions();

  formSubmit.disabled = true;
  formSubmit.textContent = 'Enregistrement…';

  try {
    if (currentEditId) {
      await updateUser({
        user_id: currentEditId,
        full_name: fullName,
        is_admin: isAdmin,
        permissions,
      });
    } else {
      if (!password || password.length < 8) {
        throw new Error('Mot de passe requis (min. 8 caractères)');
      }
      await createUser({ email, password, full_name: fullName, is_admin: isAdmin, permissions });
    }
    closeModal();
    await loadUsers();
  } catch (err) {
    showError(formError, (err as Error).message);
  } finally {
    formSubmit.disabled = false;
    formSubmit.textContent = 'Enregistrer';
  }
}

// ── Modal reset password ────────────────────────────────

function openResetModal(id: string) {
  const user = users.find(u => u.id === id);
  if (!user) return;
  resetUserId.value = id;
  resetUserLabel.textContent = `${user.full_name} (${user.email})`;
  resetPasswordInput.value = '';
  hideError(resetError);
  resetModal.hidden = false;
  resetPasswordInput.focus();
}

function closeResetModal() {
  resetModal.hidden = true;
}

async function handleResetSubmit(e: Event) {
  e.preventDefault();
  hideError(resetError);
  const id = resetUserId.value;
  const newPassword = resetPasswordInput.value;
  if (newPassword.length < 8) {
    showError(resetError, 'Mot de passe trop court (min. 8 caractères)');
    return;
  }
  try {
    await resetPassword(id, newPassword);
    closeResetModal();
    alert('Mot de passe réinitialisé');
  } catch (err) {
    showError(resetError, (err as Error).message);
  }
}

// ── Suppression ─────────────────────────────────────────

async function handleDelete(id: string) {
  const user = users.find(u => u.id === id);
  if (!user) return;
  if (!confirm(`Supprimer définitivement le compte de ${user.full_name} (${user.email}) ?`)) return;
  try {
    await deleteUser(id);
    await loadUsers();
  } catch (err) {
    alert(`Erreur : ${(err as Error).message}`);
  }
}

// ── Utils ───────────────────────────────────────────────

function showError(el: HTMLElement, msg: string) {
  el.textContent = msg;
  el.hidden = false;
}

function hideError(el: HTMLElement) {
  el.textContent = '';
  el.hidden = true;
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
