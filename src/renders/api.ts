// Wrapper TypeScript pour l'edge function enhance-render.
// Amélioration IA de rendus architecturaux (admin uniquement).

import { getAuthClient } from '../auth/client';
import { SUPABASE_URL } from '../config';

const ENDPOINT = `${SUPABASE_URL}/functions/v1/enhance-render`;

export type RenderMode = 'photoreal' | 'sketch' | 'refine' | 'upscale';

export interface RenderPresets {
  heure?: string;
  intensite?: string;
  ambiance?: string;
  vegetation?: string;
  saison?: string;
  ciel?: string;
  localisation?: string;
  details?: string;
}

export interface EnhancePayload {
  image: string;        // base64 sans préfixe data:
  mime?: string;
  mode: RenderMode;
  presets?: RenderPresets;
  instructions?: string;
  size?: '1K' | '2K' | '4K';
}

export interface EnhanceResult {
  image: string;        // base64 PNG
  mime: string;
  model: string;
}

export async function enhanceRender(payload: EnhancePayload): Promise<EnhanceResult> {
  const supabase = getAuthClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('Session expirée — veuillez vous reconnecter');

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => ({ success: false, error: `HTTP ${response.status}` }));
  if (!response.ok || !json.success) {
    throw new Error(json.error || `Erreur HTTP ${response.status}`);
  }
  return { image: json.image, mime: json.mime, model: json.model };
}
