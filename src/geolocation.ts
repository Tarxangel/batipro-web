// Module de géolocalisation - Bouton "Ma Position"

import L from 'leaflet';

let userMarker: L.Marker | null = null;
let accuracyCircle: L.Circle | null = null;
let watchId: number | null = null;
let isTracking = false;

// Icône personnalisée pour la position utilisateur (point bleu pulsant)
const userLocationIcon = L.divIcon({
  className: 'user-location-marker',
  html: `
    <div class="user-location-pulse"></div>
    <div class="user-location-dot"></div>
  `,
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

// Créer le bouton de géolocalisation
export function createGeolocationButton(map: L.Map): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'geolocation-btn';
  button.title = 'Ma position';
  button.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" fill="currentColor"/>
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="2" fill="none"/>
    </svg>
  `;

  button.addEventListener('click', () => {
    handleGeolocationClick(map, button);
  });

  document.body.appendChild(button);
  return button;
}

// Gérer le clic sur le bouton
async function handleGeolocationClick(map: L.Map, button: HTMLButtonElement): Promise<void> {
  // Si déjà en tracking, arrêter et centrer sur la position
  if (isTracking && userMarker) {
    const pos = userMarker.getLatLng();
    map.setView(pos, 17, { animate: true });
    return;
  }

  // Vérifier si la géolocalisation est supportée
  if (!navigator.geolocation) {
    showGeolocationError('Géolocalisation non supportée par votre navigateur');
    return;
  }

  // Mettre le bouton en état de chargement
  button.classList.add('loading');
  button.disabled = true;

  try {
    // Obtenir la position initiale (haute précision pour terrain)
    const position = await getCurrentPosition();

    const { latitude, longitude, accuracy } = position.coords;
    console.log(`📍 Position: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${Math.round(accuracy)}m)`);

    // Créer ou mettre à jour le marker
    updateUserLocation(map, latitude, longitude, accuracy);

    // Centrer la carte sur la position
    map.setView([latitude, longitude], 17, { animate: true });

    // Activer le tracking continu
    startTracking(map, button);

    button.classList.remove('loading');
    button.classList.add('active');
    button.disabled = false;

  } catch (error) {
    button.classList.remove('loading');
    button.disabled = false;

    if (error instanceof GeolocationPositionError) {
      switch (error.code) {
        case error.PERMISSION_DENIED:
          showGeolocationError('Accès à la position refusé. Autorisez la géolocalisation dans les paramètres.');
          break;
        case error.POSITION_UNAVAILABLE:
          showGeolocationError('Position non disponible. Vérifiez votre GPS.');
          break;
        case error.TIMEOUT:
          showGeolocationError('Délai dépassé. Réessayez.');
          break;
      }
    } else {
      showGeolocationError('Erreur lors de la géolocalisation');
    }
    console.error('❌ Erreur géolocalisation:', error);
  }
}

// Obtenir la position actuelle (Promise wrapper avec fallback)
function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    // D'abord essayer haute précision (GPS mobile)
    navigator.geolocation.getCurrentPosition(resolve,
      (error) => {
        // Si haute précision échoue, essayer basse précision (WiFi/IP pour desktop)
        if (error.code === error.POSITION_UNAVAILABLE) {
          console.log('📍 GPS non disponible, tentative WiFi/IP...');
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: false,  // Basse précision (WiFi/IP)
            timeout: 15000,
            maximumAge: 60000           // Cache 1 minute OK pour desktop
          });
        } else {
          reject(error);
        }
      },
      {
        enableHighAccuracy: true,  // Haute précision pour usage terrain
        timeout: 10000,            // 10 secondes max
        maximumAge: 0              // Pas de cache, position fraîche
      }
    );
  });
}

// Démarrer le tracking continu
function startTracking(map: L.Map, _button: HTMLButtonElement): void {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
  }

  isTracking = true;

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      updateUserLocation(map, latitude, longitude, accuracy);
    },
    (error) => {
      console.warn('⚠️ Erreur tracking:', error.message);
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 5000  // Cache 5 secondes pour économiser batterie
    }
  );

  console.log('🔄 Tracking GPS activé');
}

// Arrêter le tracking
export function stopTracking(button?: HTMLButtonElement): void {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  isTracking = false;

  if (button) {
    button.classList.remove('active');
  }

  console.log('⏹️ Tracking GPS arrêté');
}

// Mettre à jour la position utilisateur sur la carte
function updateUserLocation(map: L.Map, lat: number, lng: number, accuracy: number): void {
  const latlng: L.LatLngExpression = [lat, lng];

  // Créer ou mettre à jour le marker
  if (userMarker) {
    userMarker.setLatLng(latlng);
  } else {
    userMarker = L.marker(latlng, {
      icon: userLocationIcon,
      zIndexOffset: 1000  // Au-dessus des autres markers
    }).addTo(map);

    userMarker.bindPopup(`
      <div style="text-align: center;">
        <strong>📍 Ma position</strong><br>
        <small>Précision: ±${Math.round(accuracy)}m</small>
      </div>
    `);
  }

  // Créer ou mettre à jour le cercle de précision
  if (accuracyCircle) {
    accuracyCircle.setLatLng(latlng);
    accuracyCircle.setRadius(accuracy);
  } else {
    accuracyCircle = L.circle(latlng, {
      radius: accuracy,
      color: '#4285F4',
      fillColor: '#4285F4',
      fillOpacity: 0.15,
      weight: 1,
      opacity: 0.5
    }).addTo(map);
  }
}

// Afficher une erreur de géolocalisation
function showGeolocationError(message: string): void {
  // Créer une notification toast
  const toast = document.createElement('div');
  toast.className = 'geolocation-toast error';
  toast.innerHTML = `
    <span class="toast-icon">⚠️</span>
    <span class="toast-message">${message}</span>
  `;

  document.body.appendChild(toast);

  // Animation d'entrée
  setTimeout(() => toast.classList.add('visible'), 10);

  // Suppression après 4 secondes
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Supprimer les markers de position
export function clearUserLocation(): void {
  if (userMarker) {
    userMarker.remove();
    userMarker = null;
  }
  if (accuracyCircle) {
    accuracyCircle.remove();
    accuracyCircle = null;
  }
  stopTracking();
}
