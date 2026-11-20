// Simulateur ICPE — lexique des sigles + exports PDF / Excel au visuel Batipro.
//
// Le simulateur (icpe/simulateur.html) est un script inline classique : ce
// module expose ses fonctions sur `window.icpeTools`. Le script inline lui
// passe les données déjà calculées (rubriques, régimes, prescriptions) — aucune
// logique métier n'est dupliquée ici.

import { exportSpecPdf, exportSpecXlsx, TableSpec, SpecRow } from '../exports/styledTable';

// ─── Lexique ────────────────────────────────────────────────
// Définitions fixes (pas d'IA) des sigles qu'on retrouve dans les arrêtés types.
// Seuls les termes réellement présents dans le tableau sont affichés.

interface GlossaryEntry { term: string; re: RegExp; def: string }

const GLOSSARY: GlossaryEntry[] = [
  { term: 'R 15 / R 60 / R 120…', re: /\bR\s?(15|30|60|90|120|180|240)\b/, def: 'Stabilité au feu (résistance mécanique) de la structure pendant 15, 30, 60, 120… minutes.' },
  { term: 'E 30 / E 60…', re: /\bE\s?(15|30|60|90|120)\b/, def: 'Étanchéité au feu : l\'élément empêche le passage des flammes et des gaz chauds pendant la durée indiquée (minutes).' },
  { term: 'EI 60 / EI 120…', re: /\bEI\s?(15|30|60|90|120|240)\b/, def: 'Étanchéité + isolation thermique pendant la durée indiquée : élément « coupe-feu » non porteur.' },
  { term: 'REI 60 / REI 120…', re: /\bREI\s?\d+/, def: 'Résistance mécanique + étanchéité + isolation pendant la durée indiquée : mur ou plancher coupe-feu porteur (ex : mur séparatif entre cellules).' },
  { term: 'EI2 … C / C2', re: /\bEI2\s?\d+|\bC2\b/, def: 'Porte coupe-feu : « EI2 120 » = coupe-feu 2 h (classe d\'isolation 2), « C » = munie d\'un dispositif de fermeture automatique, « C2 » = classe d\'endurance de ce dispositif.' },
  { term: 'A1, A2 s1 d0, B s1 d0…', re: /\b(A1|A2|B)[\s-]?s\d[\s,-]?d\d|\bA2\b|\bA1\b/, def: 'Euroclasses de réaction au feu des matériaux : A1 incombustible, A2 combustibilité très limitée, B très peu combustible ; s1 = très peu de fumée ; d0 = aucune gouttelette enflammée.' },
  { term: 'BROOF (t3)', re: /\bB\s?ROOF|\bBroof/i, def: 'Classement de comportement au feu extérieur d\'une toiture (essai t3 : feu, vent et rayonnement) : la couverture ne propage pas le feu.' },
  { term: 'Flux 3 / 5 / 8 kW/m²', re: /kW\s?\/\s?m\s?[2²]/i, def: 'Seuils de flux thermique d\'un incendie : 3 kW/m² = effets irréversibles sur l\'homme, 5 kW/m² = premiers effets létaux, 8 kW/m² = effets létaux significatifs et effets domino sur les structures.' },
  { term: 'FLUMILOG', re: /FLUMILOG/i, def: 'Méthode de calcul (INERIS/CNPP) des flux thermiques d\'un incendie d\'entrepôt : elle donne les distances d\'effets à reporter autour des cellules.' },
  { term: 'D9', re: /\bD9\b(?!\s?A)/, def: 'Guide technique de dimensionnement des besoins en eau pour la défense extérieure contre l\'incendie (débit et durée).' },
  { term: 'D9A', re: /\bD9\s?A\b/i, def: 'Guide technique de dimensionnement du volume de rétention des eaux d\'extinction d\'incendie.' },
  { term: 'Cellule', re: /\bcellules?\b/i, def: 'Partie d\'un entrepôt séparée des autres par des murs coupe-feu (REI) : c\'est l\'unité de compartimentage, limitée en surface.' },
  { term: 'Canton de désenfumage', re: /\bcantons?\b|cantonnement/i, def: 'Volume sous toiture délimité par des écrans de cantonnement, qui retient les fumées pour qu\'elles soient évacuées par les exutoires de ce canton.' },
  { term: 'Exutoire / DENFC', re: /exutoires?|DENFC/i, def: 'Dispositif d\'évacuation naturelle des fumées et de la chaleur, en toiture, à ouverture automatique et manuelle.' },
  { term: 'Surface utile (SUE)', re: /surface utile|\bSUE\b/i, def: 'Surface d\'ouverture aérodynamique réelle des exutoires (et non leur surface géométrique).' },
  { term: 'RIA', re: /\bRIA\b/, def: 'Robinet d\'incendie armé : tuyau semi-rigide sur dévidoir, raccordé au réseau d\'eau, pour une première intervention.' },
  { term: 'Extinction automatique / sprinkler', re: /sprinkl|extinction automatique/i, def: 'Réseau de têtes d\'extinction qui s\'ouvrent automatiquement sous l\'effet de la chaleur ; sa présence permet souvent des cellules plus grandes ou des distances réduites.' },
  { term: 'Colonne sèche', re: /colonnes? s[eè]ches?/i, def: 'Canalisation vide installée dans le bâtiment, que les pompiers alimentent depuis l\'extérieur pour disposer d\'eau aux étages.' },
  { term: 'Voie engins / aire de mise en station', re: /voie engins?|mise en station|moyens a[eé]riens/i, def: 'Voie de circulation des véhicules de secours autour du bâtiment, et aires où les échelles aériennes se positionnent devant les façades.' },
  { term: 'Point d\'eau incendie (PEI / DECI)', re: /\bPEI\b|\bDECI\b|poteaux? incendie|points? d['’]eau/i, def: 'Poteaux, bouches ou réserves utilisés par les pompiers ; la DECI fixe leur nombre, débit et distance au bâtiment.' },
  { term: 'Rétention / confinement', re: /r[eé]tention|confinement/i, def: 'Volume (bassin, cuvette, quais) qui retient les eaux d\'extinction et les liquides répandus pour qu\'ils ne polluent pas le milieu naturel.' },
  { term: 'QMNA5', re: /QMNA\s?5/i, def: 'Débit d\'étiage de référence du cours d\'eau récepteur (débit mensuel minimal de fréquence quinquennale), qui plafonne les rejets.' },
  { term: 'MES / DCO / DBO5', re: /\bMES\b|\bDCO\b|\bDBO\s?5\b/, def: 'Paramètres de qualité des rejets d\'eaux : matières en suspension, demande chimique et biochimique (5 jours) en oxygène.' },
  { term: 'ERP / IGH', re: /\bERP\b|\bIGH\b/, def: 'Établissement recevant du public / immeuble de grande hauteur : tiers sensibles dont il faut éloigner les effets d\'un incendie.' },
  { term: 'ATEX', re: /\bATEX\b|atmosph[eè]res? explosi/i, def: 'Atmosphère explosive : zones où gaz, vapeurs ou poussières peuvent former un mélange explosif, avec matériel électrique adapté.' },
  { term: 'Plan de défense incendie', re: /plan de d[eé]fense incendie|\bPDI\b/i, def: 'Document de l\'exploitant décrivant l\'organisation et les moyens de lutte contre l\'incendie, tenu à disposition des secours.' },
  { term: 'Arrêté préfectoral', re: /arr[eê]t[eé] pr[eé]fectoral/i, def: 'En Autorisation, les prescriptions sont fixées au cas par cas par le préfet, sur la base de l\'étude de dangers du dossier.' },
];

/** Termes du lexique présents dans les textes fournis, dans l'ordre du lexique. */
export function glossaryFor(texts: string[]): Array<[string, string]> {
  const all = texts.join('\n');
  return GLOSSARY.filter(g => g.re.test(all)).map(g => [g.term, g.def]);
}

// ─── Exports ────────────────────────────────────────────────

export interface IcpeExportPayload {
  projet: { nom: string; client: string; localisation: string; date: string };
  /** Une colonne par rubrique avec prescriptions. */
  colonnes: Array<{ code: string; regime: string; intitule: string }>;
  categories: Array<{ label: string; rows: Array<{ item: string; values: string[] }> }>;
  /** Rubriques sélectionnées sans prescriptions détaillées. */
  sansPrescriptions: Array<{ code: string; intitule: string; regime: string }>;
}

function buildSpec(p: IcpeExportPayload): TableSpec {
  const body: SpecRow[] = [];
  for (const cat of p.categories) {
    body.push({ kind: 'band', text: cat.label });
    for (const row of cat.rows) {
      body.push({ kind: 'data', cells: [{ text: row.item, category: true }, ...row.values.map(v => ({ text: v || '-' }))] });
    }
  }

  const allValues = p.categories.flatMap(c => c.rows.flatMap(r => r.values));
  const cart: Array<[string, string]> = [];
  if (p.projet.nom) cart.push(['Projet :', p.projet.nom]);
  if (p.projet.client) cart.push(['Client :', p.projet.client]);
  if (p.projet.localisation) cart.push(['Localisation :', p.projet.localisation]);
  cart.push(['Date :', p.projet.date]);
  cart.push(['Rubriques :', p.colonnes.map(c => `${c.code} (${c.regime})`).join(', ') || '—']);

  const footers = [
    {
      title: 'Rubriques',
      lines: p.colonnes.map(c => [`${c.code} — ${c.regime}`, c.intitule] as [string, string]),
    },
    {
      title: 'Rubriques sans prescriptions détaillées',
      lines: p.sansPrescriptions.map(r => [`${r.code} — ${r.regime}`, `${r.intitule} : consulter la fiche AIDA.`] as [string, string]),
    },
    { title: 'Lexique', lines: glossaryFor(allValues) },
  ];

  const n = p.colonnes.length;
  return {
    title: 'ANALYSE ICPE — PRESCRIPTIONS TECHNIQUES',
    cartouche: cart,
    head: ['Thème', ...p.colonnes.map(c => `Rubrique ${c.code} — ${c.regime}`)],
    weights: [2.4, ...p.colonnes.map(() => (n <= 1 ? 9 : n === 2 ? 6 : 4.5))],
    body,
    footers,
    note: 'Prescriptions extraites par IA des arrêtés ministériels (AIDA / INERIS) — à vérifier sur les textes officiels avant application.',
    orientation: n >= 2 ? 'landscape' : 'portrait',
    filename: `ICPE_${p.projet.nom || 'projet'}_${p.projet.date.replace(/\//g, '-')}`,
  };
}

async function runExport(btn: HTMLButtonElement | null, fn: () => Promise<void>): Promise<void> {
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Préparation…'; }
  try {
    await fn();
  } catch (err) {
    console.error('Export ICPE échoué:', err);
    alert(`Export impossible : ${(err as Error).message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label ?? ''; }
  }
}

declare global {
  interface Window {
    icpeTools?: {
      glossaryFor: typeof glossaryFor;
      exportPdf: (p: IcpeExportPayload, btn?: HTMLButtonElement | null) => Promise<void>;
      exportXlsx: (p: IcpeExportPayload, btn?: HTMLButtonElement | null) => Promise<void>;
    };
  }
}

window.icpeTools = {
  glossaryFor,
  exportPdf: (p, btn) => runExport(btn ?? null, () => exportSpecPdf(buildSpec(p))),
  exportXlsx: (p, btn) => runExport(btn ?? null, () => exportSpecXlsx(buildSpec(p))),
};
