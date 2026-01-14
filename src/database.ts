// Module de base de données Supabase pour stocker les analyses PLU

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { AnalysePLUResponse } from './api';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

// Interface étendue pour les analyses sauvegardées
export interface SavedAnalysis extends AnalysePLUResponse {
  id: string;
  data: AnalysePLUResponse['data'] & {
    latitude: number;
    longitude: number;
  };
}

// Type pour les lignes de la table DB
interface AnalysesPLURow {
  id: string;
  latitude: number;
  longitude: number;
  parcelle_commune: string;
  parcelle_section: string;
  parcelle_numero: string;
  parcelle_surface: number;
  parcelle_url_geoportail: string;
  zonage_type: 'PLU' | 'RNU';
  zonage_libelle: string;
  zonage_url_document: string | null;
  analyse_texte: string;
  analyse_source: string;
  timestamp: string;
  created_at: string;
}

// Client Supabase singleton
let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Configuration Supabase manquante. Vérifiez .env.local');
    }
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseClient;
}

// Tester la connexion à la base de données
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('analyses_plu').select('id').limit(1);

    if (error) {
      console.error('❌ Erreur connexion Supabase:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('❌ Erreur test connexion:', error);
    return false;
  }
}

// Sauvegarder une analyse dans la base de données
export async function saveAnalysis(
  analysis: Omit<SavedAnalysis, 'id'>
): Promise<SavedAnalysis> {
  try {
    const supabase = getSupabaseClient();

    // Convertir le format API vers le format DB
    const dbRow: Omit<AnalysesPLURow, 'id' | 'created_at'> = {
      latitude: analysis.data.latitude!,
      longitude: analysis.data.longitude!,
      parcelle_commune: analysis.data.parcelle.commune,
      parcelle_section: analysis.data.parcelle.section,
      parcelle_numero: analysis.data.parcelle.numero,
      parcelle_surface: analysis.data.parcelle.surface,
      parcelle_url_geoportail: analysis.data.parcelle.url_geoportail,
      zonage_type: analysis.data.zonage.type,
      zonage_libelle: analysis.data.zonage.libelle,
      zonage_url_document: analysis.data.zonage.url_document,
      analyse_texte: analysis.data.analyse.texte,
      analyse_source: analysis.data.analyse.source,
      timestamp: analysis.data.timestamp
    };

    const { data, error } = await supabase
      .from('analyses_plu')
      .insert(dbRow)
      .select()
      .single();

    if (error) {
      console.error('❌ Erreur sauvegarde analyse:', error);
      throw new Error(`Échec sauvegarde: ${error.message}`);
    }

    // Convertir le format DB vers le format SavedAnalysis
    const savedAnalysis: SavedAnalysis = convertDbRowToAnalysis(data);

    console.log('✅ Analyse sauvegardée:', savedAnalysis.id);
    return savedAnalysis;
  } catch (error) {
    console.error('❌ Erreur saveAnalysis:', error);
    throw error;
  }
}

// Récupérer toutes les analyses sauvegardées
export async function getAllAnalyses(): Promise<SavedAnalysis[]> {
  try {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase
      .from('analyses_plu')
      .select('*')
      .order('timestamp', { ascending: false });

    if (error) {
      console.error('❌ Erreur récupération analyses:', error);
      throw new Error(`Échec récupération: ${error.message}`);
    }

    // Convertir toutes les lignes DB en SavedAnalysis
    const analyses: SavedAnalysis[] = (data || []).map(convertDbRowToAnalysis);

    console.log(`✅ ${analyses.length} analyses récupérées`);
    return analyses;
  } catch (error) {
    console.error('❌ Erreur getAllAnalyses:', error);
    throw error;
  }
}

// Supprimer une analyse de la base de données
export async function deleteAnalysis(id: string): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('analyses_plu')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('❌ Erreur suppression analyse:', error);
      throw new Error(`Échec suppression: ${error.message}`);
    }

    console.log('✅ Analyse supprimée:', id);
  } catch (error) {
    console.error('❌ Erreur deleteAnalysis:', error);
    throw error;
  }
}

// Convertir une ligne DB en objet SavedAnalysis
function convertDbRowToAnalysis(row: AnalysesPLURow): SavedAnalysis {
  return {
    id: row.id,
    success: true,
    data: {
      latitude: row.latitude,
      longitude: row.longitude,
      parcelle: {
        commune: row.parcelle_commune,
        section: row.parcelle_section,
        numero: row.parcelle_numero,
        surface: row.parcelle_surface,
        url_geoportail: row.parcelle_url_geoportail
      },
      zonage: {
        type: row.zonage_type,
        libelle: row.zonage_libelle,
        url_document: row.zonage_url_document
      },
      analyse: {
        texte: row.analyse_texte,
        source: row.analyse_source
      },
      timestamp: row.timestamp
    }
  };
}
