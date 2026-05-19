// Configuration de l'application

// ── POC ngrok-free ────────────────────────────────────
// Bypasse l'interstitiel ngrok en ajoutant le header seulement aux
// requêtes vers notre propre origin — sinon on casse les CORS d'APIs
// externes (api-adresse.data.gouv.fr, apicarto.ign.fr, etc.).
if (typeof window !== 'undefined' && /\.ngrok-free\.app$/.test(window.location.hostname)) {
  const origFetch = window.fetch.bind(window);
  const sameOrigin = window.location.origin;
  window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL ? input.toString() : input.url;
    const isSameOrigin = url.startsWith('/') || url.startsWith(sameOrigin);
    if (!isSameOrigin) return origFetch(input, init);
    const headers = new Headers(init.headers || {});
    headers.set('ngrok-skip-browser-warning', 'any');
    return origFetch(input, { ...init, headers });
  };
}

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
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3aGJqYnV4YmN4c3pseGNicGpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgzOTM5NTgsImV4cCI6MjA4Mzk2OTk1OH0.za0Cg7EbcPYGlVckQf_8CNmRY9FbaDB-20OCLFZzSV0';
export const ENABLE_DATABASE = SUPABASE_URL && SUPABASE_ANON_KEY;
