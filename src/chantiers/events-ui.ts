// UI de gestion de l'historique d'un chantier (timeline + modale CRUD).
//
// Exporte une instance unique avec les méthodes :
//   - init(canEdit) : branche les event listeners (à appeler une fois au démarrage)
//   - load(chantierId) : charge et affiche les events d'un chantier donné
//
// Le canEdit (calculé depuis les permissions) contrôle si les boutons
// d'édition apparaissent dans la timeline + masque le bouton "+ Ajouter".

import {
  listChantierEvents,
  createChantierEvent,
  updateChantierEvent,
  deleteChantierEvent,
  ChantierEvent,
} from './events-database';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let currentChantierId: string | null = null;
let editable = false;
let events: ChantierEvent[] = [];

// DOM refs (résolus paresseusement à init)
let timeline: HTMLElement;
let countBadge: HTMLElement;
let btnAdd: HTMLButtonElement;
let modal: HTMLElement;
let modalTitle: HTMLElement;
let modalClose: HTMLButtonElement;
let form: HTMLFormElement;
let formId: HTMLInputElement;
let formDate: HTMLInputElement;
let formType: HTMLInputElement;
let formDescription: HTMLTextAreaElement;
let formError: HTMLElement;
let formCancel: HTMLButtonElement;
let formSubmit: HTMLButtonElement;

export function initEventsUI(canEdit: boolean) {
  editable = canEdit;
  timeline = $('events-timeline');
  countBadge = $('events-count');
  btnAdd = $<HTMLButtonElement>('btn-add-event');
  modal = $('event-modal');
  modalTitle = $('event-modal-title');
  modalClose = $<HTMLButtonElement>('event-modal-close');
  form = $<HTMLFormElement>('event-form');
  formId = $<HTMLInputElement>('event-form-id');
  formDate = $<HTMLInputElement>('event-form-date');
  formType = $<HTMLInputElement>('event-form-type');
  formDescription = $<HTMLTextAreaElement>('event-form-description');
  formError = $('event-form-error');
  formCancel = $<HTMLButtonElement>('event-form-cancel');
  formSubmit = $<HTMLButtonElement>('event-form-submit');

  if (!editable) {
    btnAdd.hidden = true;
  }

  btnAdd.addEventListener('click', openCreateModal);
  modalClose.addEventListener('click', closeModal);
  formCancel.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  form.addEventListener('submit', handleSubmit);
}

// Charge et affiche les events du chantier donné
export async function loadEventsFor(chantierId: string) {
  currentChantierId = chantierId;
  timeline.innerHTML = '<div class="events-loading">Chargement…</div>';
  try {
    events = await listChantierEvents(chantierId);
    render();
  } catch (err) {
    timeline.innerHTML = `<div class="events-empty error">Erreur : ${escape((err as Error).message)}</div>`;
  }
}

function render() {
  countBadge.textContent = String(events.length);

  if (events.length === 0) {
    timeline.innerHTML = `
      <div class="events-empty">
        Aucun événement pour ce chantier.${editable ? ' Cliquez sur <strong>+ Ajouter un événement</strong> pour commencer à constituer l\'historique.' : ''}
      </div>
    `;
    return;
  }

  timeline.innerHTML = events.map(e => {
    const date = formatDate(e.event_date);
    const type = e.event_type ? `<span class="event-type">${escape(e.event_type)}</span>` : '';
    const actions = editable ? `
      <div class="event-actions">
        <button type="button" class="event-btn" data-action="edit" data-id="${e.id}" title="Modifier">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button type="button" class="event-btn event-btn-danger" data-action="delete" data-id="${e.id}" title="Supprimer">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>
      </div>` : '';

    return `
      <article class="event-item" data-id="${e.id}">
        <div class="event-marker"></div>
        <div class="event-content">
          <div class="event-header">
            <div class="event-meta">
              <time class="event-date">${date}</time>
              ${type}
            </div>
            ${actions}
          </div>
          <div class="event-description">${escape(e.description)}</div>
        </div>
      </article>
    `;
  }).join('');

  // Bind action buttons
  timeline.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id!;
      if (action === 'edit') openEditModal(id);
      else if (action === 'delete') handleDelete(id);
    });
  });
}

function openCreateModal() {
  if (!currentChantierId) return;
  modalTitle.textContent = 'Nouvel événement';
  formId.value = '';
  formDate.value = new Date().toISOString().slice(0, 10);
  formType.value = '';
  formDescription.value = '';
  formError.hidden = true;
  modal.hidden = false;
  setTimeout(() => formDate.focus(), 50);
}

function openEditModal(id: string) {
  const e = events.find(x => x.id === id);
  if (!e) return;
  modalTitle.textContent = 'Modifier l\'événement';
  formId.value = id;
  formDate.value = e.event_date;
  formType.value = e.event_type || '';
  formDescription.value = e.description;
  formError.hidden = true;
  modal.hidden = false;
  setTimeout(() => formDescription.focus(), 50);
}

function closeModal() {
  modal.hidden = true;
}

async function handleSubmit(e: Event) {
  e.preventDefault();
  if (!currentChantierId) return;
  formError.hidden = true;

  const payload = {
    chantier_id: currentChantierId,
    event_date: formDate.value,
    event_type: formType.value.trim() || null,
    description: formDescription.value.trim(),
    photo_url: null,
  };

  if (!payload.event_date || !payload.description) {
    formError.textContent = 'Date et description requises';
    formError.hidden = false;
    return;
  }

  formSubmit.disabled = true;
  formSubmit.textContent = 'Enregistrement…';

  try {
    if (formId.value) {
      await updateChantierEvent(formId.value, payload);
    } else {
      await createChantierEvent(payload);
    }
    closeModal();
    if (currentChantierId) await loadEventsFor(currentChantierId);
  } catch (err) {
    formError.textContent = (err as Error).message;
    formError.hidden = false;
  } finally {
    formSubmit.disabled = false;
    formSubmit.textContent = 'Enregistrer';
  }
}

async function handleDelete(id: string) {
  const e = events.find(x => x.id === id);
  if (!e) return;
  if (!confirm(`Supprimer l'événement du ${formatDate(e.event_date)} ?`)) return;
  try {
    await deleteChantierEvent(id);
    if (currentChantierId) await loadEventsFor(currentChantierId);
  } catch (err) {
    alert(`Erreur : ${(err as Error).message}`);
  }
}

function formatDate(iso: string): string {
  // iso format YYYY-MM-DD
  const [y, m, d] = iso.split('-');
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
}

function escape(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
