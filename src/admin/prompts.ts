// Onglet "Prompts IA" de l'admin : liste des prompts éditables avec textarea
// + bouton Sauvegarder par carte. Détecte les modifications non sauvegardées
// et alerte si l'utilisateur tente de quitter l'onglet sans sauvegarder.

import { listPrompts, listPromptVersions, updatePromptContent, AiPrompt, AiPromptVersion } from './prompts-api';

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
    const updatedAt = formatDate(p.updated_at);
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
            <button type="button" class="btn-ghost" data-action="history" data-idx="${idx}">🕑 Historique</button>
            <button type="button" class="btn-ghost" data-action="reset" data-idx="${idx}">Annuler</button>
            <button type="button" class="btn-primary" data-action="save" data-idx="${idx}" disabled>Sauvegarder</button>
          </div>
        </header>
        ${p.description ? `<p class="prompt-description">${escapeHtml(p.description)}</p>` : ''}
        ${placeholders ? `<div class="prompt-placeholders"><strong>Placeholders :</strong> ${placeholders}</div>` : ''}
        <textarea class="prompt-textarea" data-idx="${idx}" rows="20" spellcheck="false">${escapeHtml(p.content)}</textarea>
        <div class="prompt-error form-error" data-idx="${idx}" hidden></div>
        <div class="prompt-history" data-idx="${idx}" hidden></div>
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

  if (action === 'history') {
    await toggleHistory(card, prompt, btn);
    return;
  }

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
      if (updatedSpan) updatedSpan.textContent = `Dernière maj : ${formatDate(new Date().toISOString())}`;
      saveBtn.textContent = 'Sauvegardé ✓';
      setTimeout(() => {
        saveBtn.textContent = 'Sauvegarder';
      }, 1500);
      // La version précédente vient d'être archivée : si le panneau est ouvert,
      // il doit la montrer tout de suite.
      const historyEl = card.querySelector<HTMLElement>('.prompt-history');
      if (historyEl && !historyEl.hidden) await renderHistory(historyEl, prompt, card);
    } catch (err) {
      errorEl.textContent = `Erreur : ${(err as Error).message}`;
      errorEl.hidden = false;
      saveBtn.disabled = false;
      saveBtn.textContent = 'Sauvegarder';
    }
  }
}

// ─── Historique des versions ──────────────────────────────
// Le trigger `ai_prompts_archive_version` archive le contenu remplacé à chaque
// UPDATE. Restaurer = réécrire ce contenu, donc l'état courant est lui aussi
// archivé au passage : aucune manip ne fait perdre un prompt.

async function toggleHistory(card: HTMLElement, prompt: AiPrompt, btn: HTMLButtonElement) {
  const historyEl = card.querySelector<HTMLElement>('.prompt-history');
  if (!historyEl) return;

  if (!historyEl.hidden) {
    historyEl.hidden = true;
    btn.textContent = '🕑 Historique';
    return;
  }

  historyEl.hidden = false;
  btn.textContent = '🕑 Masquer l\'historique';
  historyEl.innerHTML = '<p class="prompt-history-empty">Chargement…</p>';
  await renderHistory(historyEl, prompt, card);
}

async function renderHistory(historyEl: HTMLElement, prompt: AiPrompt, card: HTMLElement) {
  let versions: AiPromptVersion[];
  try {
    versions = await listPromptVersions(prompt.key);
  } catch (err) {
    historyEl.innerHTML = `<p class="prompt-history-empty error">Erreur : ${escapeHtml((err as Error).message)}</p>`;
    return;
  }

  if (versions.length === 0) {
    historyEl.innerHTML = '<p class="prompt-history-empty">Aucune version antérieure : ce prompt n\'a pas encore été modifié depuis l\'admin.</p>';
    return;
  }

  historyEl.innerHTML = `
    <h3 class="prompt-history-title">Versions antérieures (${versions.length})</h3>
    <ol class="prompt-history-list">
      ${versions.map((v, i) => `
        <li class="prompt-history-item" data-vid="${v.id}">
          <div class="prompt-history-meta">
            <strong>Remplacée le ${formatDate(v.archived_at)}</strong>
            <span>${v.author_name ? `écrite par ${escapeHtml(v.author_name)}` : 'auteur inconnu'} le ${formatDate(v.authored_at)}</span>
            <span class="prompt-history-size">${v.content.length} caractères</span>
          </div>
          <pre class="prompt-history-preview">${escapeHtml(v.content.slice(0, 400))}${v.content.length > 400 ? '…' : ''}</pre>
          <div class="prompt-history-actions">
            <button type="button" class="btn-ghost" data-vaction="toggle" data-i="${i}">Voir en entier</button>
            <button type="button" class="btn-ghost" data-vaction="restore" data-i="${i}">↩️ Restaurer cette version</button>
          </div>
        </li>
      `).join('')}
    </ol>
  `;

  historyEl.querySelectorAll<HTMLButtonElement>('button[data-vaction]').forEach(b => {
    b.addEventListener('click', () => {
      const version = versions[Number(b.dataset.i)];
      if (!version) return;
      if (b.dataset.vaction === 'toggle') {
        const pre = b.closest('.prompt-history-item')?.querySelector<HTMLElement>('.prompt-history-preview');
        if (!pre) return;
        const full = pre.dataset.full === '1';
        pre.textContent = full ? version.content.slice(0, 400) + (version.content.length > 400 ? '…' : '') : version.content;
        pre.dataset.full = full ? '0' : '1';
        b.textContent = full ? 'Voir en entier' : 'Réduire';
      } else {
        restoreVersion(card, prompt, version, historyEl);
      }
    });
  });
}

async function restoreVersion(
  card: HTMLElement,
  prompt: AiPrompt,
  version: AiPromptVersion,
  historyEl: HTMLElement,
) {
  const ta = card.querySelector<HTMLTextAreaElement>('.prompt-textarea');
  const errorEl = card.querySelector<HTMLElement>('.prompt-error');
  const saveBtn = card.querySelector<HTMLButtonElement>('button[data-action="save"]');
  if (!ta || !errorEl || !saveBtn) return;

  const warnUnsaved = dirty.has(prompt.key)
    ? '\n\nAttention : les modifications non sauvegardées de cet éditeur seront perdues.'
    : '';
  if (!confirm(`Restaurer la version du ${formatDate(version.archived_at)} ?${warnUnsaved}`)) return;

  errorEl.hidden = true;
  try {
    await updatePromptContent(prompt.key, version.content);
    prompt.content = version.content;
    ta.value = version.content;
    dirty.delete(prompt.key);
    saveBtn.disabled = true;

    const updatedSpan = card.querySelector<HTMLElement>('.prompt-updated');
    if (updatedSpan) updatedSpan.textContent = `Dernière maj : ${formatDate(new Date().toISOString())}`;

    await renderHistory(historyEl, prompt, card);
  } catch (err) {
    errorEl.textContent = `Erreur : ${(err as Error).message}`;
    errorEl.hidden = false;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
