import { MAINTENANCE_MESSAGE } from './config';

export function showMaintenancePage(): void {
  const body = document.body;

  // Supprimer tout le contenu existant
  body.innerHTML = '';

  // Ajouter les styles pour la page de maintenance
  const style = document.createElement('style');
  style.textContent = `
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .maintenance-container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      max-width: 500px;
      margin: 20px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      text-align: center;
    }

    .maintenance-icon {
      font-size: 80px;
      margin-bottom: 20px;
      animation: bounce 2s infinite;
    }

    @keyframes bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-10px); }
    }

    .maintenance-title {
      font-size: 28px;
      font-weight: 700;
      color: #2d3748;
      margin-bottom: 10px;
    }

    .maintenance-subtitle {
      font-size: 18px;
      color: #667eea;
      margin-bottom: 20px;
      font-weight: 500;
    }

    .maintenance-description {
      font-size: 16px;
      color: #4a5568;
      line-height: 1.6;
      margin-bottom: 30px;
    }

    .maintenance-contact {
      font-size: 14px;
      color: #718096;
      padding: 15px;
      background: #f7fafc;
      border-radius: 10px;
      border-left: 4px solid #667eea;
    }

    .maintenance-contact strong {
      color: #667eea;
    }

    @media (max-width: 600px) {
      .maintenance-container {
        padding: 30px 20px;
      }

      .maintenance-icon {
        font-size: 60px;
      }

      .maintenance-title {
        font-size: 24px;
      }

      .maintenance-subtitle {
        font-size: 16px;
      }

      .maintenance-description {
        font-size: 15px;
      }
    }
  `;
  document.head.appendChild(style);

  // Créer le contenu de la page de maintenance
  const container = document.createElement('div');
  container.className = 'maintenance-container';
  container.innerHTML = `
    <div class="maintenance-icon">${MAINTENANCE_MESSAGE.titre.split(' ')[0]}</div>
    <h1 class="maintenance-title">${MAINTENANCE_MESSAGE.titre}</h1>
    <p class="maintenance-subtitle">${MAINTENANCE_MESSAGE.sousTitre}</p>
    <p class="maintenance-description">${MAINTENANCE_MESSAGE.description}</p>
    <div class="maintenance-contact">
      <strong>💬 Contact:</strong><br>
      ${MAINTENANCE_MESSAGE.contact}
    </div>
  `;

  body.appendChild(container);
}
