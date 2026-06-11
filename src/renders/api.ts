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
  materiaux?: string;             // matériaux confirmés (détectés, non modifiés)
  materiauxRemplacements?: string; // remplacements demandés (ex : enrobé → pavés)
  details?: string;
  realisme?: boolean; // appliqué d'office côté edge ; `false` explicite pour couper (non exposé en UI)
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

// Détection des matériaux visibles sur le rendu source (mode 'detect' → liste
// structurée, un item par poste). Le front affiche chaque poste avec un champ
// de remplacement en face (vide = on garde le matériau détecté).
export interface MaterialItem { poste: string; materiau: string }

export async function detectMaterials(image: string, mime: string): Promise<MaterialItem[]> {
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
  if (Array.isArray(json.items)) return json.items as MaterialItem[];
  // Compat : ancienne fonction qui renvoyait une seule ligne "Poste : matériau ; …"
  if (typeof json.materials === 'string') {
    return json.materials.split(';')
      .map((part: string) => {
        const [poste, ...rest] = part.split(':');
        return { poste: (poste || '').trim(), materiau: rest.join(':').trim() };
      })
      .filter((it: MaterialItem) => it.poste && it.materiau);
  }
  return [];
}
