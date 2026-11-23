// Module du tableau PLU détaillé (14 catégories) + exports PDF et Excel.
// Utilisé depuis resultsCard.ts quand l'utilisateur clique "Générer tableau détaillé".

import { fetchDetailedTable, DetailedTable } from './api';
import type { SavedAnalysis } from './database';
import { renderPluChatSection, attachPluChatHandlers } from './pluChat';
import { exportSpecPdf, exportSpecXlsx, TableSpec, SpecRow } from './exports/styledTable';
import { fetchRisquesTerrain, sismiciteTexte, argilesTexte } from './georisques';

// ─── SCHEMA du tableau (14 rubriques + sous-rubriques) ─────
// L'ordre et les libellés sont calqués sur l'onglet "Urbanisme" du fichier
// de référence client (Geniferson 2024-12-05).

interface TableRow {
  category: string;           // Colonne A (catégorie principale)
  subCategory: string;        // Colonne B (sous-catégorie, vide si pas applicable)
  value: (t: DetailedTable) => string;
}

const TABLE_ROWS: TableRow[] = [
  { category: 'Documents graphiques', subCategory: '', value: t => t.documents_graphiques },
  { category: 'Occupations des sols interdites / projet', subCategory: '', value: t => t.occupations_sols_interdites },
  { category: 'PPRI', subCategory: '', value: t => t.ppri },
  { category: 'Servitudes', subCategory: '', value: t => t.servitudes },
  { category: 'Accès et voirie', subCategory: '', value: t => t.acces_voirie },

  { category: 'Réseaux', subCategory: 'Eaux Pluviales', value: t => t.reseaux.eaux_pluviales },
  { category: 'Réseaux', subCategory: 'Eaux usées', value: t => t.reseaux.eaux_usees },
  { category: 'Réseaux', subCategory: 'Eaux Industrielles', value: t => t.reseaux.eaux_industrielles },
  { category: 'Réseaux', subCategory: 'Divers', value: t => t.reseaux.divers },

  { category: 'Implantation des constructions', subCategory: 'Par rapport aux voies et emprises publiques', value: t => t.implantation.voies_emprises_publiques },
  { category: 'Implantation des constructions', subCategory: 'Par rapport aux limites séparatives', value: t => t.implantation.limites_separatives },
  { category: 'Implantation des constructions', subCategory: "L'une par rapport aux autres sur un même terrain", value: t => t.implantation.autres_sur_meme_terrain },
  { category: 'Implantation des constructions', subCategory: 'Par rapport à une zone', value: t => t.implantation.par_rapport_zone },

  { category: 'Emprise au sol', subCategory: '', value: t => t.emprise_sol },
  { category: 'Hauteur des constructions', subCategory: '', value: t => t.hauteur },

  { category: 'Aspect extérieur', subCategory: 'Matériaux', value: t => t.aspect_exterieur.materiaux },
  { category: 'Aspect extérieur', subCategory: 'Couleurs', value: t => t.aspect_exterieur.couleurs },
  { category: 'Aspect extérieur', subCategory: 'Clôtures', value: t => t.aspect_exterieur.clotures },
  { category: 'Aspect extérieur', subCategory: 'Toitures (pente)', value: t => t.aspect_exterieur.toitures },
  { category: 'Aspect extérieur', subCategory: 'Divers', value: t => t.aspect_exterieur.divers },

  { category: 'Stationnement', subCategory: '', value: t => t.stationnement },

  { category: 'Espaces libres - plantations', subCategory: '% Espaces verts', value: t => t.espaces_libres.pourcentage_espaces_verts },
  { category: 'Espaces libres - plantations', subCategory: 'Arbres', value: t => t.espaces_libres.arbres },

  { category: "Coefficient d'occupation du sol", subCategory: '', value: t => t.coefficient_occupation_sol },
  { category: 'Remarques', subCategory: '', value: t => t.remarques },
];

// Cartouche = bloc d'en-tête commun à l'écran, au PDF et à l'Excel.
interface Cartouche {
  commune: string;
  section: string;
  numero: string;
  zone: string;
  zonageType: 'PLU' | 'RNU' | 'NON_PUBLIE';
  generatedAt: string;
  /** Zone de sismicité (Géorisques), si disponible. */
  sismicite?: string | null;
  /** Exposition argiles (Géorisques), si disponible. */
  argiles?: string | null;
}

