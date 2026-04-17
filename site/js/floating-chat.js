/**
 * Floating Chat Widget for Journal App
 * Vanilla JS, zero dependencies (except window.BabuAI)
 * Mounts to #floating-chat-root, supports Q&A and edit intents
 */

(function (global) {
  const EDIT_KEYWORDS = [
    'change', 'update', 'add', 'remove', 'edit', 'move', 'reschedule',
    'delete', 'modify', 'switch', 'replace', 'cancel'
  ];

  // localStorage key for the open/closed preference. Scoped per host so a
  // trip page and the main journal can carry independent state if desired.
  const OPEN_STATE_KEY = 'journal:chat:isOpen';

  const FloatingChat = {
    root: null,
    panel: null,
    messagesContainer: null,
    textarea: null,
    sendBtn: null,
    bubble: null,
    isOpen: false,
    tripContext: null,
    config: {},
    // Last user message, kept so the Retry button on an error bubble actually
    // resends what the user typed (not the textarea placeholder).
    lastMessage: null,
    lastIntent: null,

    init(opts = {}) {
      this.config = opts;
      this.tripContext = opts.tripContext || window.__tripContext || {};

      // Ensure root exists
      this.root = document.getElementById('floating-chat-root');
      if (!this.root) {
        this.root = document.createElement('div');
        this.root.id = 'floating-chat-root';
        document.body.appendChild(this.root);
      }

      this.buildDOM();
      this.attachEvents();

      // Restore open state from last session so the user doesn't have to
      // re-open the chat on every reload.
      try {
        if (localStorage.getItem(OPEN_STATE_KEY) === '1') this.open();
      } catch (_) { /* private-mode localStorage blocks — ignore */ }

      console.log('[CHAT:INIT] Floating chat initialized', this.tripContext);
    },

    buildDOM() {
      // Bubble (toggle button)
      this.bubble = document.createElement('button');
      this.bubble.className = 'fc-bubble';
      // Lucide Scroll icon — icon-only bubble per ScrollBot design.
      this.bubble.setAttribute('aria-label', 'Open Trip Assistant');
      this.bubble.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M19 17V5a2 2 0 0 0-2-2H4"/>
          <path d="M15 8h-5"/>
          <path d="M15 12h-5"/>
          <path d="M8 21h13a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>
        </svg>
      `;

      // Panel (main chat interface)
      this.panel = document.createElement('div');
      this.panel.className = 'fc-panel';

      // Header
      const header = document.createElement('div');
      header.className = 'fc-header';
      header.innerHTML = `
        <div class="fc-header-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19 17V5a2 2 0 0 0-2-2H4"/>
            <path d="M15 8h-5"/>
            <path d="M15 12h-5"/>
            <path d="M8 21h13a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/>
          </svg>
          <span>Trip Assistant</span>
        </div>
        <div class="fc-header-actions">
          <button class="fc-header-btn fc-minimize" aria-label="Minimize">−</button>
          <button class="fc-header-btn fc-close" aria-label="Close">✕</button>
        </div>
      `;

      // Messages area
      this.messagesContainer = document.createElement('div');
      this.messagesContainer.className = 'fc-messages';

      // Quick-action chips (shown when empty).
      //
      // Each chip is { label, message }:
      //   label   — short text shown on the chip button
      //   message — what actually gets sent to the model on click. Can be
      //             more detailed than the label so the model has enough
      //             instruction even when the chip text is terse.
      //
      // To add a new intelligent action, append another entry here — no
      // other changes needed. The send() path routes to /api/trip-assistant
      // (QA) or /api/trip-edit (when the message contains an edit verb).
      const chipsContainer = document.createElement('div');
      chipsContainer.className = 'fc-chips';
      chipsContainer.id = 'fc-chips-container';
      const chips = [
        {
          label: "What's next?",
          message: "What's next today?",
        },
        {
          label: "Fill gaps",
          message:
            "Scan my trip day by day. Find every time gap of 90 minutes or more " +
            "between consecutive events. For each gap, propose 1–2 activities " +
            "appropriate to the time of day and what's already scheduled: " +
            "breakfast 7–10am, lunch 11am–1pm, dinner 5–7pm, coffee/snack in the " +
            "off-meal hours, a light walk or short sightseeing stop in daylight, " +
            "and a rest block after dense activity. Do NOT double-book meals. " +
            "Prefer venues close to the previous stop. For each proposal give: " +
            "day, a specific start time, activity name, one-line rationale. " +
            "Format as a per-day bulleted list.",
        },
        {
          label: "Summarize",
          message: "Summarize this trip",
        },
        {
          label: "Edit",
          message: "Edit itinerary",
        },
      ];
      chips.forEach(({ label, message }) => {
        const chip = document.createElement('button');
        chip.className = 'fc-chip';
        chip.textContent = label;
        chip.dataset.label = label;
        chip.dataset.message = message;
        chipsContainer.appendChild(chip);
      });

      // Input area
      const inputArea = document.createElement('div');
      inputArea.className = 'fc-input-area';

      this.textarea = document.createElement('textarea');
      this.textarea.className = 'fc-textarea';
      this.textarea.placeholder = 'Ask about the trip...';
      this.textarea.rows = 1;

      this.sendBtn = document.createElement('button');
      this.sendBtn.className = 'fc-send';
      this.sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16.6915026,12.4744748 L3.50612381,13.2599618 C3.19218622,13.2599618 3.03521743,13.4170592 3.03521743,13.5741566 L1.15159189,20.0151496 C0.8376543,20.8006365 0.99,21.89 1.77946707,22.52 C2.41,22.99 3.50612381,23.1 4.13399899,22.8429026 L21.714504,14.0454487 C22.6563168,13.5741566 23.1272231,12.6315722 22.9702544,11.6889879 C22.9702544,11.6889879 22.9702544,11.5318905 22.9702544,11.4748931 L4.13399899,2.52785101 C3.34915502,2.19051134 2.40734225,2.34760879 1.77946707,2.81594816 C0.994623095,3.44458856 0.837654326,4.53396812 1.15159189,5.31945504 L3.03521743,11.4748931 C3.03521743,11.6889879 3.34915502,11.8460453 3.50612381,11.8460453 L16.6915026,12.4744748 C16.6915026,12.4744748 17.1624089,12.4744748 17.1624089,12.0031827 C17.1624089,11.5318905 16.6915026,11.4748931 16.6915026,11.4748931 Z"></path></svg>`;
      this.sendBtn.disabled = true;

      inputArea.appendChild(this.textarea);
      inputArea.appendChild(this.sendBtn);

      // Assemble panel
      this.panel.appendChild(header);
      this.panel.appendChild(this.messagesContainer);
      this.panel.appendChild(chipsContainer);
      this.panel.appendChild(inputArea);

      // Mount to root
      this.root.appendChild(this.bubble);
      this.root.appendChild(this.panel);
    },

    attachEvents() {
      // Bubble click → open
      this.bubble.addEventListener('click', () => this.open());

      // Close and minimize buttons
      this.panel.querySelector('.fc-close').addEventListener('click', () => this.close());
      this.panel.querySelector('.fc-minimize').addEventListener('click', () => this.close());

      // Textarea input
      this.textarea.addEventListener('input', () => {
        const isEmpty = !this.textarea.value.trim();
        this.sendBtn.disabled = isEmpty;
      });

      // Textarea key handling: Enter sends, Shift+Enter for newline
      this.textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.send();
        } else if (e.key === 'Escape') {
          this.close();
        }
      });

      // Send button
      this.sendBtn.addEventListener('click', () => this.send());

      // Quick-action chips. The user-visible bubble shows the chip's short
      // label, while the API call uses dataset.message (which may be a
      // longer, more detailed prompt — e.g. Fill Gaps).
      document.getElementById('fc-chips-container').addEventListener('click', (e) => {
        if (e.target.classList.contains('fc-chip')) {
          this.textarea.value = e.target.dataset.message;
          this.sendBtn.disabled = false;
          this.send(e.target.dataset.label || e.target.dataset.message);
        }
      });

      // Escape key to close
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.isOpen) {
          this.close();
        }
      });

      // Click outside the panel (or the bubble) closes the chat. Uses
      // `mousedown` so the close fires before focus changes — feels snappier.
      // Guards: ignore when already closed, and ignore clicks on the bubble
      // itself (which has its own open/close logic).
      document.addEventListener('mousedown', (e) => {
        if (!this.isOpen) return;
        if (this.panel.contains(e.target)) return;
        if (this.bubble.contains(e.target)) return;
        this.close();
      });

      // Auto-scroll on new messages
      const observer = new MutationObserver(() => {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
      });
      observer.observe(this.messagesContainer, { childList: true });
    },

    open() {
      this.isOpen = true;
      this.root.classList.add('fc-open');
      this.textarea.focus();
      try { localStorage.setItem(OPEN_STATE_KEY, '1'); } catch (_) {}
      console.log('[CHAT:OPEN] Panel expanded');
    },

    close() {
      this.isOpen = false;
      // Trigger exit animation: reset opacity/transform
      this.root.classList.remove('fc-open');
      try { localStorage.setItem(OPEN_STATE_KEY, '0'); } catch (_) {}
      console.log('[CHAT:CLOSE] Panel collapsed');
    },

    // Removes any pending "thinking" dots bubble. Extracted because QA, edit,
    // and apply paths all need to clear the same element on settle.
    removeThinking() {
      const el = this.messagesContainer.querySelector('.fc-msg-thinking');
      if (el) el.remove();
    },

    // displayOverride: optional short text to show in the user bubble when
    // the actual API payload is longer (e.g. Fill Gaps chip). Defaults to
    // the raw textarea value.
    send(displayOverride) {
      const message = this.textarea.value.trim();
      if (!message) return;

      // Show user message (use the override so long chip prompts don't
      // turn into a huge bubble).
      this.addMessage(displayOverride || message, 'user');
      this.textarea.value = '';
      this.sendBtn.disabled = true;

      // Hide chips
      document.getElementById('fc-chips-container').style.display = 'none';

      // Detect intent against the real message, not the label.
      const isEditIntent = EDIT_KEYWORDS.some(keyword =>
        message.toLowerCase().includes(keyword)
      );

      // Remember the last user message so the Retry button on an error
      // bubble actually replays what the user asked, not the placeholder.
      this.lastMessage = message;
      this.lastIntent = isEditIntent ? 'edit' : 'qa';

      if (isEditIntent) {
        this.handleEdit(message);
      } else {
        this.handleQA(message);
      }
    },

    // Replays the last user message through the same intent classifier that
    // send() used. Called from the Retry button on error bubbles.
    retryLast() {
      if (!this.lastMessage) return;
      if (this.lastIntent === 'edit') this.handleEdit(this.lastMessage);
      else this.handleQA(this.lastMessage);
    },

    handleQA(message) {
      // Show thinking
      this.addMessage('', 'thinking');

      // Call API
      if (!window.BabuAI || !window.BabuAI.tripQA) {
        this.removeThinking();
        console.log('[CHAT:ERR] BabuAI.tripQA not available');
        this.addMessage('Trip assistant API not available', 'error');
        if (window.notify) window.notify.error('Trip assistant unavailable', { description: 'Check that the cowork server is running.' });
        return;
      }

      window.BabuAI.tripQA(message, this.tripContext.slug)
        .then(data => {
          this.removeThinking();
          // API returns { ok, response, model, usage }
          const text = data.response || data.rawText || JSON.stringify(data);
          this.addMessage(text, 'ai');
          console.log('[CHAT:RES]', { message, response: text, model: data.model });
        })
        .catch(error => {
          this.removeThinking();
          console.log('[CHAT:ERR]', { message, error: error.message });
          this.addMessage(this.formatError(error), 'error', true);
          if (window.notify) window.notify.error('Trip assistant failed', { description: error.message });
        });

      console.log('[CHAT:REQ]', { message, intent: 'qa', tripContext: this.tripContext });
    },

    handleEdit(message) {
      // Show thinking
      this.addMessage('', 'thinking');

      if (!window.BabuAI || !window.BabuAI.tripEdit) {
        this.removeThinking();
        console.log('[CHAT:ERR] BabuAI.tripEdit not available');
        this.addMessage('Edit API not available', 'error');
        if (window.notify) window.notify.error('Edit API unavailable', { description: 'Check that the cowork server is running.' });
        return;
      }

      // First call: dry run
      window.BabuAI.tripEdit(message, this.tripContext.slug, { dryRun: true })
        .then(proposal => {
          this.removeThinking();

          const summary = proposal.summary || proposal.rawText || JSON.stringify(proposal);
          const patch = proposal.proposed && proposal.proposed.patch;
          const isActionable = proposal.intent === 'edit' && Array.isArray(patch) && patch.length > 0;

          if (isActionable) {
            this.addMessage(summary, 'edit', false, () => {
              this.applyEdit(message, proposal);
            }, () => {
              console.log('[CHAT:EDIT] Discarded', { message, summary });
              this.addMessage('Edit discarded', 'system');
              if (window.notify) window.notify.message('Edit discarded');
            });
          } else {
            // intent=qa or intent=unknown or no patch — just surface the
            // clarification prose as a regular AI reply, no Apply button.
            this.addMessage(summary, 'ai');
          }

          console.log('[CHAT:EDIT] Proposal', { message, intent: proposal.intent, summary, actionable: isActionable });
        })
        .catch(error => {
          this.removeThinking();
          console.log('[CHAT:ERR]', { message, error: error.message });
          this.addMessage(this.formatError(error), 'error', true);
          if (window.notify) window.notify.error('Edit preview failed', { description: error.message });
        });

      console.log('[CHAT:REQ]', { message, intent: 'edit', tripContext: this.tripContext });
    },

    applyEdit(message, proposal) {
      this.addMessage('', 'thinking');

      window.BabuAI.tripEdit(message, this.tripContext.slug, { dryRun: false })
        .then((result) => {
          this.removeThinking();

          console.log('[CHAT:EDIT] Applied', { message, proposal, result });

          // SPA refresh — re-fetch trip + re-render timeline in place.
          // No page reload: the chat stays open and the user sees the edit
          // animate into the itinerary.
          const desc = (proposal && proposal.summary) || message;
          if (typeof window.__refreshItinerary === 'function') {
            window.__refreshItinerary()
              .then(() => {
                this.addMessage('Edit applied.', 'system');
                if (window.notify) window.notify.success('Edit applied', { description: desc });
              })
              .catch((err) => {
                console.log('[CHAT:ERR] refresh failed', err);
                this.addMessage('Edit applied (refresh failed — reload manually).', 'system');
                if (window.notify) window.notify.warning('Edit applied — refresh failed', { description: 'Reload the page to see the change.' });
              });
          } else {
            this.addMessage('Edit applied.', 'system');
            if (window.notify) window.notify.success('Edit applied', { description: desc });
          }
        })
        .catch(error => {
          this.removeThinking();
          console.log('[CHAT:ERR]', { message, error: error.message });
          this.addMessage(this.formatError(error), 'error', true);
          if (window.notify) window.notify.error('Edit failed to apply', { description: error.message });
        });
    },

    // Turn a client error into a user-friendly bubble. Highlights timeout /
    // cancelled / network cases so the user can tell them apart from a real
    // server failure, and drops the raw "HTTP 502" noise.
    formatError(error) {
      const code = error && error.code;
      if (code === 'timeout') return 'The request timed out. Try again, or simplify your question.';
      if (code === 'network') return 'Network error reaching the trip assistant. Check your connection.';
      if (code === 'cancelled') return 'Request cancelled.';
      const msg = (error && error.message) || 'Something went wrong.';
      return `Error: ${msg}`;
    },

    addMessage(content, type, isRetryable = false, onApply = null, onDiscard = null) {
      const msgDiv = document.createElement('div');

      if (type === 'thinking') {
        msgDiv.className = 'fc-msg-thinking';
        msgDiv.innerHTML = `<div class="fc-dots"><span></span><span></span><span></span></div>`;
      } else if (type === 'user') {
        msgDiv.className = 'fc-msg-user';
        msgDiv.textContent = content;
      } else if (type === 'ai') {
        msgDiv.className = 'fc-msg-ai fc-rendered';
        msgDiv.innerHTML = this.renderMarkdown(content);
      } else if (type === 'edit') {
        msgDiv.className = 'fc-msg-edit';
        msgDiv.innerHTML = `
          <div class="fc-edit-label">Edit Proposal</div>
          <div class="fc-edit-summary fc-rendered">${this.renderMarkdown(content)}</div>
          <div class="fc-edit-actions">
            <button class="fc-btn-apply" data-action="apply">Apply</button>
            <button class="fc-btn-discard" data-action="discard">Discard</button>
          </div>
        `;
        msgDiv.querySelector('[data-action="apply"]').addEventListener('click', onApply);
        msgDiv.querySelector('[data-action="discard"]').addEventListener('click', onDiscard);
      } else if (type === 'error') {
        msgDiv.className = 'fc-msg-error';
        const canRetry = isRetryable && !!this.lastMessage;
        msgDiv.innerHTML = `
          <div>${this.escapeHtml(content)}</div>
          ${canRetry ? '<div class="fc-retry" data-retry="true" role="button" tabindex="0">Try again</div>' : ''}
        `;
        if (canRetry) {
          const retry = () => {
            msgDiv.remove();
            this.retryLast();
          };
          const btn = msgDiv.querySelector('[data-retry]');
          btn.addEventListener('click', retry);
          btn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); retry(); }
          });
        }
      } else if (type === 'system') {
        msgDiv.className = 'fc-msg-system';
        msgDiv.textContent = content;
      }

      this.messagesContainer.appendChild(msgDiv);
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    },

    escapeHtml(text) {
      const str = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      };
      return str.replace(/[&<>"']/g, m => map[m]);
    },

    /**
     * Lightweight markdown → HTML for chat bubbles.
     * Supports: **bold**, *italic*, `code`, bullet lists (- or •),
     * numbered lists, and paragraph breaks.
     */
    renderMarkdown(text) {
      if (typeof text !== 'string') text = JSON.stringify(text, null, 2);

      // Escape HTML first
      let html = this.escapeHtml(text);

      // Bold: **text**
      html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

      // Italic: *text* (but not inside bold)
      html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

      // Inline code: `text`
      html = html.replace(/`(.+?)`/g, '<code>$1</code>');

      // Split into lines for block-level processing
      const lines = html.split('\n');
      const blocks = [];
      let currentList = null;
      let currentListType = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Bullet list item: - or • or *
        const bulletMatch = line.match(/^[-•]\s+(.+)/);
        // Numbered list item: 1. or 1)
        const numMatch = line.match(/^\d+[.)]\s+(.+)/);

        if (bulletMatch) {
          if (currentListType !== 'ul') {
            if (currentList) blocks.push(currentList);
            currentList = { type: 'ul', items: [] };
            currentListType = 'ul';
          }
          currentList.items.push(bulletMatch[1]);
        } else if (numMatch) {
          if (currentListType !== 'ol') {
            if (currentList) blocks.push(currentList);
            currentList = { type: 'ol', items: [] };
            currentListType = 'ol';
          }
          currentList.items.push(numMatch[1]);
        } else {
          if (currentList) {
            blocks.push(currentList);
            currentList = null;
            currentListType = null;
          }
          if (line === '') {
            blocks.push({ type: 'break' });
          } else {
            // Merge consecutive text lines into a paragraph
            const lastBlock = blocks[blocks.length - 1];
            if (lastBlock && lastBlock.type === 'p') {
              lastBlock.text += ' ' + line;
            } else {
              blocks.push({ type: 'p', text: line });
            }
          }
        }
      }
      if (currentList) blocks.push(currentList);

      // Render blocks to HTML
      return blocks.map(block => {
        if (block.type === 'p') return `<p>${block.text}</p>`;
        if (block.type === 'break') return '';
        if (block.type === 'ul') {
          return '<ul>' + block.items.map(i => `<li>${i}</li>`).join('') + '</ul>';
        }
        if (block.type === 'ol') {
          return '<ol>' + block.items.map(i => `<li>${i}</li>`).join('') + '</ol>';
        }
        return '';
      }).join('');
    }
  };

  // Expose to global scope
  global.FloatingChat = {
    init(opts) {
      FloatingChat.init(opts);
    }
  };

  // Auto-init on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      FloatingChat.init();
    });
  } else {
    FloatingChat.init();
  }
})(window);
