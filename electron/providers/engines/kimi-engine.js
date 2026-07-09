// Proxima — Kimi (kimi.com) Engine.
// DOM-driven v1: types into the composer, clicks send, polls the response
// region until it stabilizes, and returns the extracted text. Model/thinking
// effort selection is NOT handled here (deferred to commit #2).
//
// Exposes window.__proximaKimi = { send, newConversation }.

(function () {
    if (window.__proximaKimi) return;

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

    function _findResponseContainer() {
        var cand = document.querySelector('main, article, [role="log"], .conversation, #chat, .chat-container');
        return cand || document.body;
    }

    function _extractLatestAnswer() {
        var root = _findResponseContainer();
        if (!root) return '';
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
                    if (stableFor >= 1800) return cur;
                } else {
                    stableFor = 0;
                    last = cur;
                }
            }
            await _sleep(600);
        }
        return last;
    }

    async function send(message, conversationId) {
        activateSession(conversationId);

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
