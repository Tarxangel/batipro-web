// Exports PDF + Excel d'un tableau au visuel Batipro unique.
//
// Un seul descripteur (TableSpec) alimente les deux formats, pour que l'Excel
// reprenne exactement le visuel du PDF : titre, cartouche, en-tête bleu Batipro
// texte blanc gras, cellules de catégorie grises en gras (fusionnées), bandeaux
// de section, bordures fines, texte renvoyé à la ligne.
//
// Les librairies (jspdf ≈ 350 kB, exceljs ≈ 900 kB) ne sont chargées qu'au clic
// sur un bouton d'export (import dynamique) : elles ne pèsent plus sur
// l'ouverture de la carte ou du simulateur.

// ─── Descripteur ────────────────────────────────────────────

export interface SpecCell {
  text: string;
  /** Nombre de lignes couvertes (cellule de catégorie fusionnée verticalement). */
  rowSpan?: number;
  /** Cellule de catégorie : fond gris, gras, centrée verticalement. */
  category?: boolean;
}

export type SpecRow =
  | { kind: 'band'; text: string }                 // bandeau de section pleine largeur
  | { kind: 'data'; cells: Array<SpecCell | null> } // null = couverte par un rowSpan au-dessus

export interface SpecFooter {
  title: string;
  lines: Array<[string, string]>; // [terme, définition]
}

export interface TableSpec {
  title: string;
  /** Paires [libellé, valeur] du cartouche, affichées deux par ligne. */
  cartouche: Array<[string, string]>;
  head: string[];
  /** Poids relatifs des colonnes (ex : [3, 3, 8]). */
  weights: number[];
  body: SpecRow[];
  footers?: SpecFooter[];
  /** Mention en pied (source, avertissement). */
  note?: string;
  orientation: 'portrait' | 'landscape';
  /** Nom de fichier sans extension. */
  filename: string;
}

// ─── Charte ─────────────────────────────────────────────────

const BLUE: [number, number, number] = [45, 85, 155];      // en-tête (identique au PDF historique)
const GREY: [number, number, number] = [240, 240, 240];    // cellules de catégorie
const BAND: [number, number, number] = [221, 230, 242];    // bandeaux de section
const BORDER: [number, number, number] = [190, 190, 190];

const hex = (c: [number, number, number]) =>
  c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();

// Les polices standard de jsPDF (Helvetica, encodage WinAnsi) n'ont pas les
// signes ≥ ≤ → ni l'espace fine insécable de toLocaleString('fr-FR') : ils
// sortaient en caractères parasites. On les remplace par des équivalents sûrs.
export function pdfSafe(text: string): string {
  return (text || '')
    .normalize('NFC')
    .replace(/[    ]/g, ' ')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/[→⇒]/g, '->')
    .replace(/[←]/g, '<-')
    .replace(/[‐‑‒−]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/[^\x00-\xFFŒœŠšŸŽžƒˆ˜–—‘-„†-•…‰‹›€™]/g, '');
}

function sanitizeFilename(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 120) || 'export';
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ─── PDF ────────────────────────────────────────────────────

