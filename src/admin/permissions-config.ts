// Définition centralisée des modules et actions disponibles
// pour les permissions utilisateur. Sert à construire la
// matrice de checkboxes dans le formulaire admin et à afficher
// le résumé des permissions dans la liste.

export interface ModuleDef {
  key: string;
  label: string;
  actions: ActionDef[];
}

export interface ActionDef {
  key: string;
  label: string;
}

export const MODULES: ModuleDef[] = [
  {
    key: 'articles',
    label: 'Articles chantier',
    actions: [
      { key: 'read',    label: 'Voir' },
      { key: 'create',  label: 'Créer' },
      { key: 'edit',    label: 'Modifier' },
      { key: 'publish', label: 'Publier' },
      { key: 'delete',  label: 'Supprimer' },
    ],
  },
  {
    key: 'chantiers',
    label: 'Chantiers',
    actions: [
      { key: 'read',   label: 'Voir' },
      { key: 'create', label: 'Créer' },
      { key: 'edit',   label: 'Modifier' },
      { key: 'delete', label: 'Supprimer' },
    ],
  },
  {
    key: 'icpe',
    label: 'ICPE (carte + simulateur)',
    actions: [
      { key: 'read', label: 'Accéder' },
    ],
  },
  {
    key: 'map',
    label: 'Batipro Map (PLU/RNU)',
    actions: [
      { key: 'read', label: 'Accéder' },
    ],
  },
  {
    key: 'renders',
    label: 'Rendus IA',
    actions: [
      { key: 'read', label: 'Accéder' },
    ],
  },
  {
    key: 'feedback',
    label: 'Tickets SAV',
    actions: [
      { key: 'read',    label: 'Voir' },
      { key: 'resolve', label: 'Traiter' },
    ],
  },
];

// Helpers d'affichage
export function summarizePermissions(perms: Record<string, string[]>): string {
  const parts: string[] = [];
  for (const mod of MODULES) {
    const actions = perms[mod.key];
    if (Array.isArray(actions) && actions.length > 0) {
      parts.push(`${mod.label} (${actions.length})`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : 'Aucune permission';
}
