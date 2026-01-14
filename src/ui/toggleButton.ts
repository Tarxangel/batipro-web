// Composant UI : Bouton pour afficher/masquer les pins sauvegardés

export function createToggleButton(onClick: () => void): HTMLElement {
  const button = document.createElement('button');
  button.className = 'pins-toggle-button active';
  button.innerHTML = `
    📌
    <span class="count-badge">0</span>
  `;

  button.addEventListener('click', () => {
    onClick();
  });

  return button;
}

export function updateToggleButtonState(visible: boolean, count: number): void {
  const button = document.querySelector('.pins-toggle-button');
  if (!button) return;

  const badge = button.querySelector('.count-badge');
  if (badge) {
    badge.textContent = count.toString();
  }

  // Mettre à jour l'état visuel
  if (visible) {
    button.classList.add('active');
  } else {
    button.classList.remove('active');
  }
}
