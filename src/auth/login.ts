// Page de connexion — handler du formulaire login

import { login, getCurrentProfile } from './session';

const form = document.getElementById('login-form') as HTMLFormElement;
const emailInput = document.getElementById('email') as HTMLInputElement;
const passwordInput = document.getElementById('password') as HTMLInputElement;
const errorBox = document.getElementById('login-error') as HTMLDivElement;
const submitBtn = document.getElementById('login-submit') as HTMLButtonElement;

function showError(msg: string) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
}

function clearError() {
  errorBox.textContent = '';
  errorBox.hidden = true;
}

function getNextUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const next = params.get('next');
  // Whitelist: doit commencer par '/' et ne pas être un schéma externe
  if (next && next.startsWith('/') && !next.startsWith('//')) {
    return next;
  }
  return '/';
}

// Si déjà connecté, redirige immédiatement
(async () => {
  const profile = await getCurrentProfile();
  if (profile) {
    window.location.href = getNextUrl();
  }
})();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (!email || !password) {
    showError('Email et mot de passe requis');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Connexion…';

  const result = await login(email, password);

  if (!result.ok) {
    showError(result.error === 'Invalid login credentials'
      ? 'Email ou mot de passe incorrect'
      : result.error);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Se connecter';
    return;
  }

  // Vérifie qu'un profil existe bien (sinon le compte est cassé)
  const profile = await getCurrentProfile(true);
  if (!profile) {
    showError('Compte sans profil applicatif. Contactez un administrateur.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Se connecter';
    return;
  }

  window.location.href = getNextUrl();
});
