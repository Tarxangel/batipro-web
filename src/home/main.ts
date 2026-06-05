// Page d'accueil — orchestre l'affichage selon l'état d'authentification :
//
// - Visiteur non connecté → bouton "Se connecter" dans la nav, message vide
//   "Connectez-vous pour accéder à vos outils"
// - Utilisateur non-admin → seules les tuiles dont il a la permission `module:read`
//   sont révélées ; bouton "Déconnexion" dans la nav
// - Admin → toutes les tuiles + tuile Administration

import { getCurrentProfile, logout, AppProfile } from '../auth/session';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;

(async function init() {
  const navUser    = $('nav-user');
  const navLogin   = $<HTMLAnchorElement>('nav-login');
  const navLogout  = $<HTMLButtonElement>('nav-logout');
  const adminTile  = $('admin-tile');
  const rendersTile = $('renders-tile');
  const emptyState = $('tools-empty');
  const emptyMsg   = $('tools-empty-message');
  const emptyCta   = $<HTMLAnchorElement>('tools-empty-cta');
  const tiles = Array.from(document.querySelectorAll<HTMLElement>('.tool-card[data-requires-module]'));

  const profile = await getCurrentProfile();

  if (!profile) {
    showVisitorState();
  } else {
    showAuthenticatedState(profile);
  }

  // ── Handlers communs ────────────────────────────────────

  navLogout?.addEventListener('click', async () => {
    await logout();
    window.location.reload();
  });

  // ── Helpers ─────────────────────────────────────────────

  function showVisitorState() {
    if (navLogin)  navLogin.hidden  = false;
    if (navLogout) navLogout.hidden = true;
    if (navUser)   navUser.hidden   = true;
    if (adminTile) adminTile.hidden = true;
    if (rendersTile) rendersTile.hidden = true;

    // Toutes les tuiles restent cachées (déjà hidden par défaut)
    tiles.forEach(t => { t.hidden = true; });

    // Empty state
    if (emptyState) emptyState.hidden = false;
    if (emptyMsg)   emptyMsg.textContent = 'Connectez-vous pour accéder à vos outils.';
    if (emptyCta) {
      emptyCta.hidden = false;
      emptyCta.textContent = 'Se connecter';
      emptyCta.href = '/login.html';
    }
  }

  function showAuthenticatedState(profile: AppProfile) {
    if (navLogin)  navLogin.hidden  = true;
    if (navLogout) navLogout.hidden = false;
    if (navUser) {
      navUser.hidden = false;
      navUser.textContent = profile.full_name;
    }

    // Tuile admin : visible si is_admin
    if (adminTile) adminTile.hidden = !profile.is_admin;
    // Tuile Rendus IA : réservée aux admins pour l'instant
    if (rendersTile) rendersTile.hidden = !profile.is_admin;

    // Tuiles métier : visibles si l'utilisateur a la permission `module:read`
    // (admin court-circuite tout)
    let visibleCount = 0;
    tiles.forEach(tile => {
      const mod = tile.dataset.requiresModule;
      if (!mod) return;
      const allowed = profile.is_admin
        || (Array.isArray(profile.permissions?.[mod])
            && profile.permissions[mod].includes('read'));
      tile.hidden = !allowed;
      if (allowed) visibleCount++;
    });

    // Si l'utilisateur n'a aucune tuile métier ET n'est pas admin → empty state
    if (visibleCount === 0 && !profile.is_admin) {
      if (emptyState) emptyState.hidden = false;
      if (emptyMsg)   emptyMsg.textContent = "Aucun outil n'a été activé pour votre compte. Contactez un administrateur.";
      if (emptyCta)   emptyCta.hidden = true;
    } else {
      if (emptyState) emptyState.hidden = true;
    }
  }
})();
