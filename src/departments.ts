// Liste complète des départements français, organisés par région
// Les régions "prioritaires" (zones habituelles Batipro) sont en tête

export interface DepartmentGroup {
  label: string;
  priority?: boolean;
  departments: { code: string; name: string }[];
}

export const DEPARTMENT_GROUPS: DepartmentGroup[] = [
  // --- Zones habituelles (prioritaires) ---
  {
    label: '★ Bourgogne Franche-Comté',
    priority: true,
    departments: [
      { code: '21', name: "Côte-d'Or" },
      { code: '25', name: 'Doubs' },
      { code: '39', name: 'Jura' },
      { code: '58', name: 'Nièvre' },
      { code: '70', name: 'Haute-Saône' },
      { code: '71', name: 'Saône-et-Loire' },
      { code: '89', name: 'Yonne' },
      { code: '90', name: 'Belfort' },
    ],
  },
  {
    label: '★ Grand-Est (Alsace)',
    priority: true,
    departments: [
      { code: '67', name: 'Bas-Rhin' },
      { code: '68', name: 'Haut-Rhin' },
    ],
  },
  {
    label: '★ Auvergne Rhône-Alpes',
    priority: true,
    departments: [
      { code: '01', name: 'Ain' },
      { code: '03', name: 'Allier' },
      { code: '07', name: 'Ardèche' },
      { code: '15', name: 'Cantal' },
      { code: '26', name: 'Drôme' },
      { code: '38', name: 'Isère' },
      { code: '42', name: 'Loire' },
      { code: '43', name: 'Haute-Loire' },
      { code: '63', name: 'Puy-de-Dôme' },
      { code: '69', name: 'Rhône' },
      { code: '73', name: 'Savoie' },
      { code: '74', name: 'Haute-Savoie' },
    ],
  },
  // --- Autres régions (ordre alphabétique) ---
  {
    label: 'Bretagne',
    departments: [
      { code: '22', name: "Côtes-d'Armor" },
      { code: '29', name: 'Finistère' },
      { code: '35', name: 'Ille-et-Vilaine' },
      { code: '56', name: 'Morbihan' },
    ],
  },
  {
    label: 'Centre-Val de Loire',
    departments: [
      { code: '18', name: 'Cher' },
      { code: '28', name: 'Eure-et-Loir' },
      { code: '36', name: 'Indre' },
      { code: '37', name: 'Indre-et-Loire' },
      { code: '41', name: 'Loir-et-Cher' },
      { code: '45', name: 'Loiret' },
    ],
  },
  {
    label: 'Corse',
    departments: [
      { code: '2A', name: 'Corse-du-Sud' },
      { code: '2B', name: 'Haute-Corse' },
    ],
  },
  {
    label: 'Grand-Est',
    departments: [
      { code: '08', name: 'Ardennes' },
      { code: '10', name: 'Aube' },
      { code: '51', name: 'Marne' },
      { code: '52', name: 'Haute-Marne' },
      { code: '54', name: 'Meurthe-et-Moselle' },
      { code: '55', name: 'Meuse' },
      { code: '57', name: 'Moselle' },
      { code: '88', name: 'Vosges' },
    ],
  },
  {
    label: 'Hauts-de-France',
    departments: [
      { code: '02', name: 'Aisne' },
      { code: '59', name: 'Nord' },
      { code: '60', name: 'Oise' },
      { code: '62', name: 'Pas-de-Calais' },
      { code: '80', name: 'Somme' },
    ],
  },
  {
    label: 'Île-de-France',
    departments: [
      { code: '75', name: 'Paris' },
      { code: '77', name: 'Seine-et-Marne' },
      { code: '78', name: 'Yvelines' },
      { code: '91', name: 'Essonne' },
      { code: '92', name: 'Hauts-de-Seine' },
      { code: '93', name: 'Seine-Saint-Denis' },
      { code: '94', name: 'Val-de-Marne' },
      { code: '95', name: "Val-d'Oise" },
    ],
  },
  {
    label: 'Normandie',
    departments: [
      { code: '14', name: 'Calvados' },
      { code: '27', name: 'Eure' },
      { code: '50', name: 'Manche' },
      { code: '61', name: 'Orne' },
      { code: '76', name: 'Seine-Maritime' },
    ],
  },
  {
    label: 'Nouvelle-Aquitaine',
    departments: [
      { code: '16', name: 'Charente' },
      { code: '17', name: 'Charente-Maritime' },
      { code: '19', name: 'Corrèze' },
      { code: '23', name: 'Creuse' },
      { code: '24', name: 'Dordogne' },
      { code: '33', name: 'Gironde' },
      { code: '40', name: 'Landes' },
      { code: '47', name: 'Lot-et-Garonne' },
      { code: '64', name: 'Pyrénées-Atlantiques' },
      { code: '79', name: 'Deux-Sèvres' },
      { code: '86', name: 'Vienne' },
      { code: '87', name: 'Haute-Vienne' },
    ],
  },
  {
    label: 'Occitanie',
    departments: [
      { code: '09', name: 'Ariège' },
      { code: '11', name: 'Aude' },
      { code: '12', name: 'Aveyron' },
      { code: '30', name: 'Gard' },
      { code: '31', name: 'Haute-Garonne' },
      { code: '32', name: 'Gers' },
      { code: '34', name: 'Hérault' },
      { code: '46', name: 'Lot' },
      { code: '48', name: 'Lozère' },
      { code: '65', name: 'Hautes-Pyrénées' },
      { code: '66', name: 'Pyrénées-Orientales' },
      { code: '81', name: 'Tarn' },
      { code: '82', name: 'Tarn-et-Garonne' },
    ],
  },
  {
    label: 'Pays de la Loire',
    departments: [
      { code: '44', name: 'Loire-Atlantique' },
      { code: '49', name: 'Maine-et-Loire' },
      { code: '53', name: 'Mayenne' },
      { code: '72', name: 'Sarthe' },
      { code: '85', name: 'Vendée' },
    ],
  },
  {
    label: "Provence-Alpes-Côte d'Azur",
    departments: [
      { code: '04', name: 'Alpes-de-Haute-Provence' },
      { code: '05', name: 'Hautes-Alpes' },
      { code: '06', name: 'Alpes-Maritimes' },
      { code: '13', name: 'Bouches-du-Rhône' },
      { code: '83', name: 'Var' },
      { code: '84', name: 'Vaucluse' },
    ],
  },
];

/**
 * Remplit un <select> avec tous les départements.
 * @param select L'élément <select> à peupler
 * @param options.placeholder Option vide en tête (ex: "--")
 * @param options.defaultValue Valeur sélectionnée par défaut
 */
export function populateDepartmentSelect(
  select: HTMLSelectElement,
  options?: { placeholder?: string; defaultValue?: string }
) {
  select.innerHTML = '';

  if (options?.placeholder) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = options.placeholder;
    select.appendChild(opt);
  }

  for (const group of DEPARTMENT_GROUPS) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;

    for (const dept of group.departments) {
      const opt = document.createElement('option');
      opt.value = dept.code;
      opt.textContent = `${dept.code} - ${dept.name}`;
      optgroup.appendChild(opt);
    }

    select.appendChild(optgroup);
  }

  if (options?.defaultValue) {
    select.value = options.defaultValue;
  }
}
