// Proxima — Kimi (kimi.com) Engine.
// DOM-driven v1: types into the composer, clicks send, polls the response
// region until it stabilizes, and returns the extracted text. Model/thinking
// effort selection is NOT handled here (deferred to commit #2).
//
// Exposes window.__proximaKimi = { send, newConversation }.

(function () {
    if (window.__proximaKimi) return;

    // ── Engine diagnostics ──────────────────────────────────────────────
    // Logs actionable DOM state when the engine fails so debugging
    // doesn't require opening DevTools on the provider's page.
    function _dumpDomState(context) {
        var url = window.location.href;
        var title = document.title;
        var bodyClasses = document.body ? document.body.className.slice(0, 200) : 'no-body';
        // Sample some top-level class patterns that might be useful for selector debugging
        var classSamples = [];
        try {
            var all = document.querySelectorAll('*');
            var seen = new Set();
            for (var i = 0; i < all.length && classSamples.length < 10; i++) {
                var c = all[i].className;
                if (typeof c === 'string' && c.trim()) {
                    var first = c.trim().split(/\s+/)[0];
                    if (!seen.has(first)) { seen.add(first); classSamples.push(first); }
                }
            }
        } catch(e) {}
        var diag = { context: context, url: url, title: title, bodyClasses: bodyClasses, classSamples: classSamples };
        console.log('[' + 'Kimi' + '][DOM] ' + JSON.stringify(diag));
        return diag;
    }

    var TIMEOUT = 360000;

    var _currentSessionId = null;
    var _sessions = {};
    try {
        var saved = localStorage.getItem('proxima_kimi_sessions');
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
        try { localStorage.setItem('proxima_kimi_sessions', JSON.stringify(_sessions)); } catch (e) { }
    }

    function _sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function _findComposer() {
        var els = document.querySelectorAll('textarea, [contenteditable="true"], div[role="textbox"]');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            var rect = el.getBoundingClientRect();
            if (rect.width > 100 && rect.height > 10 && el.offsetParent !== null) return el;
        }
        return null;
    }

    function _findSendButton() {
        var candidates = document.querySelectorAll('button');
        for (var i = 0; i < candidates.length; i++) {
            var b = candidates[i];
            if (b.disabled) continue;
            var txt = (b.textContent || '').trim().toLowerCase();
            var aria = (b.getAttribute('aria-label') || '').toLowerCase();
            if (/send|发送|submit/.test(txt + ' ' + aria)) return b;
        }
        var comp = _findComposer();
        if (comp) {
            var scope = comp.closest('form') || comp.parentElement;
            var btns = scope ? scope.querySelectorAll('button') : [];
            for (var j = 0; j < btns.length; j++) {
                if (!btns[j].disabled && btns[j].offsetParent !== null) return btns[j];
            }
        }
        return null;
    }

    function _isCssContent(text) {
        if (!text || text.length < 5) return false;
        var t = text.trim();
        return /^@(property|keyframes|import|media)/.test(t) ||
               /^[.#@a-zA-Z-]+\s*\{/.test(t.slice(0, 50)) ||
               /syntax:|initial-value:|inherits:|transform-box:|@keyframes/.test(t.slice(0, 100));
    }

    function _findResponseContainer() {
        var cand = document.querySelector('main, article, [role="log"], .conversation, #chat, .chat-container');
        if (cand && !_isCssContent(cand.textContent || '')) return cand;
        // Kimi conversation messages may use class patterns with "message"
        var msgs = document.querySelectorAll('[class*="message"]');
        if (msgs && msgs.length > 0) {
            for (var i = msgs.length - 1; i >= 0; i--) {
                var txt = (msgs[i].textContent || '').trim();
                if (txt.length > 0 && !_isCssContent(txt) && txt.indexOf('Thinking...') === -1) return msgs[i];
            }
        }
        // Don't fall through to document.body — it contains CSS animation content.
        // Instead return null; _extractLatestAnswer will return '' and polling continues.
        return null;
    }

    function _extractLatestAnswer() {
        var root = _findResponseContainer();
        if (!root) return '';
        var blocks = root.querySelectorAll('p, div, pre, li, span');
        var best = '';
        for (var i = 0; i < blocks.length; i++) {
            var t = (blocks[i].textContent || '').trim();
            if (t.length > best.length && !_isCssContent(t)) best = t;
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
                    if (stableFor >= 1800) return cur;
                } else {
                    stableFor = 0;
                    last = cur;
                }
            }
            await _sleep(600);
        }
                if (!last || last.length === 0) _dumpDomState('Kimi: timed out empty');
        return last;
    }

    // --- Model / thinking-effort selection (commit #2) ---
    // Kimi fuses effort into the model name (K2.6 Instant / K2.6 Thinking /
    // K2.6 Agent / K2.6 Agent Swarm). The request "model" may be e.g.
    // "k2.6-thinking" or "k2.6-instant" or just "k2.6". We open .current-model
    // and click the .model-item whose text matches the requested variant.
    function _kimiVariant(model) {
        var m = String(model || '').toLowerCase();
        if (/thinking/.test(m)) return 'thinking';
        if (/agent/.test(m)) return 'agent';
        if (/instant|fast|quick/.test(m)) return 'instant';
        // bare "k2.6" -> default (instant) unless effort says otherwise
        return 'instant';
    }

    async function _selectModel(model, effort) {
        try {
            var variant = _kimiVariant(model);
            // If effort explicitly given, it can override the model-derived variant.
            if (effort) {
                var e = String(effort).toLowerCase();
                if (/think/.test(e)) variant = 'thinking';
                else if (/agent/.test(e)) variant = 'agent';
                else if (/instant|off|none|fast/.test(e)) variant = 'instant';
            }
            var cur = document.querySelector('.current-model');
            if (!cur) { console.log('[Kimi] model selector not found'); return; }
            cur.click();
            await new Promise(function (r) { setTimeout(r, 400); });
            var items = document.querySelectorAll('.model-item');
            var hit = null;
            for (var i = 0; i < items.length; i++) {
                var txt = (items[i].textContent || '').toLowerCase();
                if (variant === 'thinking' && /thinking/.test(txt)) { hit = items[i]; break; }
                if (variant === 'agent' && /agent/.test(txt)) { hit = items[i]; break; }
                if (variant === 'instant' && /instant/.test(txt) && !/thinking|agent/.test(txt)) { hit = items[i]; break; }
            }
            if (hit) {
                // Click the inner .model-item-content or the item itself.
                hit.click();
                console.log('[Kimi] selected variant: ' + variant);
            } else {
                console.log('[Kimi] model variant not found: ' + variant + ' (using default)');
            }
            await new Promise(function (r) { setTimeout(r, 250); });
        } catch (e) {
            console.log('[Kimi] _selectModel error: ' + e.message);
        }
    }

    async function send(message, engine, effort, conversationId) {
        activateSession(conversationId);

        // Apply model + thinking-effort selection BEFORE composing.
        // For Kimi the "model" string encodes the variant (e.g. k2.6-thinking).
        if (engine && engine !== 'auto') await _selectModel(engine, effort);
        else if (effort) await _selectModel('k2.6', effort);

        var composer = _findComposer();
        if (!composer) throw new Error('Kimi: composer element not found (page not ready?)');

        if (composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT') {
            var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(composer, message);
            composer.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            composer.focus();
            composer.innerHTML = '';
            composer.textContent = message;
            composer.dispatchEvent(new Event('input', { bubbles: true }));
            composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }

        await _sleep(400);

        var btn = _findSendButton();
        if (btn) {
            btn.click();
        } else {
            composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
        }

        var answer = await _waitForStableAnswer(TIMEOUT);
        saveSession(conversationId);
        if (!answer || answer.length === 0) throw new Error('Kimi returned empty response');
        return answer;
    }

    function newConversation(sessionId) {
        if (sessionId) delete _sessions[sessionId];
        else if (_currentSessionId) delete _sessions[_currentSessionId];
        _currentSessionId = null;
        try { localStorage.setItem('proxima_kimi_sessions', JSON.stringify(_sessions)); } catch (e) { }
        console.log('[Proxima] Kimi conversation reset:', sessionId || 'current');
    }

    window.__proximaKimi = { send: send, newConversation: newConversation };
    console.log('[Proxima] Kimi engine loaded');
})();
