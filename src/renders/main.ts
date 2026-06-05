// Page "Rendus IA" — amélioration IA de rendus architecturaux.
//
// Accès admin uniquement (gate via requireAdmin). L'utilisateur importe un
// rendu Lumion, choisit des presets d'ambiance, et génère un visuel
// photoréaliste et/ou une esquisse d'architecte. Chaque résultat peut être
// affiné (instruction libre), upscalé en 4K, puis téléchargé.
//
// Stratégie coût : on itère en 1K (rapide / ~0,13 $) et on n'upscale en 4K
// que l'image finale validée.

import { requirePermission, logout } from '../auth/session';
import { enhanceRender, RenderPresets } from './api';
import {
  listChantiers, saveRender, listRenders, signedUrl, deleteRender,
  Chantier, RenderRecord,
} from './history';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// État
let sourceB64 = '';            // rendu source, base64 sans préfixe
let sourceMime = 'image/jpeg';
let cardSeq = 0;
let chantiers: Chantier[] = [];

interface Card {
  id: number;
  kind: 'photoreal' | 'sketch';
  imageB64: string;
  mime: string;
  upscaledB64?: string;
  el: HTMLElement;
}

// ── Init ────────────────────────────────────────────────

(async function init() {
  const profile = await requirePermission('renders', 'read', '/');
  if (!profile) return;
  document.body.classList.add('gate-passed');

  $<HTMLButtonElement>('btn-logout').addEventListener('click', async () => {
    await logout();
    window.location.href = '/login.html';
  });

  setupDropzone();
  setupLightbox();
  $<HTMLFormElement>('presets-form').addEventListener('submit', handleGenerate);

  await loadChantiers();
  $<HTMLSelectElement>('history-filter').addEventListener('change', () => {
    renderHistory($<HTMLSelectElement>('history-filter').value || null);
  });
  await renderHistory(null);
})();

async function loadChantiers() {
  try {
    chantiers = await listChantiers();
  } catch {
    chantiers = [];
  }
  const optionsHtml = chantiers
    .map(c => `<option value="${c.id}">${escapeHtml(c.name)}${c.city ? ' — ' + escapeHtml(c.city) : ''}</option>`)
    .join('');
  const picker = $<HTMLSelectElement>('p-chantier');
  picker.insertAdjacentHTML('beforeend', optionsHtml);
  const filter = $<HTMLSelectElement>('history-filter');
  filter.insertAdjacentHTML('beforeend', optionsHtml);
}

// ── Import d'image ──────────────────────────────────────

function setupDropzone() {
  const dropzone = $('dropzone');
  const fileInput = $<HTMLInputElement>('file-input');
  const btnChange = $<HTMLButtonElement>('btn-change-image');

  dropzone.addEventListener('click', () => fileInput.click());
  btnChange.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });

  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) loadSourceImage(fileInput.files[0]);
  });

  ['dragover', 'dragenter'].forEach(ev =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach(ev =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
  dropzone.addEventListener('drop', (e) => {
    const file = (e as DragEvent).dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) loadSourceImage(file);
  });
}

// Redimensionne l'image en entrée (max 1568px sur le grand côté) pour alléger
// le payload et accélérer/abaisser le coût — la conditionning n'a pas besoin
// de la pleine résolution. Renvoie le base64 JPEG sans préfixe.
async function loadSourceImage(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = dataUrl;
  });

  const MAX = 1568;
  const scale = Math.min(1, MAX / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  const resized = canvas.toDataURL('image/jpeg', 0.92);

  sourceB64 = resized.split(',')[1];
  sourceMime = 'image/jpeg';

  // UI
  const preview = $<HTMLImageElement>('source-preview');
  preview.src = resized;
  preview.hidden = false;
  $('dropzone-empty').hidden = true;
  $<HTMLButtonElement>('btn-change-image').hidden = false;
  $<HTMLButtonElement>('btn-generate').disabled = false;
}

// ── Génération ──────────────────────────────────────────

function collectPresets(): RenderPresets {
  const v = (id: string) => $<HTMLSelectElement>(id).value;
  return {
    heure: v('p-heure'),
    intensite: v('p-intensite'),
    ambiance: v('p-ambiance'),
    vegetation: v('p-vegetation'),
    saison: v('p-saison'),
    ciel: v('p-ciel'),
    localisation: $<HTMLInputElement>('p-localisation').value.trim(),
    details: $<HTMLInputElement>('p-details').value.trim(),
  };
}

async function handleGenerate(e: Event) {
  e.preventDefault();
  if (!sourceB64) return;

  const livrable = (document.querySelector('input[name="livrable"]:checked') as HTMLInputElement).value;
  const kinds: Array<'photoreal' | 'sketch'> =
    livrable === 'both' ? ['photoreal', 'sketch'] : [livrable as 'photoreal' | 'sketch'];

  const presets = collectPresets();
  const btn = $<HTMLButtonElement>('btn-generate');
  btn.disabled = true;
  btn.textContent = 'Génération…';
  $('results-empty').hidden = true;

  // Séquentiel : limite la charge simultanée (VM + Gemini).
  for (const kind of kinds) {
    const card = createCard(kind);
    try {
      const res = await enhanceRender({
        image: sourceB64, mime: sourceMime, mode: kind, presets, size: '1K',
      });
      fillCard(card, res.image, res.mime);
    } catch (err) {
      errorCard(card, (err as Error).message);
    }
  }

  btn.disabled = false;
  btn.textContent = 'Générer';
}

