// Proxima — Core IPC Handlers.
// Registers ipcMain event handlers for renderer-to-main process settings and browser views management.

const { ipcMain, app, shell, clipboard } = require('electron');
const path = require('path');

function registerCoreHandlers(deps) {
    const { mainWindow, browserManager, loadSettings, saveSettings, saveEnabledProviders, startRestAPI, stopRestAPI, isRestAPIRunning, generateApiKey, revokeApiKey, loadApiKey } = deps;

ipcMain.handle('get-settings', () => {
    return loadSettings();
});

ipcMain.handle('save-settings', (event, settings) => {
    saveSettings(settings);
    return { success: true };
});

ipcMain.handle('save-enabled-providers', () => {
    const settings = loadSettings();
    saveEnabledProviders(settings);
    return { success: true };
});

ipcMain.handle('init-provider', async (event, provider) => {
    try {
        browserManager.createView(provider);
        return { success: true, provider };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('show-provider', async (event, provider) => {
    try {
        const win = typeof mainWindow === 'function' ? mainWindow() : mainWindow;
        const bounds = await win.webContents.executeJavaScript(`
            (function() {
                const container = document.getElementById('browser-container');
                if (container) {
                    const rect = container.getBoundingClientRect();
                    return {
                        x: Math.round(rect.left),
                        y: Math.round(rect.top),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    };
                }
                return { x: 0, y: 100, width: 1200, height: 700 };
            })()
        `);

        browserManager.showProvider(provider, bounds);
        return { success: true, provider };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('hide-browser', () => {
    browserManager.hideCurrentView();
    return { success: true };
});

ipcMain.handle('check-login-status', async (event, provider) => {
    try {
        const loggedIn = await browserManager.isLoggedIn(provider);
        return { success: true, provider, loggedIn };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('reload-provider', async (event, provider) => {
    try {
        await browserManager.reload(provider);
        return { success: true, provider };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-mcp-config', () => {
    const resourcesPath = process.resourcesPath || path.join(__dirname, '..');
    const unpackedPath = path.join(resourcesPath, 'app.asar.unpacked', 'src', 'mcp', 'index.js');

    const isDev = !app.isPackaged;
    const serverPath = isDev
        ? path.join(__dirname, '..', '..', 'src', 'mcp', 'index.js')
        : unpackedPath;

    return {
        mcpServers: {
            'proxima': {
                command: 'node',
                args: [serverPath.replace(/\\/g, '/')]
            }
        }
    };
});

ipcMain.handle('copy-to-clipboard', (event, text) => {
    clipboard.writeText(text);
    return { success: true };
});

ipcMain.handle('open-external', (event, url) => {
    try {
        const u = new URL(String(url || ''));
        // Allow only safe web and mail protocols to prevent local code execution.
        if (!['https:', 'http:', 'mailto:'].includes(u.protocol)) {
            return { success: false, error: 'Blocked non-web URL scheme' };
        }
        shell.openExternal(u.href);
        return { success: true };
    } catch (e) {
        return { success: false, error: 'Invalid URL' };
    }
});

ipcMain.handle('get-ipc-port', () => {
    const settings = loadSettings();
    return settings.ipcPort || 19222;
});

ipcMain.handle('get-env-status', async () => {
    try {
        const pythonEnv = require('../python-env.cjs');
        const envCheck = require('../env-check.cjs');
        const pyStatus = pythonEnv.getStatus();
        return { success: true, python: pyStatus, checks: await envCheck.runChecks(pyStatus) };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('setup-python-env', async () => {
    try {
        const pythonEnv = require('../python-env.cjs');
        const win = typeof mainWindow === 'function' ? mainWindow() : mainWindow;
        const result = await pythonEnv.ensureEnvironmentAsync((line) => {
            if (win && !win.isDestroyed()) win.webContents.send('python-env-progress', line);
        });
        return { success: result.ok, ...result, status: pythonEnv.getStatus() };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('open-in-system-browser', (event, provider) => {
    const urls = {
        perplexity: 'https://www.perplexity.ai/',
        chatgpt: 'https://chat.openai.com/',
        claude: 'https://claude.ai/',
        gemini: 'https://gemini.google.com/'
    };
    if (urls[provider]) {
        shell.openExternal(urls[provider]);
        return { success: true, provider };
    }
    return { success: false, error: 'Unknown provider' };
});

    // === TEMPORARY DIAGNOSTIC PROBE (commit #2 DOM recon) ===
    // Env-gated: only active when PROXIMA_DIAG=1. After providers initialize,
    // dumps the live Z.ai + Kimi model/thinking DOM to JSON files so we can
    // write resilient engine selectors without manual DevTools. Self-removing
    // once commit #2 is implemented — do NOT ship this to upstream.
    if (process.env.PROXIMA_DIAG === '1') {
        const fs = require('fs');
        const path = require('path');
        // SEND + CAPTURE: type a message, click send, wait, then report the
        // DOM path of the answer region so we can write a correct selector.
        const reconZai = `
            (async function () {
                var out = { url: location.href };
                try {
                    var ta = document.getElementById('chat-input');
                    if (!ta) { out.err = 'no chat-input'; return out; }
                    var setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                    setter.call(ta, 'Reply with exactly the word PONG and nothing else.');
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                    await new Promise(r => setTimeout(r, 400));
                    out.sendDisabled = (document.getElementById('send-message-button')||{}).disabled;
                    var sendBtn = document.getElementById('send-message-button');
                    if (sendBtn) sendBtn.click();
                    // wait for a response to render (LLM can be slow)
                    await new Promise(r => setTimeout(r, 15000));
                    // Capture bubble classes present AFTER send.
                    out.bubbleClasses = [];
                    var all = document.querySelectorAll('div, section, article, li');
                    for (var i = 0; i < all.length && out.bubbleClasses.length < 40; i++) {
                        var cl = (all[i].className && all[i].className.toString ? all[i].className.toString() : '');
                        if (/message|bubble|chat|conversation|turn|assistant|user|reply|response|role-|markdown|prose/i.test(cl)) {
                            out.bubbleClasses.push(cl.slice(0, 80));
                        }
                    }
                    // Find the last substantial text block and its chain.
                    var blocks = document.querySelectorAll('p, div, pre, li, span');
                    var best = null, bestLen = 0;
                    for (var j = 0; j < blocks.length; j++) {
                        var t = (blocks[j].textContent || '').trim();
                        if (t.length > bestLen) { bestLen = t.length; best = blocks[j]; }
                    }
                    if (best) {
                        var chain = []; var n = best;
                        for (var c = 0; c < 7 && n; c++) { chain.push((n.tagName||'') + '.' + (n.className && n.className.toString ? n.className.toString().slice(0,70) : '') + (n.id ? '#'+n.id : '')); n = n.parentElement; }
                        out.answerText = best.textContent.trim().slice(0, 120);
                        out.answerChain = chain;
                    }
                    out.bodyLen = (document.body.innerText||'').length;
                } catch (e) { out.err = e.message; }
                return out;
            })()
        `;
        const tick = async () => {
            try {
                fs.writeFileSync(path.join(__dirname, '..', '..', 'diag_marker.txt'), 'tick-started');
                const ready = browserManager.getWebContents('zai') && !browserManager.getWebContents('zai').isDestroyed();
                if (!ready) { setTimeout(tick, 2000); return; }
                const wc = browserManager.getWebContents('zai');
                await new Promise(r => setTimeout(r, 5000));
                const report = await wc.executeJavaScript(reconZai).catch(e => ({ err: e.message }));
                const file = path.join(__dirname, '..', '..', 'diag_dom_zai.json');
                fs.writeFileSync(file, JSON.stringify(report, null, 2));
                console.log('[DIAG] wrote ' + file);
            } catch (e) {
                console.log('[DIAG] probe failed:', e.message);
            }
        };
        setTimeout(tick, 18000);
    }
    // === END TEMPORARY DIAGNOSTIC PROBE ===
}

module.exports = { registerCoreHandlers };
