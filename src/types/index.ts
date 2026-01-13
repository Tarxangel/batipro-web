export interface ParcelProperties {
  id: string;
  section: string;
  numero: string;
  commune: string;
  contenance: number; // Surface en m²
  [key: string]: any;
}

export interface ParcelFeature {
  type: 'Feature';
  geometry: {
    type: string;
    coordinates: any;
  };
  properties: ParcelProperties;
}

export interface ParcelGeoJSON {
  type: 'FeatureCollection';
  features: ParcelFeature[];
}
