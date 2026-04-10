// Onglet "Tickets SAV" de la page admin.
//
// Liste les feedbacks (selon RLS : admin voit tout), permet de filtrer
// par statut et d'ouvrir un détail pour changer le statut + ajouter des
// notes internes.

import { listFeedback, updateFeedback, FeedbackTicket } from '../widgets/feedback-api';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let allTickets: FeedbackTicket[] = [];
let currentFilter: 'all' | 'new' | 'in_progress' | 'resolved' = 'all';
let currentTicketId: string | null = null;

// Refs
const feedbackList = $('feedback-list');
const tabBadge = $<HTMLSpanElement>('tab-feedback-count');

const modal = $('feedback-modal');
const modalClose = $<HTMLButtonElement>('feedback-close');
const fdUser = $('fd-user');
const fdEmail = $('fd-email');
const fdPage = $('fd-page');
const fdDate = $('fd-date');
const fdUa = $('fd-ua');
const fdMessage = $('fd-message');
const fdStatus = $<HTMLSelectElement>('fd-status');
const fdNotes = $<HTMLTextAreaElement>('fd-notes');
const fdError = $('fd-error');
const fdCancel = $<HTMLButtonElement>('fd-cancel');
const fdSave = $<HTMLButtonElement>('fd-save');

const STATUS_LABELS: Record<FeedbackTicket['status'], string> = {
  new: 'Nouveau',
  in_progress: 'En cours',
  resolved: 'Résolu',
};

export async function initFeedbackTab() {
  // Filtres
  document.querySelectorAll<HTMLButtonElement>('.feedback-filters .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.feedback-filters .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = (btn.dataset.filter as typeof currentFilter) || 'all';
      renderList();
    });
  });

  // Modal handlers
  modalClose.addEventListener('click', closeModal);
  fdCancel.addEventListener('click', closeModal);
  fdSave.addEventListener('click', handleSave);

  await loadFeedback();
}

async function loadFeedback() {
  feedbackList.innerHTML = '<div class="empty-state">Chargement…</div>';
  try {
    allTickets = await listFeedback();
    updateTabBadge();
    renderList();
  } catch (err) {
    feedbackList.innerHTML = `<div class="empty-state error">Erreur : ${(err as Error).message}</div>`;
  }
}

function updateTabBadge() {
  const newCount = allTickets.filter(t => t.status === 'new').length;
  if (newCount > 0) {
    tabBadge.textContent = String(newCount);
    tabBadge.hidden = false;
  } else {
    tabBadge.hidden = true;
  }
}

function renderList() {
  const filtered = currentFilter === 'all'
    ? allTickets
    : allTickets.filter(t => t.status === currentFilter);

  if (filtered.length === 0) {
    feedbackList.innerHTML = '<div class="empty-state">Aucun ticket dans cette catégorie.</div>';
    return;
  }

  feedbackList.innerHTML = filtered.map(t => {
    const statusClass = `status-${t.status}`;
    const date = new Date(t.created_at).toLocaleString('fr-FR', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
    const preview = t.message.length > 140 ? t.message.slice(0, 140) + '…' : t.message;
    return `
      <article class="feedback-card" data-id="${t.id}">
        <div class="feedback-card-header">
          <div class="feedback-card-meta">
            <span class="feedback-status ${statusClass}">${STATUS_LABELS[t.status]}</span>
            <span class="feedback-card-user">${escape(t.user_name || '?')} · ${escape(t.user_email)}</span>
          </div>
          <span class="feedback-card-date">${date}</span>
        </div>
        <div class="feedback-card-message">${escape(preview)}</div>
        <div class="feedback-card-footer">
          <code>${escape(t.page)}</code>
        </div>
      </article>
    `;
  }).join('');

  // Click handlers sur les cards
  feedbackList.querySelectorAll<HTMLElement>('.feedback-card').forEach(card => {
    card.addEventListener('click', () => openModal(card.dataset.id!));
  });
}

function openModal(id: string) {
  const t = allTickets.find(x => x.id === id);
  if (!t) return;
  currentTicketId = id;
  fdUser.textContent = t.user_name || '?';
  fdEmail.textContent = t.user_email;
  fdPage.textContent = t.page;
  fdDate.textContent = new Date(t.created_at).toLocaleString('fr-FR');
  fdUa.textContent = t.user_agent || '?';
  fdMessage.textContent = t.message;
  fdStatus.value = t.status;
  fdNotes.value = t.admin_notes || '';
  fdError.hidden = true;
  modal.hidden = false;
}

function closeModal() {
  modal.hidden = true;
  currentTicketId = null;
}

async function handleSave() {
  if (!currentTicketId) return;
  fdError.hidden = true;
  fdSave.disabled = true;
  fdSave.textContent = 'Enregistrement…';
  try {
    await updateFeedback(currentTicketId, {
      status: fdStatus.value as FeedbackTicket['status'],
      admin_notes: fdNotes.value.trim() || undefined,
    });
    closeModal();
    await loadFeedback();
  } catch (err) {
    fdError.textContent = (err as Error).message;
    fdError.hidden = false;
  } finally {
    fdSave.disabled = false;
    fdSave.textContent = 'Enregistrer';
  }
}

function escape(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
