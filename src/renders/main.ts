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
import { enhanceRender, detectMaterials, RenderPresets, MaterialItem } from './api';
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
let detectedMaterials: MaterialItem[] = []; // postes détectés (lignes structurées)

interface Card {
  id: number;
  kind: 'photoreal' | 'sketch';
  imageB64: string;       // sortie IA brute (sans filigrane) — sert de source aux refine/esquisse
  mime: string;
  stampedB64?: string;    // version avec le vrai logo Batipro incrusté (affichage/téléchargement/save)
  upscaledB64?: string;
  el: HTMLElement;
}

// ── Filigrane Batipro (vrai logo, incrusté par canvas) ──
// L'IA reçoit l'instruction de RETIRER le filigrane source ; on réappose ici le
// logo officiel + mention de propriété — déterministe, jamais redessiné par l'IA.
// Mise en page calquée sur les exports Lumion Batipro : bandeau sombre pleine
// largeur en pied d'image, logo collé au coin bas-gauche débordant au-dessus.
const WATERMARK_LOGO_URL = '/branding/batipro-logo.svg';
const WATERMARK_TEXT = 'Ce document est la propriété exclusive de la SAS Batipro Concept. Il ne peut être reproduit et/ou utilisé sans autorisation express.';

let watermarkLogo: HTMLImageElement | null = null;
function loadWatermarkLogo(): Promise<HTMLImageElement | null> {
  if (watermarkLogo) return Promise.resolve(watermarkLogo);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { watermarkLogo = img; resolve(img); };
    img.onerror = () => resolve(null); // sans logo on n'empêche pas la génération
    img.src = WATERMARK_LOGO_URL;
  });
}

