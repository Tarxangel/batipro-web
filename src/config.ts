// Configuration de l'application

// Mode maintenance: mettre à true pour afficher la page "En construction"
export const MAINTENANCE_MODE = false;

// Message affiché en mode maintenance
export const MAINTENANCE_MESSAGE = {
  titre: '🚧 Application en construction',
  sousTitre: 'Nous améliorons votre expérience',
  description: 'Notre équipe travaille actuellement sur des améliorations du système d\'analyse PLU/RNU. L\'application sera de nouveau disponible très prochainement.',
  contact: 'Pour toute urgence, contactez-nous à contact@batiproconcept.fr'
};

// Configuration Supabase
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://awhbjbuxbcxszlxcbpjb.supabase.co';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const ENABLE_DATABASE = SUPABASE_URL && SUPABASE_ANON_KEY;
