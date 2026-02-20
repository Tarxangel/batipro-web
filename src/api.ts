// API pour communiquer avec le backend Supabase Edge Function

const ANALYZE_PLU_URL = 'https://awhbjbuxbcxszlxcbpjb.supabase.co/functions/v1/analyze-plu';

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
