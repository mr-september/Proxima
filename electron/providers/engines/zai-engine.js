// Proxima — Z.ai (chat.z.ai) Engine.
// DOM-driven v1: types into the composer, clicks send, polls the response
// region until it stabilizes, and returns the extracted text. Model/thinking
// effort selection is NOT handled here (deferred to commit #2).
//
// Exposes window.__proximaZai = { send, newConversation }.

(function () {
    if (window.__proximaZai) return;

    var TIMEOUT = 120000;

    var _currentSessionId = null;
    var _sessions = {};
    try {
        var saved = localStorage.getItem('proxima_zai_sessions');
        if (saved) _sessions = JSON.parse(saved);
    } catch (e) { }

    function activateSession(sessionId) {
        if (!sessionId) sessionId = 'default';
        _currentSessionId = sessionId;
        if (!_sessions[sessionId]) _sessions[sessionId] = { convId: null };
        return _sessions[sessionId];
    }

    function saveSession(sessionId) {
        if (!sessionId) sessionId = _currentSessionId || 'default';
        try { localStorage.setItem('proxima_zai_sessions', JSON.stringify(_sessions)); } catch (e) { }
    }

    function _sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    // Heuristic DOM locators — Z.ai specific (chat.z.ai).
    function _findComposer() {
        // Z.ai uses a real <textarea id="chat-input">.
        var ta = document.getElementById('chat-input');
        if (ta && ta.offsetParent !== null) return ta;
        // Fallback: any visible textarea/contenteditable.
        var els = document.querySelectorAll('textarea, [contenteditable="true"], div[role="textbox"]');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var rect = el.getBoundingClientRect();
            if (rect.width > 100 && rect.height > 10 && el.offsetParent !== null) return el;
        }
        return null;
    }

    function _findSendButton() {
        // Z.ai send button is a fixed ID with an icon (no text).
        var byId = document.getElementById('send-message-button');
        if (byId && !byId.disabled && byId.offsetParent !== null) return byId;
        // Fallback: button whose class hints at send.
        var candidates = document.querySelectorAll('button');
        for (var i = 0; i < candidates.length; i++) {
            var b = candidates[i];
            if (b.disabled) continue;
            var cls = (b.className || '').toLowerCase();
            var txt = (b.textContent || '').trim().toLowerCase();
            var aria = (b.getAttribute('aria-label') || '').toLowerCase();
            if (/send|发送|submit|sendmessagebutton/.test(cls + ' ' + txt + ' ' + aria)) return b;
        }
        return null;
    }

    function _findResponseContainer() {
        // Z.ai renders assistant turns in elements with class "chat-assistant"
        // (plus a Svelte hash). Prefer the LAST such element.
        var bubbles = document.querySelectorAll('[class*="chat-assistant"]');
        if (bubbles && bubbles.length) return bubbles[bubbles.length - 1];
        // Fallback: the markdown-prose inside the last chat-assistant.
        var prose = document.querySelectorAll('.markdown-prose');
        if (prose && prose.length) return prose[prose.length - 1];
        // Generic fallbacks.
        var cand = document.querySelector('main, article, [role="log"], .conversation, #chat, .chat-container');
        return cand || document.body;
    }

    function _extractLatestAnswer() {
        var root = _findResponseContainer();
        if (!root) return '';
        // If we landed on the assistant bubble, its direct text is the answer.
        var direct = (root.textContent || '').trim();
        if (direct.length > 0) return direct;
        // Otherwise grab the last substantial text block within it.
        var blocks = root.querySelectorAll('p, div, pre, li, span');
        var best = '';
        for (var i = 0; i < blocks.length; i++) {
            var t = (blocks[i].textContent || '').trim();
            if (t.length > best.length) best = t;
        }
        return best;
    }

    async function _waitForStableAnswer(timeoutMs) {
        var deadline = Date.now() + (timeoutMs || TIMEOUT);
        var last = '';
        var stableFor = 0;
        while (Date.now() < deadline) {
            var cur = _extractLatestAnswer();
            if (cur.length > 0) {
                if (cur === last) {
                    stableFor += 600;
                    if (stableFor >= 1800) return cur; // stable ~2s → done
                } else {
                    stableFor = 0;
                    last = cur;
                }
            }
            await _sleep(600);
        }
        return last; // return best-effort even if not fully stable
    }

    // --- Model / thinking-effort selection (commit #2) ---
    // Z.ai model menu: click .modelSelectorButton, then click the
    // BUTTON[aria-label="model-item"][data-value="<model>"] option.
    function _normalizeModelId(m) {
        // Accept "glm-4.7" or "glm4.7" or "glm-4.7-air" etc.
        return String(m || '').trim().toLowerCase();
    }

    async function _selectModel(model) {
        try {
            var wanted = _normalizeModelId(model);
            var btn = document.querySelector('.modelSelectorButton');
            if (!btn) { console.log('[Z.ai] model button not found'); return; }
            btn.click();
            // Menu renders in a Svelte portal; wait for it then match.
            await new Promise(function (r) { setTimeout(r, 400); });
            var opts = document.querySelectorAll('button[aria-label="model-item"]');
            var hit = null;
            for (var i = 0; i < opts.length; i++) {
                var dv = (opts[i].getAttribute('data-value') || '').toLowerCase();
                var txt = (opts[i].textContent || '').toLowerCase();
                if (dv === wanted || txt.indexOf(wanted) !== -1) { hit = opts[i]; break; }
            }
            if (hit) { hit.click(); console.log('[Z.ai] selected model: ' + wanted); }
            else { console.log('[Z.ai] model not found: ' + wanted + ' (using default)'); }
            await new Promise(function (r) { setTimeout(r, 250); }); // let menu close
        } catch (e) {
            console.log('[Z.ai] _selectModel error: ' + e.message);
        }
    }

    async function _selectEffort(effort) {
        try {
            var e = String(effort || '').trim().toLowerCase();
            if (!e || e === 'off' || e === 'none') { /* fall through to toggle-off below */ }
            var controls = document.querySelectorAll('[role="button"], button');
            var target = null;
            for (var i = 0; i < controls.length; i++) {
                var t = (controls[i].textContent || '').trim().toLowerCase();
                if (/deep think/.test(t)) {
                    if (e === 'deepthink' && /max/.test(t)) { target = controls[i]; break; }
                    if (e === 'thinking' && !/max/.test(t)) { target = controls[i]; break; }
                    if (e === 'off' && /deep think/.test(t)) { target = controls[i]; break; }
                }
            }
            if (target) { target.click(); console.log('[Z.ai] effort set: ' + e); }
            else { console.log('[Z.ai] effort control not found: ' + e); }
            await new Promise(function (r) { setTimeout(r, 200); });
        } catch (err) {
            console.log('[Z.ai] _selectEffort error: ' + err.message);
        }
    }

    async function send(message, engine, effort, conversationId) {
        console.log('[Z.ai][send] START engine=' + engine + ' effort=' + effort + ' conv=' + conversationId);
        var _diag = { start: Date.now(), engine: engine, effort: effort };
        try {
        activateSession(conversationId);

        // Apply model + thinking-effort selection BEFORE composing.
        if (engine && engine !== 'auto') await _selectModel(engine);
        if (effort) await _selectEffort(effort);
        _diag.afterSelect = Date.now();

        var composer = _findComposer();
        _diag.composerFound = !!composer;
        if (!composer) throw new Error('Z.ai: composer element not found (page not ready?)');

        // Support both contenteditable and textarea inputs.
        if (composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT') {
            var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(composer, message);
            composer.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            composer.focus();
            composer.innerHTML = '';
            // Insert as a text node so the rich editor picks it up.
            composer.textContent = message;
            composer.dispatchEvent(new Event('input', { bubbles: true }));
            composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }

        await _sleep(400);

        var btn = _findSendButton();
        if (btn) {
            btn.click();
        } else {
            // Last resort: simulate Enter in the composer.
            composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        }

        var answer = await _waitForStableAnswer(TIMEOUT);
        _diag.answerLen = (answer || '').length;
        _diag.answerHead = (answer || '').slice(0, 200);
        saveSession(conversationId);
        window.__zaiDiag = _diag;
        if (!answer || answer.length === 0) throw new Error('Z.ai returned empty response');
        return answer;
        } catch (e) {
            _diag.error = e.message;
            window.__zaiDiag = _diag;
            throw e;
        }
    }

    function newConversation(sessionId) {
        if (sessionId) delete _sessions[sessionId];
        else if (_currentSessionId) delete _sessions[_currentSessionId];
        _currentSessionId = null;
        try { localStorage.setItem('proxima_zai_sessions', JSON.stringify(_sessions)); } catch (e) { }
        console.log('[Proxima] Z.ai conversation reset:', sessionId || 'current');
    }

    window.__proximaZai = { send: send, newConversation: newConversation };
    console.log('[Proxima] Z.ai engine loaded');
})();
