// Mémoire des rendus : chantiers, sauvegarde dans le bucket Storage "renders"
// + index dans la table render_history, et relecture par URL signée.

import { getAuthClient } from '../auth/client';
import { RenderPresets } from './api';

export interface Chantier {
  id: string;
  name: string;
  city?: string | null;
}

export interface RenderRecord {
  id: string;
  chantier_id: string | null;
  kind: 'photoreal' | 'sketch';
  storage_path: string;
  resolution: string;
  presets: RenderPresets;
  created_at: string;
}

const BUCKET = 'renders';

export async function listChantiers(): Promise<Chantier[]> {
  const sb = getAuthClient();
  const { data, error } = await sb
    .from('chantiers')
    .select('id, name, city')
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as Chantier[]) || [];
}

function base64ToBlob(b64: string, mime = 'image/png'): Blob {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export interface SaveRenderInput {
  imageB64: string;
  kind: 'photoreal' | 'sketch';
  resolution: string;
  presets: RenderPresets;
  chantierId: string | null;
}

export async function saveRender(input: SaveRenderInput): Promise<RenderRecord> {
  const sb = getAuthClient();
  const { data: userData } = await sb.auth.getUser();

  const id = crypto.randomUUID();
  const folder = input.chantierId || 'sans-chantier';
  const path = `${folder}/${id}.png`;

  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(path, base64ToBlob(input.imageB64), { contentType: 'image/png', upsert: false });
  if (upErr) throw new Error(upErr.message);

  const { data, error } = await sb
    .from('render_history')
    .insert({
      id,
      chantier_id: input.chantierId,
      kind: input.kind,
      storage_path: path,
      resolution: input.resolution,
      presets: input.presets,
      created_by: userData?.user?.id ?? null,
    })
    .select()
    .single();
  if (error) {
    // rollback du fichier si l'insert échoue
    await sb.storage.from(BUCKET).remove([path]).catch(() => {});
    throw new Error(error.message);
  }
  return data as RenderRecord;
}

export async function listRenders(chantierId?: string | null): Promise<RenderRecord[]> {
  const sb = getAuthClient();
  let q = sb.from('render_history').select('*').order('created_at', { ascending: false });
  if (chantierId) q = q.eq('chantier_id', chantierId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as RenderRecord[]) || [];
}

export async function signedUrl(path: string, expiresIn = 3600): Promise<string> {
  const sb = getAuthClient();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

export async function deleteRender(rec: RenderRecord): Promise<void> {
  const sb = getAuthClient();
  await sb.storage.from(BUCKET).remove([rec.storage_path]).catch(() => {});
  const { error } = await sb.from('render_history').delete().eq('id', rec.id);
  if (error) throw new Error(error.message);
}