export async function exportSpecPdf(spec: TableSpec): Promise<void> {
  const [pdfMod, atMod] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  // Selon le bundler, l'export utile est soit `default`, soit nommé : on prend
  // le premier qui est bien une fonction.
  const pickFn = <T>(...cands: unknown[]): T => {
    const f = cands.find(c => typeof c === 'function');
    if (!f) throw new Error('Librairie PDF introuvable');
    return f as T;
  };
  const jsPDF = pickFn<typeof import('jspdf').jsPDF>(
    (pdfMod as { jsPDF?: unknown }).jsPDF, (pdfMod as { default?: unknown }).default,
    ((pdfMod as { default?: { jsPDF?: unknown } }).default)?.jsPDF,
  );
  const autoTable = pickFn<typeof import('jspdf-autotable').default>(
    (atMod as { default?: unknown }).default, (atMod as { autoTable?: unknown }).autoTable,
    ((atMod as { default?: { default?: unknown } }).default)?.default,
  );

  const doc = new jsPDF({ orientation: spec.orientation, unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(pdfSafe(spec.title), pageWidth / 2, 18, { align: 'center' });

  // Cartouche : deux paires par ligne, valeurs renvoyées à la ligne si besoin
  doc.setFontSize(10);
  let y = 28;
  for (let i = 0; i < spec.cartouche.length; i += 2) {
    const pairs = spec.cartouche.slice(i, i + 2);
    let maxLines = 1;
    pairs.forEach(([label, value], j) => {
      const x = j === 0 ? margin + 4 : pageWidth / 2 + 4;
      doc.setFont('helvetica', 'bold');
      doc.text(pdfSafe(label), x, y);
      const lw = doc.getTextWidth(pdfSafe(label)) + 2;
      doc.setFont('helvetica', 'normal');
      const maxW = (j === 0 && pairs.length === 1 ? pageWidth - 2 * margin - 8 : pageWidth / 2 - margin - 8) - lw;
      const lines: string[] = doc.splitTextToSize(pdfSafe(value), Math.max(maxW, 20));
      doc.text(lines, x + lw, y);
      maxLines = Math.max(maxLines, lines.length);
    });
    y += 6 + (maxLines - 1) * 4.5;
  }

  const totalWeight = spec.weights.reduce((a, b) => a + b, 0);
  const usable = pageWidth - 2 * margin;
  const columnStyles: Record<number, { cellWidth: number }> = {};
  spec.weights.forEach((w, i) => { columnStyles[i] = { cellWidth: (usable * w) / totalWeight }; });

  type Cell = string | { content: string; rowSpan?: number; colSpan?: number; styles?: Record<string, unknown> };
  const body: Cell[][] = spec.body.map(row => {
    if (row.kind === 'band') {
      return [{
        content: pdfSafe(row.text),
        colSpan: spec.head.length,
        styles: { fontStyle: 'bold', fillColor: BAND, textColor: [30, 50, 90] },
      }];
    }
    const out: Cell[] = [];
    for (const c of row.cells) {
      if (c === null) continue; // couverte par un rowSpan
      if (c.category || c.rowSpan) {
        out.push({
          content: pdfSafe(c.text),
          rowSpan: c.rowSpan,
          styles: c.category ? { fontStyle: 'bold', valign: 'middle', fillColor: GREY } : {},
        });
      } else {
        out.push(pdfSafe(c.text));
      }
    }
    return out;
  });

  autoTable(doc, {
    startY: y + 2,
    head: [spec.head.map(pdfSafe)],
    body: body as never,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak', valign: 'top', lineColor: BORDER, lineWidth: 0.1, textColor: [20, 20, 20] },
    headStyles: { fillColor: BLUE, textColor: 255, fontStyle: 'bold', valign: 'middle' },
    columnStyles,
    margin: { left: margin, right: margin },
  });

  // Pieds : lexique, rubriques sans prescriptions…
  let fy = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 8;
  for (const f of spec.footers || []) {
    if (!f.lines.length) continue;
    autoTable(doc, {
      startY: fy,
      head: [[pdfSafe(f.title), '']],
      body: f.lines.map(([t, d]) => [pdfSafe(t), pdfSafe(d)]),
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 1.6, overflow: 'linebreak', valign: 'top', lineColor: BORDER, lineWidth: 0.1 },
      headStyles: { fillColor: BAND, textColor: [30, 50, 90], fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 38, fontStyle: 'bold' }, 1: { cellWidth: 'auto' } },
      margin: { left: margin, right: margin },
    });
    fy = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? fy) + 6;
  }

  // Note + pagination en pied de chaque page
  const pageCount = doc.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120);
    if (spec.note) doc.text(doc.splitTextToSize(pdfSafe(spec.note), pageWidth - 2 * margin - 20)[0], margin, pageHeight - 6);
    doc.text(`${p} / ${pageCount}`, pageWidth - margin, pageHeight - 6, { align: 'right' });
    doc.setTextColor(0);
  }

  doc.save(`${sanitizeFilename(spec.filename)}.pdf`);
}

// ─── Excel ──────────────────────────────────────────────────

// Hauteur de ligne estimée (Excel ne recalcule pas la hauteur des lignes dont une
// cellule est fusionnée, et LibreOffice/Numbers la calculent mal) : on la pose
// nous-mêmes d'après la longueur du texte et la largeur de colonne.
function estimateLines(text: string, widthChars: number): number {
  if (!text) return 1;
  const usable = Math.max(widthChars * 1.15, 8); // police 9 pt un peu plus étroite que la largeur nominale
  return text.split('\n').reduce((n, part) => n + Math.max(1, Math.ceil(part.length / usable)), 0);
}

