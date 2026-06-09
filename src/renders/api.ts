// Wrapper TypeScript pour l'edge function enhance-render.
// Amélioration IA de rendus architecturaux (admin uniquement).

import { getAuthClient } from '../auth/client';
import { SUPABASE_URL } from '../config';

const ENDPOINT = `${SUPABASE_URL}/functions/v1/enhance-render`;

export type RenderMode = 'photoreal' | 'sketch' | 'refine' | 'upscale';

export interface RenderPresets {
  heure?: string;
  intensite?: string;
  facade?: string;
  ambiance?: string;
  vegetation?: string;
  saison?: string;
  ciel?: string;
  localisation?: string;
  materiaux?: string;
  details?: string;
  realisme?: boolean;
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

// Détection des matériaux visibles sur le rendu source (mode 'detect' → texte).
// Sert à pré-remplir le champ "Matériaux" que l'utilisateur corrige ensuite.
export async function detectMaterials(image: string, mime: string): Promise<string> {
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
    body: JSON.stringify({ image, mime, mode: 'detect' }),
  });

  const json = await response.json().catch(() => ({ success: false, error: `HTTP ${response.status}` }));
  if (!response.ok || !json.success) {
    throw new Error(json.error || `Erreur HTTP ${response.status}`);
  }
  return json.materials as string;
}
