// API pour communiquer avec le backend n8n

const N8N_WEBHOOK_URL = 'https://n8n.batiproconcept.fr/webhook/batipro-analyse-plu';

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
  success: boolean;
  data: {
    parcelle: ParcelleDonnees;
    zonage: ZonageDonnees;
    analyse: AnalyseDonnees;
    timestamp: string;
  };
}

export async function analyserPLU(latitude: number, longitude: number): Promise<AnalysePLUResponse> {
  console.log('🔄 Appel API n8n:', { latitude, longitude });

  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
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
