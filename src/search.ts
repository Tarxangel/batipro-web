import L from 'leaflet';

interface AddressResult {
  properties: {
    label: string;
    city: string;
    postcode: string;
    context: string;
  };
  geometry: {
    coordinates: [number, number]; // [lng, lat]
  };
}

interface AddressResponse {
  features: AddressResult[];
}

let searchMarker: L.Marker | null = null;

export function setupSearchBar(map: L.Map): void {
  const searchContainer = document.getElementById('search-container');
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const searchResults = document.getElementById('search-results');

  if (!searchContainer || !searchInput || !searchResults) {
    console.error('Éléments de recherche non trouvés');
    return;
  }

  let searchTimeout: number | null = null;

  // Recherche avec debounce (attendre 300ms après la dernière frappe)
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();

    if (searchTimeout) {
      window.clearTimeout(searchTimeout);
    }

    if (query.length < 3) {
      searchResults.innerHTML = '';
      searchResults.style.display = 'none';
      return;
    }

    searchTimeout = window.setTimeout(() => {
      searchAddress(query, searchResults, map);
    }, 300);
  });

  // Fermer les résultats si on clique ailleurs
  document.addEventListener('click', (e) => {
    if (!searchContainer.contains(e.target as Node)) {
      searchResults.style.display = 'none';
    }
  });

  console.log('Barre de recherche initialisée');
}

async function searchAddress(query: string, resultsContainer: HTMLElement, map: L.Map): Promise<void> {
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=5`;
    const response = await fetch(url);
    const data: AddressResponse = await response.json();

    if (data.features.length === 0) {
      resultsContainer.innerHTML = '<div class="search-result-item no-results">Aucun résultat</div>';
      resultsContainer.style.display = 'block';
      return;
    }

    // Afficher les résultats
    resultsContainer.innerHTML = '';
    data.features.forEach((feature) => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = `
        <div class="search-result-label">${feature.properties.label}</div>
        <div class="search-result-context">${feature.properties.context}</div>
      `;

      item.addEventListener('click', () => {
        selectAddress(feature, map, resultsContainer);
      });

      resultsContainer.appendChild(item);
    });

    resultsContainer.style.display = 'block';
  } catch (error) {
    console.error('Erreur recherche adresse:', error);
    resultsContainer.innerHTML = '<div class="search-result-item error">Erreur de recherche</div>';
    resultsContainer.style.display = 'block';
  }
}

function selectAddress(feature: AddressResult, map: L.Map, resultsContainer: HTMLElement): void {
  const [lng, lat] = feature.geometry.coordinates;

  // Zoomer sur l'adresse
  map.setView([lat, lng], 18, { animate: true });

  // Placer un marker temporaire
  if (searchMarker) {
    map.removeLayer(searchMarker);
  }

  searchMarker = L.marker([lat, lng]).addTo(map);
  searchMarker.bindPopup(`📍 ${feature.properties.label}`).openPopup();

  // Fermer les résultats
  resultsContainer.style.display = 'none';

  // Effacer l'input
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  if (searchInput) {
    searchInput.value = feature.properties.label;
  }

  console.log('Adresse sélectionnée:', feature.properties.label);
}
