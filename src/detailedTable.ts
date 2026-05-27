// Module du tableau PLU détaillé (14 catégories) + exports PDF et Excel.
// Utilisé depuis resultsCard.ts quand l'utilisateur clique "Générer tableau détaillé".

import { fetchDetailedTable, DetailedTable } from './api';
import type { SavedAnalysis } from './database';
import { renderPluChatSection, attachPluChatHandlers } from './pluChat';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

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
  zonageType: 'PLU' | 'RNU';
  generatedAt: string;
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

  // Wire-up boutons export
  body.querySelector('.btn-export-pdf')?.addEventListener('click', () => {
    exportPDF(cartouche, table);
  });
  body.querySelector('.btn-export-excel')?.addEventListener('click', () => {
    exportExcel(cartouche, table);
  });

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

// ─── EXPORT PDF ─────────────────────────────────────────────

function exportPDF(cartouche: Cartouche, table: DetailedTable): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Titre
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text("ANALYSE RÈGLEMENT D'URBANISME", pageWidth / 2, 18, { align: 'center' });

  // Cartouche
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const cartoucheY = 28;
  doc.text(`Adresse : ${cartouche.commune} — Section ${cartouche.section} N° ${cartouche.numero}`, 14, cartoucheY);
  doc.text(`Type règlement : ${cartouche.zonageType}`, 14, cartoucheY + 6);
  doc.text(`Zone : ${cartouche.zone}`, 120, cartoucheY + 6);
  doc.text(`Date : ${cartouche.generatedAt}`, 14, cartoucheY + 12);

  // Tableau avec fusion de cellules par catégorie
  const rows: (string | { content: string; rowSpan: number; styles?: Record<string, unknown> })[][] = [];
  let i = 0;
  while (i < TABLE_ROWS.length) {
    const row = TABLE_ROWS[i];
    const span = countRowsInCategory(i);

    // Première ligne du groupe : on ajoute la cellule catégorie avec rowSpan
    rows.push([
      { content: row.category, rowSpan: span, styles: { fontStyle: 'bold', valign: 'middle', fillColor: [240, 240, 240] } },
      row.subCategory,
      row.value(table) || '—',
    ]);

    // Lignes suivantes du même groupe : on n'ajoute que les 2 cellules restantes
    for (let j = 1; j < span; j++) {
      const sub = TABLE_ROWS[i + j];
      rows.push([sub.subCategory, sub.value(table) || '—'] as never);
    }

    i += span;
  }

  autoTable(doc, {
    startY: cartoucheY + 18,
    head: [['Catégorie', 'Sous-rubrique', 'Règlement PLU']],
    body: rows as never,
    styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [45, 85, 155], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 38 },
      1: { cellWidth: 40 },
      2: { cellWidth: 'auto' },
    },
    margin: { left: 10, right: 10 },
  });

  const filename = `PLU_${cartouche.commune}_${cartouche.section}-${cartouche.numero}_${cartouche.generatedAt.replace(/\//g, '-')}.pdf`;
  doc.save(filename);
}

// ─── EXPORT EXCEL ───────────────────────────────────────────

function exportExcel(cartouche: Cartouche, table: DetailedTable): void {
  const wb = XLSX.utils.book_new();

  // Lignes brutes : cartouche puis tableau
  const aoa: (string | number)[][] = [];

  // En-tête
  aoa.push(["ANALYSE RÈGLEMENT D'URBANISME"]);
  aoa.push([]);
  aoa.push(['Adresse :', `${cartouche.commune} — Section ${cartouche.section} N° ${cartouche.numero}`]);
  aoa.push(['Type règlement :', cartouche.zonageType, 'Zone :', cartouche.zone]);
  aoa.push(['Date :', cartouche.generatedAt]);
  aoa.push([]);

  // Ligne d'en-tête du tableau
  aoa.push(['Catégorie', 'Sous-rubrique', 'Règlement PLU']);

  // Corps du tableau — on répète la catégorie sur chaque ligne (Excel gère moins bien les merges programmatiques).
  for (const row of TABLE_ROWS) {
    aoa.push([row.category, row.subCategory, row.value(table) || '']);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Largeurs de colonnes et wrap text
  ws['!cols'] = [
    { wch: 35 }, // Catégorie
    { wch: 40 }, // Sous-rubrique
    { wch: 80 }, // Règlement PLU
  ];

  // Merges pour le cartouche (titre sur 3 colonnes)
  ws['!merges'] = ws['!merges'] || [];
  ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } });

  // Merges pour fusionner les lignes de la même catégorie (comme dans le xlsx de référence)
  const headerRowCount = 7; // nombre de lignes avant les data (0-indexed → ligne 7 = 1ère data)
  let i = 0;
  while (i < TABLE_ROWS.length) {
    const span = countRowsInCategory(i);
    if (span > 1) {
      ws['!merges'].push({
        s: { r: headerRowCount + i, c: 0 },
        e: { r: headerRowCount + i + span - 1, c: 0 },
      });
    }
    i += span;
  }

  // Wrap text sur les cellules de contenu
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cellRef = XLSX.utils.encode_cell({ r, c });
      if (ws[cellRef]) {
        ws[cellRef].s = { alignment: { wrapText: true, vertical: 'top' } };
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, 'Urbanisme');

  const filename = `PLU_${cartouche.commune}_${cartouche.section}-${cartouche.numero}_${cartouche.generatedAt.replace(/\//g, '-')}.xlsx`;
  XLSX.writeFile(wb, filename);
}