// Incruste bandeau sombre pleine largeur + logo coin bas-gauche + mention de
// propriété (même mise en page que les exports Lumion Batipro). Renvoie le
// base64 PNG filigrané ; en cas de pépin, renvoie l'image brute (pas de blocage).
async function applyWatermark(imageB64: string, mime: string): Promise<string> {
  try {
    const logo = await loadWatermarkLogo();
    if (!logo) return imageB64;

    const src = new Image();
    await new Promise<void>((resolve, reject) => {
      src.onload = () => resolve();
      src.onerror = reject;
      src.src = `data:${mime};base64,${imageB64}`;
    });

    const canvas = document.createElement('canvas');
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(src, 0, 0);

    // Proportions relevées sur un export Lumion réel (2560x1440) :
    // bandeau ≈ 2,6 % de la hauteur, logo ≈ 9 % collé au coin bas-gauche.
    const W = canvas.width;
    const H = canvas.height;
    const bandH = Math.round(H * 0.026);
    const logoH = Math.round(H * 0.092);
    const logoW = Math.round(logoH * (logo.width / logo.height));

    ctx.fillStyle = 'rgba(15, 15, 15, 0.78)';
    ctx.fillRect(0, H - bandH, W, bandH);

    ctx.drawImage(logo, 0, H - logoH, logoW, logoH);

    const fontSize = Math.max(9, Math.round(bandH * 0.5));
    ctx.font = `400 ${fontSize}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(WATERMARK_TEXT, logoW + Math.round(bandH * 0.45), H - bandH / 2);

    return canvas.toDataURL('image/png').split(',')[1];
  } catch {
    return imageB64;
  }
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
  loadWatermarkLogo(); // précharge le logo officiel pour l'incrustation
  $<HTMLFormElement>('presets-form').addEventListener('submit', handleGenerate);
  $<HTMLButtonElement>('btn-detect-materials').addEventListener('click', handleDetectMaterials);

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
  resetMaterialRows(); // les matériaux détectés ne valent que pour l'image courante

  // UI
  const preview = $<HTMLImageElement>('source-preview');
  preview.src = resized;
  preview.hidden = false;
  $('dropzone-empty').hidden = true;
  $<HTMLButtonElement>('btn-change-image').hidden = false;
  $<HTMLButtonElement>('btn-generate').disabled = false;
  $<HTMLButtonElement>('btn-detect-materials').disabled = false;
}

// Détecte les matériaux du rendu source et affiche une ligne par poste, avec un
// champ de remplacement en face : vide = on garde le matériau détecté, rempli =
// on demande le remplacement (ex : enrobé → pavés).
async function handleDetectMaterials() {
  if (!sourceB64) return;
  const btn = $<HTMLButtonElement>('btn-detect-materials');
  const field = $<HTMLTextAreaElement>('p-materiaux');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Analyse…';
  try {
    const items = await detectMaterials(sourceB64, sourceMime);
    renderMaterialRows(items);
  } catch (err) {
    field.placeholder = `Échec détection : ${(err as Error).message}`;
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}

function renderMaterialRows(items: MaterialItem[]) {
  detectedMaterials = items;
  const rows = $('materials-rows');
  const textarea = $<HTMLTextAreaElement>('p-materiaux');
  if (!items.length) {
    resetMaterialRows();
    textarea.placeholder = 'Aucun matériau détecté — décrivez-les ici si besoin';
    return;
  }
  rows.innerHTML = items.map((it, i) => `
    <div class="material-row">
      <span class="material-poste">${escapeHtml(it.poste)}</span>
      <span class="material-detected" title="${escapeAttr(it.materiau)}">${escapeHtml(it.materiau)}</span>
      <input type="text" class="material-override" data-idx="${i}" placeholder="Remplacer par…">
    </div>
  `).join('') + `
    <p class="materials-hint">Laissez vide pour garder le matériau détecté ; tapez pour le remplacer (ex : enrobé → pavés).</p>`;
  rows.hidden = false;
  textarea.hidden = true; // les lignes structurées remplacent le champ libre
}

function resetMaterialRows() {
  detectedMaterials = [];
  const rows = $('materials-rows');
  rows.innerHTML = '';
  rows.hidden = true;
  $<HTMLTextAreaElement>('p-materiaux').hidden = false;
}

// Fusionne détection + saisies : les postes non modifiés deviennent les matériaux
// "confirmés" (autorité sur la perception du modèle), les postes remplis deviennent
// des demandes de remplacement explicites.
function collectMaterials(): { materiaux: string; materiauxRemplacements: string } {
  if (!detectedMaterials.length) {
    return {
      materiaux: $<HTMLTextAreaElement>('p-materiaux').value.trim(),
      materiauxRemplacements: '',
    };
  }
  const overrides = Array.from(
    $('materials-rows').querySelectorAll<HTMLInputElement>('.material-override'));
  const confirmed: string[] = [];
  const replacements: string[] = [];
  detectedMaterials.forEach((it, i) => {
    const wanted = overrides[i]?.value.trim();
    if (wanted && wanted.toLowerCase() !== it.materiau.toLowerCase()) {
      replacements.push(`${it.poste} : remplacer « ${it.materiau} » par « ${wanted} »`);
    } else {
      confirmed.push(`${it.poste} : ${it.materiau}`);
    }
  });
  return {
    materiaux: confirmed.join(' ; '),
    materiauxRemplacements: replacements.join(' ; '),
  };
}

// ── Génération ──────────────────────────────────────────

function collectPresets(): RenderPresets {
  const v = (id: string) => $<HTMLSelectElement>(id).value;
  const { materiaux, materiauxRemplacements } = collectMaterials();
  return {
    heure: v('p-heure'),
    intensite: v('p-intensite'),
    facade: v('p-facade'),
    ambiance: v('p-ambiance'),
    vegetation: v('p-vegetation'),
    saison: v('p-saison'),
    ciel: v('p-ciel'),
    localisation: $<HTMLInputElement>('p-localisation').value.trim(),
    materiaux,
    materiauxRemplacements,
    details: $<HTMLInputElement>('p-details').value.trim(),
    // réalisme photo : comportement de base côté edge function, plus d'option UI
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
  btn.textContent = 'Génération HD…';
  $('results-empty').hidden = true;

  // Séquentiel : limite la charge simultanée (VM + OpenAI).
  for (const kind of kinds) {
    const card = createCard(kind);
    try {
      const res = await enhanceRender({
        image: sourceB64, mime: sourceMime, mode: kind, presets,
      });
      await fillCard(card, res.image, res.mime);
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
      <div class="result-spinner"><span class="spinner"></span><span>Génération HD (~1-2 min)…</span></div>
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
          ${kind === 'photoreal' ? '<button type="button" class="btn-ghost btn-sketch-from">🎨 Esquisse de ce rendu</button>' : ''}
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
  el.querySelector<HTMLButtonElement>('.btn-save')!.addEventListener('click', () => saveCard(card));
  el.querySelector<HTMLButtonElement>('.btn-download')!.addEventListener('click', () => downloadCard(card));
  el.querySelector<HTMLButtonElement>('.btn-sketch-from')?.addEventListener('click', () => sketchFromCard(card));

  return card;
}

// Retour Sébastien : l'esquisse aquarelle rend mieux quand elle part du rendu
// photoréaliste VALIDÉ (et affiné/upscalé) plutôt que du Lumion brut. Ce bouton
// envoie l'image courante de la carte photo comme source d'une nouvelle esquisse.
async function sketchFromCard(card: Card) {
  const btn = card.el.querySelector<HTMLButtonElement>('.btn-sketch-from')!;
  btn.disabled = true;
  setStatus(card, 'Esquisse en cours…', true);
  const sketchCard = createCard('sketch');
  try {
    const res = await enhanceRender({
      image: card.upscaledB64 || card.imageB64,
      mime: card.mime,
      mode: 'sketch',
      presets: collectPresets(),
    });
    await fillCard(sketchCard, res.image, res.mime);
    setStatus(card, '✓ Esquisse générée');
  } catch (err) {
    errorCard(sketchCard, (err as Error).message);
    setStatus(card, `⚠️ ${(err as Error).message}`);
  } finally {
    btn.disabled = false;
  }
}

async function fillCard(card: Card, imageB64: string, mime: string) {
  card.imageB64 = imageB64;
  card.mime = mime;
  card.upscaledB64 = undefined;
  card.stampedB64 = await applyWatermark(imageB64, mime);
  const img = card.el.querySelector<HTMLImageElement>('.result-img')!;
  img.src = `data:image/png;base64,${card.stampedB64}`;
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
    });
    card.imageB64 = res.image;
    card.mime = res.mime;
    card.upscaledB64 = undefined;
    card.stampedB64 = await applyWatermark(res.image, res.mime);
    const img = card.el.querySelector<HTMLImageElement>('.result-img')!;
    img.src = `data:image/png;base64,${card.stampedB64}`;
    card.el.querySelector<HTMLInputElement>('.refine-input')!.value = '';
    setStatus(card, '✓ Affiné');
  } catch (err) {
    setStatus(card, `⚠️ ${(err as Error).message}`);
  } finally {
    refineBtn.disabled = false;
  }
}

function downloadCard(card: Card) {
  const b64 = card.upscaledB64 || card.stampedB64 || card.imageB64;
  if (!b64) return;
  const suffix = card.upscaledB64 ? '4K' : 'HD';
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
      imageB64: card.upscaledB64 || card.stampedB64 || card.imageB64,
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
  const b64 = card.upscaledB64 || card.stampedB64 || card.imageB64;
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
