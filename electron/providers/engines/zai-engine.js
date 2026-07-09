// Proxima — Z.ai (chat.z.ai) Engine.
// DOM-driven v1: types into the composer, clicks send, polls the response
// region until it stabilizes, and returns the extracted text. Model/thinking
// effort selection is NOT handled here (deferred to commit #2).
//
// Exposes window.__proximaZai = { send, newConversation }.

(function () {
    if (window.__proximaZai) return;

    var TIMEOUT = 360000;

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

    // Heuristic DOM locators — kept resilient to minor markup changes.
    function _findComposer() {
        // Prefer a contenteditable or textarea acting as the message box.
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
        // Fallback: a button with an icon inside the composer region.
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

    function _findResponseContainer() {
        // The main conversation/article region.
        var cand = document.querySelector('main, article, [role="log"], .conversation, #chat, .chat-container');
        return cand || document.body;
    }

    function _extractLatestAnswer() {
        var root = _findResponseContainer();
        if (!root) return '';
        // Grab the last substantial text block (assistant turn).
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

    async function send(message, conversationId) {
        activateSession(conversationId);

        var composer = _findComposer();
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
        saveSession(conversationId);
        if (!answer || answer.length === 0) throw new Error('Z.ai returned empty response');
        return answer;
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
