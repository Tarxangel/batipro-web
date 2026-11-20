// Dossiers de l'ERP Batipro (OCI), lus depuis le cache `oci_dossiers`.
//
// Le cache est alimenté côté serveur (Edge Function `oci-sync`) ; le navigateur
// ne parle jamais à l'ERP. L'import d'un dossier en chantier passe par la RPC
// `import_oci_dossier` (idempotente, champs repris du cache).

import { getAuthClient } from './auth/client';

export interface OciDossier {
  id: string;
  num_dossier: string;
  nom: string;
  phase: string | null;
  client_nom: string | null;
  adresse: string | null;
  code_postal: string | null;
  ville: string | null;
  responsable: string | null;
  erp_updated_at: string | null;
  synced_at: string;
}

export async function listOciDossiers(phases: string[]): Promise<OciDossier[]> {
  const { data, error } = await getAuthClient()
    .from('oci_dossiers')
    .select('*')
    .in('phase', phases)
    .order('erp_updated_at', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data as OciDossier[]) || [];
}

/** Ids des dossiers ERP déjà liés à un chantier → id du chantier. */
export async function linkedOciIds(): Promise<Map<string, string>> {
  const { data, error } = await getAuthClient()
    .from('chantiers')
    .select('id, oci_dossier_id')
    .not('oci_dossier_id', 'is', null);
  if (error) throw new Error(error.message);
  return new Map((data || []).map(r => [r.oci_dossier_id as string, r.id as string]));
}

/** Crée (ou retrouve) le chantier lié au dossier ERP. Renvoie l'id du chantier. */
export async function importOciDossier(ociId: string): Promise<{ id: string; name: string }> {
  const { data, error } = await getAuthClient().rpc('import_oci_dossier', { p_oci_id: ociId });
  if (error) throw new Error(error.message);
  return { id: data.id, name: data.name };
}

/** « il y a 12 min » à partir de la date de synchro la plus récente. */
export function formatSyncAge(dossiers: OciDossier[]): string | null {
  const last = dossiers.reduce<string | null>((m, d) => (!m || d.synced_at > m ? d.synced_at : m), null);
  if (!last) return null;
  const min = Math.round((Date.now() - new Date(last).getTime()) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h} h`;
  return `le ${new Date(last).toLocaleDateString('fr-FR')}`;
}

/** Ville ERP en capitales (« ARC ET SENANS ») → « Arc et Senans ». */
export function prettyCity(v: string | null): string {
  if (!v) return '';
  const small = new Set(['et', 'en', 'de', 'du', 'des', 'la', 'le', 'les', 'sur', 'sous', 'lès', 'lez', 'aux', 'au']);
  return v.toLowerCase().split(/(\s|-)/).map((w, i) =>
    (i > 0 && small.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)
  ).join('');
}

/** Clé de recherche insensible aux accents et à la casse. */
export function searchKey(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
