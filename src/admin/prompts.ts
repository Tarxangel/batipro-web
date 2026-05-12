// Onglet "Prompts IA" de l'admin : liste des prompts éditables avec textarea
// + bouton Sauvegarder par carte. Détecte les modifications non sauvegardées
// et alerte si l'utilisateur tente de quitter l'onglet sans sauvegarder.

import { listPrompts, updatePromptContent, AiPrompt } from './prompts-api';

let prompts: AiPrompt[] = [];
const dirty = new Set<string>();

export async function initPromptsTab() {
  const container = document.getElementById('prompts-list');
  if (!container) return;
  try {
    prompts = await listPrompts();
    render(container);
  } catch (err) {
    container.innerHTML = `<div class="empty-state error">Erreur : ${escapeHtml((err as Error).message)}</div>`;
  }
}

function render(container: HTMLElement) {
  if (prompts.length === 0) {
    container.innerHTML = '<div class="empty-state">Aucun prompt enregistré en base.</div>';
    return;
  }

  container.innerHTML = prompts.map((p, idx) => {
    const placeholders = (p.placeholders || []).map(ph => `<code>{{${escapeHtml(ph)}}}</code>`).join(' ');
    const updatedAt = new Date(p.updated_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    return `
      <article class="prompt-card" data-key="${escapeHtml(p.key)}">
        <header class="prompt-card-header">
          <div>
            <h2>${escapeHtml(p.label)}</h2>
            <div class="prompt-meta">
              <code>${escapeHtml(p.key)}</code>
              <span class="prompt-updated">Dernière maj : ${updatedAt}</span>
            </div>
          </div>
          <div class="prompt-actions">
            <button type="button" class="btn-ghost" data-action="reset" data-idx="${idx}">Annuler</button>
            <button type="button" class="btn-primary" data-action="save" data-idx="${idx}" disabled>Sauvegarder</button>
          </div>
        </header>
        ${p.description ? `<p class="prompt-description">${escapeHtml(p.description)}</p>` : ''}
        ${placeholders ? `<div class="prompt-placeholders"><strong>Placeholders :</strong> ${placeholders}</div>` : ''}
        <textarea class="prompt-textarea" data-idx="${idx}" rows="20" spellcheck="false">${escapeHtml(p.content)}</textarea>
        <div class="prompt-error form-error" data-idx="${idx}" hidden></div>
      </article>
    `;
  }).join('');

  container.querySelectorAll<HTMLTextAreaElement>('.prompt-textarea').forEach(ta => {
    const idx = Number(ta.dataset.idx);
    ta.addEventListener('input', () => {
      const original = prompts[idx].content;
      const card = ta.closest('.prompt-card') as HTMLElement;
      const saveBtn = card.querySelector<HTMLButtonElement>('button[data-action="save"]');
      if (!saveBtn) return;
      const isDirty = ta.value !== original;
      if (isDirty) {
        dirty.add(prompts[idx].key);
        saveBtn.disabled = false;
      } else {
        dirty.delete(prompts[idx].key);
        saveBtn.disabled = true;
      }
    });
  });

  container.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleAction(btn));
  });

  // Warn avant déchargement de page si des changements non sauvés
  window.addEventListener('beforeunload', (e) => {
    if (dirty.size > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

async function handleAction(btn: HTMLButtonElement) {
  const idx = Number(btn.dataset.idx);
  const action = btn.dataset.action;
  const prompt = prompts[idx];
  if (!prompt) return;

  const card = btn.closest('.prompt-card') as HTMLElement;
  const ta = card.querySelector<HTMLTextAreaElement>('.prompt-textarea');
  const errorEl = card.querySelector<HTMLElement>('.prompt-error');
  const saveBtn = card.querySelector<HTMLButtonElement>('button[data-action="save"]');
  if (!ta || !errorEl || !saveBtn) return;

  if (action === 'reset') {
    ta.value = prompt.content;
    dirty.delete(prompt.key);
    saveBtn.disabled = true;
    errorEl.hidden = true;
    return;
  }

  if (action === 'save') {
    const newContent = ta.value;
    if (!newContent.trim()) {
      errorEl.textContent = 'Le prompt ne peut pas être vide.';
      errorEl.hidden = false;
      return;
    }
    errorEl.hidden = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Sauvegarde…';
    try {
      await updatePromptContent(prompt.key, newContent);
      prompt.content = newContent;
      dirty.delete(prompt.key);
      // Met à jour le timestamp affiché
      const updatedSpan = card.querySelector<HTMLElement>('.prompt-updated');
      if (updatedSpan) updatedSpan.textContent = `Dernière maj : ${new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`;
      saveBtn.textContent = 'Sauvegardé ✓';
      setTimeout(() => {
        saveBtn.textContent = 'Sauvegarder';
      }, 1500);
    } catch (err) {
      errorEl.textContent = `Erreur : ${(err as Error).message}`;
      errorEl.hidden = false;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Sauvegarder';
    }
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