export async function exportSpecXlsx(spec: TableSpec): Promise<void> {
  const mod = await import('exceljs');
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Batipro';
  wb.created = new Date();

  const ncol = spec.head.length;
  // Largeur totale ~140 caractères en paysage, ~105 en portrait (tient sur une page A4 en largeur)
  const totalChars = spec.orientation === 'landscape' ? 150 : 110;
  const totalWeight = spec.weights.reduce((a, b) => a + b, 0);
  const widths = spec.weights.map(w => Math.max(10, Math.round((totalChars * w) / totalWeight)));

  const ws = wb.addWorksheet('Analyse', {
    pageSetup: {
      paperSize: 9, // A4
      orientation: spec.orientation,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddFooter: '&L&8' + (spec.note || '').replace(/&/g, '&&') + '&R&8&P / &N' },
  });
  ws.columns = widths.map(width => ({ width }));

  const thin = { style: 'thin' as const, color: { argb: 'FF' + hex(BORDER) } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const baseFont = { name: 'Arial', size: 9 };

  // Titre
  ws.mergeCells(1, 1, 1, ncol);
  const t = ws.getCell(1, 1);
  t.value = spec.title;
  t.font = { name: 'Arial', size: 16, bold: true };
  t.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 28;

  // Cartouche (deux paires par ligne quand il y a au moins 4 colonnes)
  let r = 3;
  const pairsPerRow = ncol >= 4 ? 2 : 1;
  for (let i = 0; i < spec.cartouche.length; i += pairsPerRow) {
    const pairs = spec.cartouche.slice(i, i + pairsPerRow);
    pairs.forEach(([label, value], j) => {
      if (pairsPerRow === 1) {
        ws.getCell(r, 1).value = label;
        ws.getCell(r, 1).font = { ...baseFont, size: 10, bold: true };
        if (ncol > 2) ws.mergeCells(r, 2, r, ncol);
        ws.getCell(r, 2).value = value;
        ws.getCell(r, 2).font = { ...baseFont, size: 10 };
      } else {
        const half = Math.floor(ncol / 2);
        const c0 = j === 0 ? 1 : half + 1;
        const cEnd = j === 0 ? half : ncol;
        ws.getCell(r, c0).value = label;
        ws.getCell(r, c0).font = { ...baseFont, size: 10, bold: true };
        if (cEnd > c0 + 1) ws.mergeCells(r, c0 + 1, r, cEnd);
        ws.getCell(r, c0 + 1).value = value;
        ws.getCell(r, c0 + 1).font = { ...baseFont, size: 10 };
      }
    });
    r++;
  }
  r++;

  // En-tête du tableau
  const headRowIdx = r;
  const headRow = ws.getRow(r);
  spec.head.forEach((h, i) => {
    const c = headRow.getCell(i + 1);
    c.value = h;
    c.font = { ...baseFont, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex(BLUE) } };
    c.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    c.border = border;
  });
  headRow.height = Math.max(20, 13 * Math.max(...spec.head.map((h, i) => estimateLines(h, widths[i]))));
  r++;

  // Corps
  const lineHeight = 12; // points par ligne en Arial 9
  const pendingMerges: Array<[number, number, number, number]> = [];
  for (const row of spec.body) {
    const xr = ws.getRow(r);
    if (row.kind === 'band') {
      ws.mergeCells(r, 1, r, ncol);
      const c = xr.getCell(1);
      c.value = row.text;
      c.font = { ...baseFont, size: 10, bold: true, color: { argb: 'FF1E325A' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex(BAND) } };
      c.alignment = { vertical: 'middle' };
      for (let i = 1; i <= ncol; i++) xr.getCell(i).border = border;
      xr.height = 18;
      r++;
      continue;
    }
    let maxLines = 1;
    row.cells.forEach((cell, i) => {
      const c = xr.getCell(i + 1);
      c.border = border;
      if (cell === null) return; // fusionnée avec la cellule du dessus
      c.value = cell.text;
      c.font = { ...baseFont, bold: !!cell.category };
      c.alignment = { vertical: cell.category ? 'middle' : 'top', wrapText: true };
      if (cell.category) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex(GREY) } };
      }
      if (cell.rowSpan && cell.rowSpan > 1) {
        pendingMerges.push([r, i + 1, r + cell.rowSpan - 1, i + 1]);
      } else {
        maxLines = Math.max(maxLines, estimateLines(cell.text, widths[i]));
      }
    });
    xr.height = Math.min(409, Math.max(15, maxLines * lineHeight + 4));
    r++;
  }
  for (const [r1, c1, r2, c2] of pendingMerges) ws.mergeCells(r1, c1, r2, c2);

  // Pieds (lexique…)
  for (const f of spec.footers || []) {
    if (!f.lines.length) continue;
    r++;
    ws.mergeCells(r, 1, r, ncol);
    const h = ws.getCell(r, 1);
    h.value = f.title;
    h.font = { ...baseFont, size: 10, bold: true, color: { argb: 'FF1E325A' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex(BAND) } };
    r++;
    for (const [term, def] of f.lines) {
      ws.getCell(r, 1).value = term;
      ws.getCell(r, 1).font = { ...baseFont, bold: true };
      ws.getCell(r, 1).alignment = { vertical: 'top', wrapText: true };
      if (ncol > 2) ws.mergeCells(r, 2, r, ncol);
      ws.getCell(r, 2).value = def;
      ws.getCell(r, 2).font = baseFont;
      ws.getCell(r, 2).alignment = { vertical: 'top', wrapText: true };
      const restWidth = widths.slice(1).reduce((a, b) => a + b, 0);
      ws.getRow(r).height = Math.max(15, estimateLines(def, restWidth) * lineHeight + 3);
      r++;
    }
  }

  if (spec.note) {
    r++;
    ws.mergeCells(r, 1, r, ncol);
    const n = ws.getCell(r, 1);
    n.value = spec.note;
    n.font = { ...baseFont, size: 8, italic: true, color: { argb: 'FF777777' } };
    n.alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(r).height = 24;
  }

  // En-tête répété à l'impression + volets figés sous l'en-tête
  ws.pageSetup.printTitlesRow = `${headRowIdx}:${headRowIdx}`;
  ws.views = [{ state: 'frozen', ySplit: headRowIdx, xSplit: 0 }];

  const buf = await wb.xlsx.writeBuffer();
  triggerDownload(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${sanitizeFilename(spec.filename)}.xlsx`,
  );
}