function buildCartouche(analysis: SavedAnalysis): Cartouche {
  const { parcelle, zonage } = analysis.data;
  return {
    commune: parcelle.commune,
    section: parcelle.section,
    numero: parcelle.numero,
    zone: zonage.libelle,
    zonageType: zonage.type,
    generatedAt: new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
  };
}

// ─── MODAL UI ───────────────────────────────────────────────

export async function showDetailedTableModal(analysis: SavedAnalysis): Promise<void> {
  if (!analysis.id) {
    alert('Cette analyse doit d\'abord être sauvegardée.');
    return;
  }

  // Afficher modal de chargement
  const modal = document.createElement('div');
  modal.className = 'detailed-modal loading';
  modal.innerHTML = `
    <div class="detailed-modal-content">
      <div class="detailed-modal-header">
        <h2>📋 Tableau réglementaire détaillé</h2>
        <button class="detailed-modal-close" aria-label="Fermer">×</button>
      </div>
      <div class="detailed-modal-body">
        <div class="detailed-loading">
          <div class="spinner"></div>
          <p>Extraction détaillée du règlement en cours…</p>
          <p class="loading-hint">20 à 60 secondes selon la taille du PLU.</p>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  setTimeout(() => modal.classList.add('visible'), 10);

  const closeBtn = modal.querySelector('.detailed-modal-close') as HTMLButtonElement;
  const closeModal = () => {
    modal.classList.remove('visible');
    setTimeout(() => modal.remove(), 250);
  };
  closeBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // Fetch (ou cache DB → cache edge function)
  let table: DetailedTable;
  try {
    // Si déjà cachée côté DB, pas besoin de rappeler l'edge function
    if (analysis.data.detailed_table) {
      console.log('✅ Tableau détaillé déjà en cache DB');
      table = analysis.data.detailed_table;
    } else {
      table = await fetchDetailedTable(analysis.id);
      // Mettre à jour l'objet analyse en mémoire pour les prochaines ouvertures de session
      analysis.data.detailed_table = table;
    }
  } catch (err) {
    const body = modal.querySelector('.detailed-modal-body') as HTMLDivElement;
    body.innerHTML = `
      <div class="detailed-error">
        <p>❌ Échec de la génération du tableau détaillé.</p>
        <p class="error-detail">${(err as Error).message}</p>
        <button class="btn-retry">Réessayer</button>
      </div>
    `;
    body.querySelector('.btn-retry')?.addEventListener('click', () => {
      modal.remove();
      showDetailedTableModal(analysis);
    });
    return;
  }

  // Render tableau + section chat IA
  const cartouche = buildCartouche(analysis);
  const body = modal.querySelector('.detailed-modal-body') as HTMLDivElement;
  body.innerHTML = renderTableHTML(cartouche, table) + renderPluChatSection();
  modal.classList.remove('loading');

  // Sismicité / argiles dans le cartouche (écran + exports). Chargé après coup
  // et sans bloquer : en cas d'échec Géorisques, le cartouche reste tel quel.
  const { latitude, longitude } = analysis.data;
  if (latitude != null && longitude != null) {
    fetchRisquesTerrain(latitude, longitude).then(r => {
      if (!r) return;
      cartouche.sismicite = sismiciteTexte(r);
      cartouche.argiles = argilesTexte(r);
      const grid = body.querySelector('.cartouche-grid');
      if (grid && cartouche.sismicite) {
        grid.insertAdjacentHTML('beforeend', `<div><strong>Sismicité :</strong> ${escapeHtml(cartouche.sismicite)}</div>`);
      }
    });
  }

  // Wire-up boutons export (librairies chargées au clic)
  wireExportButton(body.querySelector('.btn-export-pdf'), () => exportSpecPdf(buildSpec(cartouche, table)));
  wireExportButton(body.querySelector('.btn-export-excel'), () => exportSpecXlsx(buildSpec(cartouche, table)));

  // Wire-up chat IA (l'historique vit dans data-attributes du panneau, vidé à chaque ouverture)
  attachPluChatHandlers(body, analysis.id);
}

function renderTableHTML(cartouche: Cartouche, table: DetailedTable): string {
  const rowsHtml = TABLE_ROWS.map((row, i) => {
    // Merge de la catégorie : on affiche la cellule catégorie seulement sur la 1ère ligne du groupe.
    const prevCategory = i > 0 ? TABLE_ROWS[i - 1].category : '';
    const isFirstOfCategory = row.category !== prevCategory;
    const categoryCell = isFirstOfCategory
      ? `<td class="col-category" rowspan="${countRowsInCategory(i)}">${escapeHtml(row.category)}</td>`
      : '';
    const subCell = `<td class="col-sub">${escapeHtml(row.subCategory)}</td>`;
    const valueCell = `<td class="col-value">${escapeHtml(row.value(table)) || '<em>—</em>'}</td>`;
    return `<tr>${categoryCell}${subCell}${valueCell}</tr>`;
  }).join('');

  return `
    <div class="detailed-cartouche">
      <h3>ANALYSE RÈGLEMENT D'URBANISME</h3>
      <div class="cartouche-grid">
        <div><strong>Adresse :</strong> ${escapeHtml(cartouche.commune)} — Section ${escapeHtml(cartouche.section)} N° ${escapeHtml(cartouche.numero)}</div>
        <div><strong>Type règlement :</strong> ${escapeHtml(cartouche.zonageType)}</div>
        <div><strong>Zone :</strong> ${escapeHtml(cartouche.zone)}</div>
        <div><strong>Date :</strong> ${escapeHtml(cartouche.generatedAt)}</div>
      </div>
    </div>
    <div class="detailed-actions">
      <button class="btn-export-pdf">📥 Télécharger PDF</button>
      <button class="btn-export-excel">📊 Télécharger Excel</button>
    </div>
    <div class="detailed-table-wrapper">
      <table class="detailed-table">
        <thead>
          <tr>
            <th class="col-category">Catégorie</th>
            <th class="col-sub">Sous-rubrique</th>
            <th class="col-value">Règlement PLU</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

function countRowsInCategory(startIdx: number): number {
  const cat = TABLE_ROWS[startIdx].category;
  let count = 1;
  for (let i = startIdx + 1; i < TABLE_ROWS.length; i++) {
    if (TABLE_ROWS[i].category === cat) count++;
    else break;
  }
  return count;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML.replace(/\n/g, '<br>');
}

// ─── EXPORTS PDF / EXCEL (visuel commun) ─────────────────────

// Bouton d'export : état « en cours » pendant le chargement de la librairie et
// la génération, message clair en cas d'échec.
function wireExportButton(btn: Element | null, run: () => Promise<void>): void {
  if (!btn) return;
  const b = btn as HTMLButtonElement;
  b.addEventListener('click', async () => {
    const label = b.textContent;
    b.disabled = true;
    b.textContent = '⏳ Préparation…';
    try {
      await run();
    } catch (err) {
      console.error('Export échoué:', err);
      alert(`Export impossible : ${(err as Error).message}`);
    } finally {
      b.disabled = false;
      b.textContent = label;
    }
  });
}

function buildSpec(cartouche: Cartouche, table: DetailedTable): TableSpec {
  const body: SpecRow[] = [];
  let i = 0;
  while (i < TABLE_ROWS.length) {
    const span = countRowsInCategory(i);
    for (let j = 0; j < span; j++) {
      const row = TABLE_ROWS[i + j];
      body.push({
        kind: 'data',
        cells: [
          j === 0 ? { text: row.category, rowSpan: span, category: true } : null,
          { text: row.subCategory },
          { text: row.value(table) || '—' },
        ],
      });
    }
    i += span;
  }

  const cart: Array<[string, string]> = [
    ['Adresse :', `${cartouche.commune} — Section ${cartouche.section} N° ${cartouche.numero}`],
    ['Zone :', cartouche.zone],
    ['Type règlement :', cartouche.zonageType],
    ['Date :', cartouche.generatedAt],
  ];
  if (cartouche.sismicite) cart.push(['Sismicité :', cartouche.sismicite]);
  if (cartouche.argiles) cart.push(['Argiles :', cartouche.argiles]);

  return {
    title: "ANALYSE RÈGLEMENT D'URBANISME",
    cartouche: cart,
    head: ['Catégorie', 'Sous-rubrique', 'Règlement PLU'],
    weights: [3.4, 3.6, 10],
    body,
    note: 'Analyse générée par IA à partir du règlement — à vérifier sur le document d\'urbanisme opposable.',
    orientation: 'portrait',
    filename: `PLU_${cartouche.commune}_${cartouche.section}-${cartouche.numero}_${cartouche.generatedAt.replace(/\//g, '-')}`,
  };
}