// ── Cartes de résultat ──────────────────────────────────

function createCard(kind: 'photoreal' | 'sketch'): Card {
  const id = ++cardSeq;
  const grid = $('results-grid');
  const el = document.createElement('article');
  el.className = 'result-card loading';
  el.innerHTML = `
    <div class="result-media">
      <div class="result-spinner"><span class="spinner"></span><span>Génération…</span></div>
      <img class="result-img" hidden alt="${kind === 'photoreal' ? 'Rendu photoréaliste' : 'Esquisse'}">
    </div>
    <div class="result-body">
      <div class="result-head">
        <span class="result-tag tag-${kind}">${kind === 'photoreal' ? '📷 Photoréaliste' : '🎨 Esquisse'}</span>
        <span class="result-status"></span>
      </div>
      <div class="result-actions" hidden>
        <div class="refine-row">
          <input type="text" class="refine-input" placeholder="Affiner : « plus chaleureux », « allumer les fenêtres »…">
          <button type="button" class="btn-ghost btn-refine">Affiner</button>
        </div>
        <div class="result-buttons">
          <button type="button" class="btn-ghost btn-upscale">Upscaler HD</button>
          <button type="button" class="btn-ghost btn-save">Enregistrer</button>
          <button type="button" class="btn-primary btn-download">Télécharger</button>
        </div>
      </div>
    </div>
  `;
  grid.prepend(el);

  const card: Card = { id, kind, imageB64: '', mime: 'image/png', el };

  el.querySelector<HTMLImageElement>('.result-img')!.addEventListener('click', () => openLightbox(card));
  el.querySelector<HTMLButtonElement>('.btn-refine')!.addEventListener('click', () => {
    const input = el.querySelector<HTMLInputElement>('.refine-input')!;
    const instruction = input.value.trim();
    if (instruction) refineCard(card, instruction);
  });
  el.querySelector<HTMLInputElement>('.refine-input')!.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      const instruction = (ev.target as HTMLInputElement).value.trim();
      if (instruction) refineCard(card, instruction);
    }
  });
  el.querySelector<HTMLButtonElement>('.btn-upscale')!.addEventListener('click', () => upscaleCard(card));
  el.querySelector<HTMLButtonElement>('.btn-save')!.addEventListener('click', () => saveCard(card));
  el.querySelector<HTMLButtonElement>('.btn-download')!.addEventListener('click', () => downloadCard(card));

  return card;
}

function fillCard(card: Card, imageB64: string, mime: string) {
  card.imageB64 = imageB64;
  card.mime = mime;
  card.upscaledB64 = undefined;
  const img = card.el.querySelector<HTMLImageElement>('.result-img')!;
  img.src = `data:${mime};base64,${imageB64}`;
  img.hidden = false;
  card.el.classList.remove('loading', 'errored');
  card.el.querySelector('.result-spinner')!.remove();
  card.el.querySelector<HTMLElement>('.result-actions')!.hidden = false;
  setStatus(card, '');
}

function errorCard(card: Card, msg: string) {
  card.el.classList.remove('loading');
  card.el.classList.add('errored');
  const spinner = card.el.querySelector('.result-spinner');
  if (spinner) spinner.innerHTML = `<span class="result-error">⚠️ ${escapeHtml(msg)}</span>`;
}

async function refineCard(card: Card, instruction: string) {
  const refineBtn = card.el.querySelector<HTMLButtonElement>('.btn-refine')!;
  refineBtn.disabled = true;
  setStatus(card, 'Affinage…', true);
  try {
    const res = await enhanceRender({
      image: card.imageB64, mime: card.mime, mode: 'refine',
      instructions: instruction,
      presets: { details: $<HTMLInputElement>('p-details').value.trim() },
      size: '1K',
    });
    card.imageB64 = res.image;
    card.mime = res.mime;
    card.upscaledB64 = undefined;
    const img = card.el.querySelector<HTMLImageElement>('.result-img')!;
    img.src = `data:${res.mime};base64,${res.image}`;
    card.el.querySelector<HTMLInputElement>('.refine-input')!.value = '';
    setStatus(card, '✓ Affiné');
  } catch (err) {
    setStatus(card, `⚠️ ${(err as Error).message}`);
  } finally {
    refineBtn.disabled = false;
  }
}

