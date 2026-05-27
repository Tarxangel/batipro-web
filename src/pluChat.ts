// Chatbot IA pour poser des questions sur une analyse PLU déjà sauvegardée.
// L'UI est un petit panneau de chat (input + historique scrollable) injecté
// dans la results card par showResultsCard().
//
// L'historique vit en mémoire dans l'élément racine (data attributes) — pas
// de persistance DB, le chat redémarre vierge à chaque ouverture de l'analyse.
// Sliding window: on cape à MAX_HISTORY messages pour limiter les tokens.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';
import { getAuthClient } from './auth/client';

const MAX_HISTORY = 10;
const CHAT_PLU_URL = `${SUPABASE_URL}/functions/v1/chat-plu`;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Construit le HTML du panneau chat à injecter dans la results card.
 * À combiner avec attachPluChatHandlers() une fois le card dans le DOM.
 */
export function renderPluChatSection(): string {
  return `
    <div class="plu-chat-section">
      <h4>💬 Posez une question sur cette analyse</h4>
      <div class="plu-chat-history" data-history="[]"></div>
      <form class="plu-chat-form">
        <input
          type="text"
          class="plu-chat-input"
          placeholder="Ex: Puis-je faire un parking de 20 places ?"
          maxlength="500"
          autocomplete="off"
        />
        <button type="submit" class="plu-chat-send">Envoyer</button>
      </form>
      <div class="plu-chat-hint">L'IA répond à partir du tableau réglementaire et des MH ; reste factuelle.</div>
    </div>
  `;
}

/**
 * Attache les handlers (submit, scroll) sur le panneau chat précédemment
 * inséré dans le DOM. À appeler après que showResultsCard ait fait
 * appendChild(card).
 */
export function attachPluChatHandlers(container: HTMLElement, analysisId: string): void {
  const form = container.querySelector('.plu-chat-form') as HTMLFormElement | null;
  const input = container.querySelector('.plu-chat-input') as HTMLInputElement | null;
  const sendBtn = container.querySelector('.plu-chat-send') as HTMLButtonElement | null;
  const history = container.querySelector('.plu-chat-history') as HTMLElement | null;
  if (!form || !input || !sendBtn || !history) return;

  function readHistory(): ChatMessage[] {
    try {
      return JSON.parse(history!.getAttribute('data-history') || '[]');
    } catch {
      return [];
    }
  }

  function writeHistory(msgs: ChatMessage[]): void {
    // Cap côté front aussi pour éviter de stocker un historique infini en attribut DOM.
    const capped = msgs.slice(-MAX_HISTORY);
    history!.setAttribute('data-history', JSON.stringify(capped));
  }

  function appendBubble(role: ChatMessage['role'], content: string): void {
    const div = document.createElement('div');
    div.className = `plu-chat-bubble plu-chat-bubble-${role}`;
    div.textContent = content;
    history!.appendChild(div);
    history!.scrollTop = history!.scrollHeight;
  }

  function appendTypingPlaceholder(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'plu-chat-bubble plu-chat-bubble-assistant plu-chat-typing';
    div.textContent = '…';
    history!.appendChild(div);
    history!.scrollTop = history!.scrollHeight;
    return div;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    // Ajoute la bulle user, vide l'input, désactive
    appendBubble('user', question);
    input.value = '';
    input.disabled = true;
    sendBtn.disabled = true;
    sendBtn.textContent = '…';

    const msgs = readHistory();
    msgs.push({ role: 'user', content: question });
    writeHistory(msgs);

    const typing = appendTypingPlaceholder();

    try {
      // On récupère le token actuel pour l'auth (auth.users sur self-host)
      const supabase = getAuthClient();
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error('Pas de session — reconnectez-vous');

      const resp = await fetch(CHAT_PLU_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          analysis_id: analysisId,
          messages: msgs,
        }),
      });
      const data = await resp.json();
      typing.remove();

      if (!resp.ok || !data.reply) {
        appendBubble('assistant', `❌ ${escapeHtml(data.error || 'Erreur inconnue')}`);
        return;
      }

      appendBubble('assistant', data.reply);
      msgs.push({ role: 'assistant', content: data.reply });
      writeHistory(msgs);

      if (data.usage) {
        console.log(`💬 chat-plu tokens: in=${data.usage.input_tokens}, out=${data.usage.output_tokens}, total=${data.usage.total_tokens}`);
      }
    } catch (err) {
      typing.remove();
      const msg = err instanceof Error ? err.message : 'Erreur réseau';
      appendBubble('assistant', `❌ ${escapeHtml(msg)}`);
    } finally {
      input.disabled = false;
      sendBtn.disabled = false;
      sendBtn.textContent = 'Envoyer';
      input.focus();
    }
  });
}
