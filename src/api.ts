// API pour communiquer avec le backend Supabase Edge Function

import { SUPABASE_URL } from './config';

const ANALYZE_PLU_URL = `${SUPABASE_URL}/functions/v1/analyze-plu`;
const ANALYZE_PLU_DETAILED_URL = `${SUPABASE_URL}/functions/v1/analyze-plu-detailed`;

export interface AnalysePLURequest {
  latitude: number;
  longitude: number;
}

export interface ParcelleDonnees {
  commune: string;
  section: string;
  numero: string;
  surface: number;
  url_geoportail: string;
}

export interface ZonageDonnees {
  type: 'PLU' | 'RNU';
  libelle: string;
  url_document: string | null;
}

export interface AnalyseDonnees {
  texte: string;
  source: string;
}

export interface AnalysePLUResponse {
  id?: string; // ID de l'analyse sauvegardée (si provient de la DB)
  success: boolean;
  data: {
    parcelle: ParcelleDonnees;
    zonage: ZonageDonnees;
    analyse: AnalyseDonnees;
    timestamp: string;
    latitude?: number;  // Coordonnées pour analyses sauvegardées
    longitude?: number; // Coordonnées pour analyses sauvegardées
  };
}

// ─── Tableau PLU détaillé (14 catégories) ──────────────────

export interface DetailedTable {
  documents_graphiques: string;
  occupations_sols_interdites: string;
  ppri: string;
  servitudes: string;
  acces_voirie: string;
  reseaux: {
    eaux_pluviales: string;
    eaux_usees: string;
    eaux_industrielles: string;
    divers: string;
  };
  implantation: {
    voies_emprises_publiques: string;
    limites_separatives: string;
    autres_sur_meme_terrain: string;
    par_rapport_zone: string;
  };
  emprise_sol: string;
  hauteur: string;
  aspect_exterieur: {
    materiaux: string;
    couleurs: string;
    clotures: string;
    toitures: string;
    divers: string;
  };
  stationnement: string;
  espaces_libres: {
    pourcentage_espaces_verts: string;
    arbres: string;
  };
  coefficient_occupation_sol: string;
  remarques: string;
}

export async function fetchDetailedTable(analysisId: string): Promise<DetailedTable> {
  console.log('🔄 Appel API analyze-plu-detailed:', analysisId);

  const response = await fetch(ANALYZE_PLU_DETAILED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ analysis_id: analysisId }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Erreur HTTP ${response.status}: ${errText}`);
  }

  const payload = await response.json();
  if (!payload.success) {
    throw new Error(payload.error || 'Échec de la génération du tableau détaillé');
  }

  console.log('✅ Tableau détaillé reçu (cached:', payload.cached, ')');
  return payload.data;
}

export async function analyserPLU(latitude: number, longitude: number): Promise<AnalysePLUResponse> {
  console.log('🔄 Appel API analyze-plu:', { latitude, longitude });

  try {
    const response = await fetch(ANALYZE_PLU_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ latitude, longitude })
    });

    if (!response.ok) {
      throw new Error(`Erreur HTTP: ${response.status} ${response.statusText}`);
    }

    const data: AnalysePLUResponse = await response.json();
    console.log('✅ Réponse API reçue:', data);

    return data;
  } catch (error) {
    console.error('❌ Erreur appel API:', error);
    throw error;
  }
}