async function upscaleCard(card: Card) {
  const btn = card.el.querySelector<HTMLButtonElement>('.btn-upscale')!;
  if (card.upscaledB64) { downloadCard(card); return; }
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Upscale HD…';
  setStatus(card, 'Montée en HD (2K)…', true);
  try {
    const res = await enhanceRender({
      image: card.imageB64, mime: card.mime, mode: 'upscale', size: '2K',
    });
    card.upscaledB64 = res.image;
    btn.textContent = '✓ HD prêt';
    setStatus(card, '✓ Version HD (2K) générée');
    downloadCard(card);
  } catch (err) {
    btn.textContent = original;
    btn.disabled = false;
    setStatus(card, `⚠️ ${(err as Error).message}`);
  }
}

function downloadCard(card: Card) {
  const b64 = card.upscaledB64 || card.imageB64;
  if (!b64) return;
  const suffix = card.upscaledB64 ? '2K' : '1K';
  const name = `rendu_${card.kind}_${suffix}_${card.id}.png`;
  const a = document.createElement('a');
  a.href = `data:image/png;base64,${b64}`;
  a.download = name;
  a.click();
}

async function saveCard(card: Card) {
  const btn = card.el.querySelector<HTMLButtonElement>('.btn-save')!;
  const chantierId = $<HTMLSelectElement>('p-chantier').value || null;
  btn.disabled = true;
  setStatus(card, 'Enregistrement…', true);
  try {
    await saveRender({
      imageB64: card.upscaledB64 || card.imageB64,
      kind: card.kind,
      resolution: card.upscaledB64 ? '2K' : '1K',
      presets: collectPresets(),
      chantierId,
    });
    btn.textContent = '✓ Enregistré';
    setStatus(card, '✓ Ajouté à l\'historique');
    // Recharge l'historique en respectant le filtre courant
    await renderHistory($<HTMLSelectElement>('history-filter').value || null);
  } catch (err) {
    btn.disabled = false;
    setStatus(card, `⚠️ ${(err as Error).message}`);
  }
}

function setStatus(card: Card, msg: string, busy = false) {
  const el = card.el.querySelector<HTMLElement>('.result-status')!;
  el.textContent = msg;
  el.classList.toggle('busy', busy);
}

// ── Historique enregistré ───────────────────────────────

function chantierName(id: string | null): string {
  if (!id) return 'Sans chantier';
  return chantiers.find(c => c.id === id)?.name || 'Chantier supprimé';
}

async function renderHistory(chantierId: string | null) {
  const grid = $('history-grid');
  const empty = $('history-empty');
  let records: RenderRecord[];
  try {
    records = await listRenders(chantierId);
  } catch (err) {
    empty.textContent = `Erreur : ${(err as Error).message}`;
    empty.hidden = false;
    grid.innerHTML = '';
    return;
  }

  if (records.length === 0) {
    empty.textContent = 'Aucun visuel enregistré pour l\'instant.';
    empty.hidden = false;
    grid.innerHTML = '';
    return;
  }
  empty.hidden = true;

  grid.innerHTML = records.map(r => `
    <figure class="history-item" data-id="${r.id}">
      <div class="history-thumb" data-path="${escapeAttr(r.storage_path)}">
        <span class="spinner"></span>
      </div>
      <figcaption>
        <span class="history-meta">
          <span class="result-tag tag-${r.kind}">${r.kind === 'photoreal' ? 'Photo' : 'Esquisse'}</span>
          <span class="history-res">${escapeHtml(r.resolution)}</span>
        </span>
        <span class="history-chantier">${escapeHtml(chantierName(r.chantier_id))}</span>
        <button type="button" class="history-del" title="Supprimer">×</button>
      </figcaption>
    </figure>
  `).join('');

  // Charge les vignettes via URL signée (en parallèle) et câble les actions
  for (const r of records) {
    const item = grid.querySelector<HTMLElement>(`.history-item[data-id="${r.id}"]`)!;
    const thumb = item.querySelector<HTMLElement>('.history-thumb')!;
    signedUrl(r.storage_path).then(url => {
      thumb.innerHTML = `<img src="${url}" alt="${r.kind}">`;
      thumb.style.cursor = 'zoom-in';
      thumb.addEventListener('click', () => openLightboxUrl(url));
    }).catch(() => { thumb.innerHTML = '<span class="result-error">⚠︎</span>'; });

    item.querySelector<HTMLButtonElement>('.history-del')!.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('Supprimer ce visuel enregistré ?')) return;
      try {
        await deleteRender(r);
        await renderHistory($<HTMLSelectElement>('history-filter').value || null);
      } catch (err) {
        alert(`Erreur : ${(err as Error).message}`);
      }
    });
  }
}

// ── Lightbox ────────────────────────────────────────────

function setupLightbox() {
  const lb = $('lightbox');
  $('lightbox-close').addEventListener('click', () => { lb.hidden = true; });
  lb.addEventListener('click', (e) => { if (e.target === lb) lb.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') lb.hidden = true; });
}

function openLightbox(card: Card) {
  const b64 = card.upscaledB64 || card.imageB64;
  if (!b64) return;
  openLightboxUrl(`data:image/png;base64,${b64}`);
}

function openLightboxUrl(url: string) {
  $<HTMLImageElement>('lightbox-img').src = url;
  $('lightbox').hidden = false;
}

// ── Utils ───────────────────────────────────────────────

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
