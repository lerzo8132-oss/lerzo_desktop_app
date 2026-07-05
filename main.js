const { app, BrowserWindow, ipcMain, shell, Tray, Menu, session, safeStorage, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { loadApiConfig, probeBackendHealth } = require('./config/loadApiConfig');

let autoUpdater = {
    checkForUpdatesAndNotify: () => Promise.resolve(false)
};

try {
    ({ autoUpdater } = require('electron-updater'));
} catch {
    // Auto-updates are optional in packaged builds.
}

try {
    require('dotenv').config();
} catch {
    // Local .env loading is only needed during development.
}

// --- CRITICAL IDENTITY LOCK ---
app.setName('Lerzo');
app.name = 'Lerzo';

process.on('unhandledRejection', (error) => {
    console.error('[Lerzo] Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('[Lerzo] Uncaught exception:', error);
});

let mainWindow;
let splashWindow;
let tray = null;
let rendererLoadedOnce = false;
let apiMonitorState = {
    requests: [],
    errors: [],
    network: {
        apiConnected: false,
        backendReachable: false,
        databaseReachable: false,
        status: 'offline',
        lastCheckedAt: null,
        lastLatencyMs: null
    },
    currentUser: null,
    tokenStatus: {
        state: 'unknown',
        expiresIn: null,
        expiresAt: null
    },
    security: {
        debounce: true,
        throttle: true,
        requestQueue: true
    },
    pageMap: []
};

const IS_PROD = app.isPackaged;
const ELECTRON_DEBUG = ['1', 'true', 'yes'].includes(String(process.env.LERZO_ELECTRON_DEBUG || '').trim().toLowerCase());
const RENDERER_DEV_URL = (process.env.ELECTRON_RENDERER_URL || `http://${['127', '0', '0', '1'].join('.')}:5173`).replace(/\/$/, '');
const SPLASH_FALLBACK_MS = 15000;
const IGNORED_FAIL_LOAD_CODES = new Set([-3]); // ERR_ABORTED during hash navigation
let API_CONFIG = null;
let splashFallbackTimer = null;

function getLogFilePath() {
    return path.join(app.getPath('userData'), 'logs', 'main.log');
}

function startupLog(message, details) {
    const suffix = details ? ` ${JSON.stringify(details)}` : '';
    const line = `[${new Date().toISOString()}] ${message}${suffix}`;
    console.log(line);
    try {
        const logDir = path.dirname(getLogFilePath());
        fs.mkdirSync(logDir, { recursive: true });
        fs.appendFileSync(getLogFilePath(), `${line}\n`);
    } catch {
        // Logging must never block startup.
    }
}

function getApiConfig() {
    if (!API_CONFIG) {
        API_CONFIG = loadApiConfig(app);
    }
    return API_CONFIG;
}

async function assertBackendAvailableForLogin(config) {
    const result = await probeBackendHealth(config, { timeoutMs: 3500 });
    startupLog('Login health probe', {
        apiBaseUrl: config.apiBaseUrl,
        healthUrl: result.healthUrl,
        status: result.status,
        reachable: result.reachable,
        error: result.error || null,
    });
    if (!result.reachable) {
        console.error('[Electron Error] backend unavailable', {
            mode: config.configMode,
            apiBaseUrl: config.apiBaseUrl,
            healthUrl: result.healthUrl,
            status: result.status,
            error: result.error || 'Health check failed',
            attempts: result.attempts,
        });
        throw new Error('Server is currently unavailable');
    }
}
const AUTH_SUGGESTIONS_FILE = path.join(app.getPath('userData'), 'auth-suggestions.json');
const AUTH_TOKEN_FILE = path.join(app.getPath('userData'), 'auth-token.bin');

function resolveAppIcon() {
    const candidates = [
        path.join(__dirname, 'assets/LOGO.png'),
        path.join(__dirname, 'assets/LOGO.ico'),
        path.join(__dirname, 'build/icon.png'),
        path.join(__dirname, 'build/icon.ico'),
        path.join(__dirname, 'build/icon.icns')
    ];

    try {
        return candidates.find((candidate) => fs.existsSync(candidate));
    } catch {
        return undefined;
    }
}

const APP_ICON = resolveAppIcon();

function normalizeRouteHash(hash = '') {
    if (!hash) return '';
    const value = hash.startsWith('#') ? hash.slice(1) : hash;
    return value.startsWith('/') ? value : `/${value}`;
}

function getRendererIndexPath() {
    const candidates = [
        path.join(app.getAppPath(), 'dist', 'index.html'),
        path.join(__dirname, 'dist', 'index.html')
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function getElectronStartUrl(hash = '') {
    const normalizedHash = hash ? (hash.startsWith('#') ? hash : `#${hash}`) : '';
    if (!IS_PROD) {
        return `${RENDERER_DEV_URL}${normalizedHash}`;
    }

    const indexFile = getRendererIndexPath();
    if (fs.existsSync(indexFile)) {
        return `${pathToFileURL(indexFile).toString()}${normalizedHash}`;
    }

    throw new Error(`Packaged renderer is missing: ${indexFile}`);
}

function closeSplashWindow() {
    if (splashFallbackTimer) {
        clearTimeout(splashFallbackTimer);
        splashFallbackTimer = null;
    }
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
    }
}

function scheduleSplashFallback() {
    if (splashFallbackTimer) {
        clearTimeout(splashFallbackTimer);
    }
    splashFallbackTimer = setTimeout(() => {
        startupLog('Splash fallback timeout reached; showing main window');
        closeSplashWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            if (ELECTRON_DEBUG) {
                mainWindow.webContents.openDevTools({ mode: 'detach' });
            }
        }
    }, SPLASH_FALLBACK_MS);
}

function recordLoadFailure(error, target) {
    const message = error && error.message ? error.message : String(error);
    startupLog('Renderer load failed', { target, message });
    apiMonitorState.errors.unshift({
        timestamp: new Date().toISOString(),
        type: 'electron',
        message: `Load failed: ${message}`,
        endpoint: target || '',
        page: ''
    });
    apiMonitorState.errors = apiMonitorState.errors.slice(0, 100);
    closeSplashWindow();
}

let devRendererRetryAttempts = 0;
const DEV_RENDERER_MAX_RETRIES = 40;
const DEV_RENDERER_RETRY_DELAY_MS = 500;

function resetDevRendererRetries() {
    devRendererRetryAttempts = 0;
}

// In dev, the Vite server may not be listening yet when Electron boots. A failed
// load of the dev URL is NOT an offline condition; retry until Vite is ready.
function scheduleDevRendererRetry() {
    if (IS_PROD) return false;
    if (devRendererRetryAttempts >= DEV_RENDERER_MAX_RETRIES) return false;
    devRendererRetryAttempts += 1;
    startupLog('Dev renderer retry scheduled', {
        attempt: devRendererRetryAttempts,
        max: DEV_RENDERER_MAX_RETRIES,
    });
    setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            navigateMainWindow(loadSecureAuthToken() ? '#/dashboard' : '#/auth-login');
        }
    }, DEV_RENDERER_RETRY_DELAY_MS);
    return true;
}

// Distinguish the three failure modes so we never show "No Internet" when the
// network is actually fine.
//   - 'network'  : device has no internet at all
//   - 'server'   : internet is up but the Lerzo backend is unreachable
//   - 'renderer' : internet + backend are fine, the app content failed to load
async function classifyConnectivity() {
    let hasInternet = true;
    try {
        hasInternet = net.isOnline();
    } catch {
        hasInternet = true;
    }

    let backendReachable = false;
    try {
        const config = getApiConfig();
        const result = await probeBackendHealth(config, { timeoutMs: 5000 });
        backendReachable = Boolean(result && result.reachable);
    } catch {
        backendReachable = false;
    }

    let reason = 'renderer';
    if (!hasInternet && !backendReachable) {
        reason = 'network';
    } else if (!backendReachable) {
        reason = 'server';
    }

    return { reason, internet: hasInternet, backend: backendReachable };
}

async function showConnectivityFallback(offlinePath, context = {}) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!fs.existsSync(offlinePath)) {
        mainWindow.show();
        return;
    }

    const status = await classifyConnectivity();
    startupLog('Connectivity fallback', { ...context, ...status });

    try {
        await mainWindow.loadFile(offlinePath, {
            query: {
                reason: status.reason,
                internet: status.internet ? '1' : '0',
                backend: status.backend ? '1' : '0',
            },
        });
    } catch (error) {
        recordLoadFailure(error, offlinePath);
    }
}

function getPersistSession() {
    return session.fromPartition('persist:lerzo');
}

function allowGeolocationForSession(targetSession) {
    targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
        if (permission === 'geolocation') {
            console.log('[Electron] geolocation permission requested by', details?.requestingUrl || webContents.getURL());
            callback(true);
            return;
        }
        callback(false);
    });

    targetSession.setPermissionCheckHandler((_webContents, permission) => {
        if (permission === 'geolocation') {
            return true;
        }
        return false;
    });
}

function loadStoredEmails() {
    try {
        if (!fs.existsSync(AUTH_SUGGESTIONS_FILE)) return [];
        const raw = fs.readFileSync(AUTH_SUGGESTIONS_FILE);
        const decrypted = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
        const data = JSON.parse(decrypted);
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function saveStoredEmails(list) {
    try {
        const payload = JSON.stringify(list.slice(0, 10));
        const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(payload) : Buffer.from(payload, 'utf8');
        fs.writeFileSync(AUTH_SUGGESTIONS_FILE, data);
        return true;
    } catch {
        return false;
    }
}

function loadSecureAuthToken() {
    try {
        if (!fs.existsSync(AUTH_TOKEN_FILE)) return null;
        const raw = fs.readFileSync(AUTH_TOKEN_FILE);
        const token = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
        return token && token.trim() ? token.trim() : null;
    } catch {
        return null;
    }
}

function saveSecureAuthToken(token) {
    try {
        if (!token || typeof token !== 'string') {
            clearSecureAuthToken();
            return false;
        }
        const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(token) : Buffer.from(token, 'utf8');
        fs.writeFileSync(AUTH_TOKEN_FILE, data);
        return true;
    } catch {
        return false;
    }
}

function clearSecureAuthToken() {
    try {
        if (fs.existsSync(AUTH_TOKEN_FILE)) {
            fs.unlinkSync(AUTH_TOKEN_FILE);
        }
        return true;
    } catch {
        return false;
    }
}

function authProbeLog(message) {
    if (process.env.LERZO_AUTH_PROBE !== '1') return;
    const logPath = process.env.LERZO_AUTH_PROBE_LOG;
    if (!logPath) return;
    try {
        fs.appendFileSync(logPath, `${message}\n`);
    } catch {
        // ignore probe logging failures
    }
}

async function runAuthLifecycleProbe() {
    if (process.env.LERZO_AUTH_PROBE !== '1' || !mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    authProbeLog('PROBE_BOOT');

    const waitForRenderer = async (timeoutMs = 12000) => {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            if (rendererLoadedOnce) return true;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return rendererLoadedOnce;
    };

    if (!(await waitForRenderer())) {
        authProbeLog('PROBE_BOOT_TIMEOUT');
        app.quit();
        return;
    }

    authProbeLog('PROBE_AUTH_PROVIDER');

    const existingToken = loadSecureAuthToken();

    // ---- Watch recursion sub-test (no valid token required) ----
    // Reproduces the exact renderer path that previously overflowed the stack:
    // clicking "Continue with Google" starts the completion watch, then a
    // 'lerzo-login-complete' event drives the watch's completion handler.
    if (existingToken) {
        clearSecureAuthToken();
    }
    navigateMainWindow('#/auth-login');
    await new Promise((resolve) => setTimeout(resolve, 1500));

    await mainWindow.webContents.executeJavaScript(`
        (function () {
            window.__probeErrors = [];
            window.addEventListener('error', function (e) {
                window.__probeErrors.push((e.error && e.error.message) ? e.error.message : String(e.message || ''));
            });
        })();
        true;
    `, true).catch(() => {});

    const clicked = await mainWindow.webContents.executeJavaScript(`
        (function () {
            var btn = document.getElementById('google-login-btn');
            if (btn) { btn.click(); return true; }
            return false;
        })();
    `, true).catch(() => false);
    authProbeLog(`PROBE_LOGIN_WATCH_STARTED clicked=${clicked ? 'yes' : 'no'}`);
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Fire the completion event repeatedly to stress the watch for re-entrancy.
    await mainWindow.webContents.executeJavaScript(`
        (function () {
            for (var i = 0; i < 3; i++) {
                window.dispatchEvent(new CustomEvent('lerzo-login-complete'));
            }
        })();
        true;
    `, true).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 600));

    const watchErrors = await mainWindow.webContents.executeJavaScript(
        'JSON.stringify(window.__probeErrors || [])',
        true,
    ).catch(() => '[]');
    if (/call stack size exceeded/i.test(watchErrors)) {
        authProbeLog(`PROBE_WATCH_OVERFLOW ${watchErrors}`);
    } else {
        authProbeLog('PROBE_WATCH_NO_OVERFLOW');
    }

    // ---------------------------------------------------------------
    // Transaction / replay guard tests (no valid token or network needed)
    // ---------------------------------------------------------------
    clearPendingLogin();
    consumedNonces.clear();
    setLoginState(LOGIN_STATE.IDLE, { reason: 'probe_reset' });
    clearSecureAuthToken();

    // 1) A callback with no active login request must be rejected outright.
    let guard = await handleAuthCallback('lerzo://auth-success?token=faketok&state=deadbeefdeadbeef', 'probe-no-active');
    authProbeLog(`PROBE_GUARD_NO_ACTIVE ${guard === false && !loadSecureAuthToken() ? 'pass' : 'fail'}`);

    // 2) A callback whose state does not match the pending nonce is rejected,
    //    and the pending login survives (still awaiting the real callback).
    beginLoginTransaction();
    guard = await handleAuthCallback('lerzo://auth-success?token=faketok&state=wrongstatewrongstate', 'probe-mismatch');
    authProbeLog(`PROBE_GUARD_STATE_MISMATCH ${guard === false && !loadSecureAuthToken() && isPendingLoginActive() ? 'pass' : 'fail'}`);

    // 3) A callback with no state at all is rejected.
    guard = await handleAuthCallback('lerzo://auth-success?token=faketok', 'probe-missing-state');
    authProbeLog(`PROBE_GUARD_MISSING_STATE ${guard === false && !loadSecureAuthToken() ? 'pass' : 'fail'}`);

    // Reset before the accept-path flow.
    clearPendingLogin();
    consumedNonces.clear();
    setLoginState(LOGIN_STATE.IDLE, { reason: 'probe_reset_2' });

    // ---------------------------------------------------------------
    // End-to-end accept-path tests against a LOCAL mock /me (no network).
    // Covers: second-instance receipt (item 4), callback acceptance (item 5),
    // immediate renderer notification (item 6), and no-auto-logout (item 8).
    // ---------------------------------------------------------------
    try {
        const http = require('http');
        let meStatus = 200;
        const mockServer = http.createServer((req, res) => {
            if (req.url && req.url.startsWith('/me')) {
                res.writeHead(meStatus, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(meStatus === 200 ? { user: { id: 1, email: 'probe@lerzo.test' } } : { error: 'invalid' }));
                return;
            }
            res.writeHead(404);
            res.end();
        });
        await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
        const mockMeUrl = `http://127.0.0.1:${mockServer.address().port}/me`;
        const realConfig = getApiConfig();
        const realMeUrl = realConfig.meUrl;
        realConfig.meUrl = mockMeUrl;

        // Item 6 groundwork: capture the immediate renderer notification.
        await mainWindow.webContents.executeJavaScript(`
            window.__probeNotified = false;
            if (window.electronAPI && window.electronAPI.onAuthTokenReceived) {
                window.electronAPI.onAuthTokenReceived(function () { window.__probeNotified = true; });
            }
            true;
        `, true).catch(() => {});

        // Item 8: an existing valid session must survive a FAILED new login.
        saveSecureAuthToken('EXISTING_SESSION_TOKEN');
        meStatus = 401;
        const failNonce = beginLoginTransaction();
        await handleAuthCallback(`lerzo://auth-success?token=NEWBADTOKEN&state=${failNonce}`, 'second-instance');
        const sessionPreserved = loadSecureAuthToken() === 'EXISTING_SESSION_TOKEN';
        authProbeLog(`PROBE_NO_AUTOLOGOUT ${sessionPreserved ? 'pass' : 'fail'}`);

        // Item 4 + 5: a matching-state callback arriving via the second-instance
        // path (Windows deep link) is ACCEPTED and authenticates.
        clearSecureAuthToken();
        clearPendingLogin();
        consumedNonces.clear();
        setLoginState(LOGIN_STATE.IDLE, { reason: 'probe_e2e_reset' });
        meStatus = 200;
        const okNonce = beginLoginTransaction();
        const okUrl = `lerzo://auth-success?token=GOODTOKEN123&state=${okNonce}`;
        const accepted = await handleAuthCallback(okUrl, 'second-instance');
        const acceptOk = accepted !== false
            && loginState === LOGIN_STATE.AUTHENTICATED
            && loadSecureAuthToken() === 'GOODTOKEN123';
        authProbeLog(`PROBE_SECOND_INSTANCE_ACCEPTED ${acceptOk ? 'pass' : 'fail'}`);

        // Item 6: the renderer received the immediate login-complete notification.
        await new Promise((resolve) => setTimeout(resolve, 600));
        const notified = await mainWindow.webContents.executeJavaScript('Boolean(window.__probeNotified)', true).catch(() => false);
        authProbeLog(`PROBE_RENDERER_NOTIFIED ${notified ? 'pass' : 'fail'}`);

        // Restore + cleanup.
        realConfig.meUrl = realMeUrl;
        mockServer.close();
        clearSecureAuthToken();
        clearPendingLogin();
        consumedNonces.clear();
        setLoginState(LOGIN_STATE.IDLE, { reason: 'probe_e2e_done' });
    } catch (error) {
        authProbeLog(`PROBE_E2E_ERROR ${error && error.message ? error.message : String(error)}`);
    }

    if (!existingToken) {
        authProbeLog('PROBE_NO_TOKEN_SKIP_FULL_FLOW');
        app.quit();
        return;
    }

    authProbeLog('PROBE_CALLBACK');
    const acceptNonce = beginLoginTransaction();
    const callbackUrl = `lerzo://auth-success?token=${encodeURIComponent(existingToken)}&state=${acceptNonce}`;
    await handleAuthCallback(callbackUrl, 'probe-accept');

    // Replay of the exact same callback (stale tab / duplicate delivery) must be
    // rejected now that the nonce is consumed and no login is pending.
    const replay = await handleAuthCallback(callbackUrl, 'probe-replay');
    authProbeLog(`PROBE_REPLAY_REJECTED ${replay === false ? 'pass' : 'fail'}`);

    const deadline = Date.now() + 20000;
    let dashboardReady = false;
    while (Date.now() < deadline) {
        const state = await mainWindow.webContents.executeJavaScript(`
            ({
                hash: window.location.hash || '',
                hasUser: Boolean(localStorage.getItem('lerzo_user')),
            })
        `, true).catch(() => ({ hash: '', hasUser: false }));

        authProbeLog(`PROBE_ROUTES hash=${state.hash || '(empty)'} user=${state.hasUser ? 'yes' : 'no'}`);
        if (state.hash.includes('dashboard') && state.hasUser) {
            dashboardReady = true;
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const probeErrors = await mainWindow.webContents.executeJavaScript(
        'JSON.stringify(window.__probeErrors || [])',
        true,
    ).catch(() => '[]');
    const overflow = /call stack size exceeded/i.test(probeErrors);
    authProbeLog(overflow ? `PROBE_OVERFLOW ${probeErrors}` : 'PROBE_NO_OVERFLOW');

    if (dashboardReady && !overflow) {
        authProbeLog('PROBE_DASHBOARD');
        const logoutState = await mainWindow.webContents.executeJavaScript(`
            (async () => {
                try {
                    await window.electronAPI?.clearAuthSession?.();
                } catch {}
                window.location.hash = '#/auth-login';
                localStorage.removeItem('lerzo_user');
                return {
                    hash: window.location.hash || '',
                    hasUser: Boolean(localStorage.getItem('lerzo_user')),
                };
            })()
        `, true).catch(() => ({ hash: '', hasUser: true }));

        await new Promise((resolve) => setTimeout(resolve, 800));
        const logoutClean = (logoutState.hash || '').includes('auth-login')
            && !logoutState.hasUser
            && !loadSecureAuthToken()
            && loginState === LOGIN_STATE.LOGGED_OUT
            && !pendingLogin
            && consumedNonces.size === 0;
        authProbeLog(logoutClean ? 'PROBE_LOGOUT' : 'PROBE_LOGOUT_FAILED');

        // After logout, a fresh login transaction must work again (logout -> login).
        const reNonce = beginLoginTransaction();
        const reLoginAccepted = loginState === LOGIN_STATE.WAITING_CALLBACK && isPendingLoginActive();
        authProbeLog(`PROBE_RELOGIN_READY ${reLoginAccepted && reNonce ? 'pass' : 'fail'}`);
        clearPendingLogin();
    } else {
        authProbeLog('PROBE_DASHBOARD_TIMEOUT');
    }

    app.quit();
}

function rememberEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const normalized = email.trim().toLowerCase();
    if (!normalized) return false;
    const existing = loadStoredEmails().filter((item) => item !== normalized);
    existing.unshift(normalized);
    return saveStoredEmails(existing);
}

function getAuthCookies() {
    return getPersistSession().cookies.get({ name: 'lerzo_session' });
}

async function updateTokenSnapshot() {
    try {
        const cookies = await getAuthCookies();
        const sessionCookie = cookies && cookies[0];
        if (!sessionCookie) {
            apiMonitorState.tokenStatus = { state: 'missing', expiresIn: null, expiresAt: null };
            return apiMonitorState.tokenStatus;
        }

        const expiresAt = sessionCookie.expirationDate ? new Date(sessionCookie.expirationDate * 1000) : null;
        const expiresIn = expiresAt ? Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000)) : null;

        apiMonitorState.tokenStatus = {
            state: 'valid',
            expiresIn,
            expiresAt: expiresAt ? expiresAt.toISOString() : null
        };
        return apiMonitorState.tokenStatus;
    } catch {
        apiMonitorState.tokenStatus = { state: 'unknown', expiresIn: null, expiresAt: null };
        return apiMonitorState.tokenStatus;
    }
}

function getApiMonitorSnapshot() {
    return apiMonitorState;
}

function pushMonitorEvent(event) {
    if (!event || !event.url) return;
    const next = {
        timestamp: event.timestamp || new Date().toISOString(),
        method: event.method || 'GET',
        endpoint: event.endpoint || event.url,
        url: event.url,
        page: event.page || '',
        requestPayload: event.requestPayload ?? null,
        responseStatus: event.responseStatus ?? null,
        responseText: event.responseText ?? null,
        responseTimeMs: event.responseTimeMs ?? null,
        failed: Boolean(event.failed),
        error: event.error || null,
        retryCount: event.retryCount || 0,
        source: event.source || 'fetch'
    };
    apiMonitorState.requests.unshift(next);
    apiMonitorState.requests = apiMonitorState.requests.slice(0, 250);

    if (next.failed) {
        apiMonitorState.errors.unshift({
            timestamp: next.timestamp,
            type: 'api',
            message: next.error || `Request failed: ${next.method} ${next.endpoint}`,
            endpoint: next.endpoint,
            page: next.page
        });
        apiMonitorState.errors = apiMonitorState.errors.slice(0, 100);
    }
}

async function pingBackend() {
    const config = getApiConfig();
    const result = await probeBackendHealth(config, { timeoutMs: 5000 });
    startupLog('Backend health probe', {
        apiBaseUrl: config.apiBaseUrl,
        healthUrl: result.healthUrl,
        status: result.status,
        reachable: result.reachable,
        latencyMs: result.latencyMs,
        error: result.error || null,
    });
    apiMonitorState.network.backendReachable = result.reachable;
    apiMonitorState.network.apiConnected = result.reachable;
    apiMonitorState.network.databaseReachable = result.reachable;
    apiMonitorState.network.lastLatencyMs = result.latencyMs;
    apiMonitorState.network.lastCheckedAt = new Date().toISOString();
    apiMonitorState.network.status = result.reachable
        ? ((result.latencyMs || 0) > 1200 ? 'slow' : 'connected')
        : 'offline';
}

function bootstrapApiMonitorBridge() {
    const script = String.raw`
      (() => {
        if (window.__lerzoApiMonitorInstalled) return;
        window.__lerzoApiMonitorInstalled = true;
        const originalFetch = window.fetch ? window.fetch.bind(window) : null;
        const originalXhrOpen = XMLHttpRequest.prototype.open;
        const originalXhrSend = XMLHttpRequest.prototype.send;
        const lastRequestAt = new Map();
        const page = location.pathname + location.hash;

        const makeKey = (method, url, body) => {
          return [method.toUpperCase(), url, typeof body === 'string' ? body : JSON.stringify(body || null)].join('::');
        };

        const nowIso = () => new Date().toISOString();
        const queueable = (method, url, body) => {
          const key = makeKey(method, url, body);
          const last = lastRequestAt.get(key) || 0;
          const retryCount = last ? 1 : 0;
          lastRequestAt.set(key, Date.now());
          return { key, retryCount };
        };

        if (originalFetch) {
          window.fetch = async function(input, init = {}) {
            const method = (init.method || (input && input.method) || 'GET').toUpperCase();
            const url = typeof input === 'string' ? input : (input && input.url) || String(input);
            const body = init.body || (input && input.body) || null;
            const keyInfo = queueable(method, url, body);

            const startedAt = performance.now();
            const payload = typeof body === 'string' ? body : (body ? '[binary/body]' : null);
            const request = originalFetch(input, { ...init, credentials: init.credentials || 'include' });
            const wrapped = request.then(async (response) => {
              let responseText = '';
              try {
                responseText = await response.clone().text();
              } catch (e) {
                responseText = '';
              }
              window.electronAPI?.recordApiEvent?.({
                timestamp: nowIso(),
                method,
                url,
                endpoint: url,
                page,
                requestPayload: payload,
                responseStatus: response.status,
                responseText,
                responseTimeMs: Math.round(performance.now() - startedAt),
                failed: !response.ok,
                retryCount: keyInfo.retryCount,
                source: 'fetch'
              });
              return response;
            }).catch((error) => {
              window.electronAPI?.recordApiEvent?.({
                timestamp: nowIso(),
                method,
                url,
                endpoint: url,
                page,
                requestPayload: payload,
                responseStatus: null,
                responseText: '',
                responseTimeMs: Math.round(performance.now() - startedAt),
                failed: true,
                error: error?.message || String(error),
                retryCount: keyInfo.retryCount,
                source: 'fetch'
              });
              throw error;
            });
            return wrapped;
          };
        }

        XMLHttpRequest.prototype.open = function(method, url) {
          this.__lerzoMethod = method;
          this.__lerzoUrl = url;
          return originalXhrOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function(body) {
          const method = (this.__lerzoMethod || 'GET').toUpperCase();
          const url = this.__lerzoUrl || '';
          const payload = typeof body === 'string' ? body : (body ? '[binary/body]' : null);
          const keyInfo = queueable(method, url, body);
          const startedAt = performance.now();
          this.addEventListener('loadend', () => {
              window.electronAPI?.recordApiEvent?.({
                timestamp: nowIso(),
                method,
                url,
                endpoint: url,
              page,
              requestPayload: payload,
              responseStatus: this.status || null,
              responseText: this.responseText || '',
              responseTimeMs: Math.round(performance.now() - startedAt),
              failed: this.status >= 400 || this.status === 0,
              retryCount: keyInfo.retryCount,
              source: 'xhr'
            });
          });
          return originalXhrSend.apply(this, arguments);
        };

        window.addEventListener('error', (event) => {
          window.electronAPI?.recordRuntimeError?.({
            timestamp: nowIso(),
            type: 'react',
            message: event.message || 'Unknown renderer error',
            source: event.filename || '',
            line: event.lineno || null,
            column: event.colno || null
          });
        });

        window.addEventListener('unhandledrejection', (event) => {
          window.electronAPI?.recordRuntimeError?.({
            timestamp: nowIso(),
            type: 'auth',
            message: event.reason?.message || String(event.reason || 'Unhandled rejection'),
            source: 'promise',
            line: null,
            column: null
          });
        });

        const lastClickMap = new WeakMap();
        document.addEventListener('click', (event) => {
          const target = event.target.closest('button, a, input[type="submit"]');
          if (!target) return;
          const lastAt = lastClickMap.get(target) || 0;
          const delta = Date.now() - lastAt;
          if (delta < 750) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          lastClickMap.set(target, Date.now());
        }, true);

        document.addEventListener('submit', (event) => {
          const form = event.target;
          if (!(form instanceof HTMLFormElement)) return;
          const lastAt = Number(form.dataset.lerzoLastSubmit || 0);
          const delta = Date.now() - lastAt;
          if (delta < 1000) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          form.dataset.lerzoLastSubmit = String(Date.now());
        }, true);
      })();
    `;

    const install = () => {
        const scriptTag = mainWindow?.webContents;
        if (!scriptTag) return;
        mainWindow.webContents.executeJavaScript(script, true).catch(() => {});
    };

    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.on('did-finish-load', install);
    }
}

function createSplashWindow() {
    try {
        splashWindow = new BrowserWindow({
            width: 600,
            height: 400,
            transparent: true,
            frame: false,
            alwaysOnTop: true,
            ...(APP_ICON ? { icon: APP_ICON } : {}),
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });
        const splashPath = path.join(app.getAppPath(), 'splash', 'splash.html');
        splashWindow.loadFile(splashPath).catch((error) => {
            startupLog('Splash load failed', { splashPath, message: error?.message || String(error) });
        });
        scheduleSplashFallback();
    } catch {
        splashWindow = null;
    }
}

function navigateMainWindow(hash = '') {
    if (!mainWindow) return;

    if (!IS_PROD) {
        const targetUrl = getElectronStartUrl(hash);
        startupLog('Loading renderer (dev)', { targetUrl });
        mainWindow.loadURL(targetUrl).catch((error) => recordLoadFailure(error, targetUrl));
        return;
    }

    const indexPath = getRendererIndexPath();
    const routeHash = normalizeRouteHash(hash);
    startupLog('Loading renderer (prod)', {
        indexPath,
        routeHash,
        exists: fs.existsSync(indexPath),
        appPath: app.getAppPath(),
        dirname: __dirname,
        resourcesPath: process.resourcesPath
    });

    if (!fs.existsSync(indexPath)) {
        recordLoadFailure(new Error(`Packaged renderer is missing: ${indexPath}`), indexPath);
        const offlinePath = path.join(app.getAppPath(), 'offline', 'offline.html');
        if (fs.existsSync(offlinePath)) {
            mainWindow.loadFile(offlinePath).catch((error) => recordLoadFailure(error, offlinePath));
        }
        return;
    }

    const loadOptions = routeHash ? { hash: routeHash } : undefined;
    mainWindow.loadFile(indexPath, loadOptions).catch((error) => recordLoadFailure(error, indexPath));
}

async function navigateRendererHash(hash = '#/dashboard') {
    if (!mainWindow) return false;

    const normalizedHash = hash.startsWith('#') ? hash : `#${hash}`;
    const hashValue = normalizedHash.replace(/^#/, '');

    const notifyRenderer = async () => {
        await mainWindow.webContents.executeJavaScript(`
            if (window.location.hash !== '#${hashValue}') {
                window.location.hash = '#${hashValue}';
            }
        `, true);
    };

    try {
        const currentUrl = mainWindow.webContents.getURL();
        const rendererReady = currentUrl.startsWith('file://') || (!IS_PROD && currentUrl.startsWith(RENDERER_DEV_URL));

        if (rendererReady && !mainWindow.webContents.isLoadingMainFrame()) {
            await notifyRenderer();
            return true;
        }

        if (mainWindow.webContents.isLoadingMainFrame()) {
            await new Promise((resolve) => {
                mainWindow.webContents.once('did-finish-load', resolve);
            });
            await notifyRenderer();
            return true;
        }

        navigateMainWindow(normalizedHash);
        return true;
    } catch (error) {
        console.error('[Electron Auth] hash navigation failed =', error);
        navigateMainWindow(normalizedHash);
        return false;
    }
}

async function verifyDesktopAuthToken(token) {
    const config = getApiConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
        const response = await fetch(config.meUrl, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/json'
            }
        });
        console.log('[Electron Auth] /me status =', response.status);
        authLog('ME_RESPONSE', { status: response.status });
        if (!response.ok) {
            throw new Error(`Desktop auth verification failed with ${response.status}`);
        }
        try {
            const payload = await response.json();
            if (payload && payload.user) {
                apiMonitorState.currentUser = payload.user;
            }
        } catch {
            // A valid HTTP response is enough to continue; user data will be refreshed by the renderer.
        }
        return true;
    } finally {
        clearTimeout(timeout);
    }
}

function showLoginAfterAuthFailure(message) {
    clearSecureAuthToken();
    const encoded = encodeURIComponent(message || 'Could not verify desktop login. Please try again.');
    const targetHash = `#/auth-error?message=${encoded}`;

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth-session-cleared');
        void mainWindow.webContents.executeJavaScript(`
            window.dispatchEvent(new CustomEvent('lerzo-auth-changed'));
            window.location.hash = '${targetHash}';
        `, true).catch(() => {
            navigateMainWindow(targetHash);
        });
    } else {
        navigateMainWindow(targetHash);
    }

    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
}

let authCallbackInFlight = null;
let lastHandledAuthToken = null;

// ---------------------------------------------------------------------------
// Production-safe login transaction + state machine
// ---------------------------------------------------------------------------
// Every login is a transaction bound to a single-use `state` nonce that is:
//   1. generated the instant the user clicks "Continue with Google"
//   2. attached to the OAuth request that opens in the browser
//   3. echoed back inside the lerzo://auth-success deep link
//   4. validated + consumed exactly once when the callback returns
// A callback is ONLY accepted while the machine is WAITING_CALLBACK, its state
// matches the pending nonce, and that nonce has not already been consumed.
// This makes stale tabs, refreshes, back/forward, duplicate open-url /
// second-instance / IPC / argv deliveries, and cached callbacks all inert.
const LOGIN_STATE = Object.freeze({
    IDLE: 'IDLE',
    LOGIN_STARTED: 'LOGIN_STARTED',
    WAITING_CALLBACK: 'WAITING_CALLBACK',
    VERIFYING: 'VERIFYING',
    AUTHENTICATED: 'AUTHENTICATED',
    LOGGED_OUT: 'LOGGED_OUT',
});

const PENDING_LOGIN_FILE = path.join(app.getPath('userData'), 'pending-login.json');
// A started login must be completed within this window (covers the Google popup
// plus first-time registration). Persisting the pending transaction lets a
// genuine login survive an app restart mid-flow while still expiring so it can
// never become a permanent replay vector.
const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000;

let loginState = LOGIN_STATE.IDLE;
let pendingLogin = null; // { nonce, createdAt, expiresAt }
const consumedNonces = new Set();

function redactNonce(nonce) {
    if (!nonce || typeof nonce !== 'string') return '(none)';
    return `${nonce.slice(0, 6)}…`;
}

function authLog(event, details) {
    const suffix = details && Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
    const line = `[AUTH] ${event}${suffix}`;
    console.log(line);
    try {
        const logDir = path.dirname(getLogFilePath());
        fs.mkdirSync(logDir, { recursive: true });
        fs.appendFileSync(getLogFilePath(), `[${new Date().toISOString()}] ${line}\n`);
    } catch {
        // Logging must never break auth.
    }
    authProbeLog(`AUTHLOG ${event}${suffix}`);
}

function setLoginState(next, details) {
    if (loginState === next) return;
    const prev = loginState;
    loginState = next;
    authLog('STATE', { from: prev, to: next, ...(details || {}) });
}

function getLoginStateSnapshot() {
    return {
        loginState,
        pending: Boolean(pendingLogin),
        pendingExpiresAt: pendingLogin ? pendingLogin.expiresAt : null,
        consumedCount: consumedNonces.size,
    };
}

function persistPendingLogin() {
    try {
        if (!pendingLogin) {
            if (fs.existsSync(PENDING_LOGIN_FILE)) fs.unlinkSync(PENDING_LOGIN_FILE);
            return;
        }
        const data = safeStorage.isEncryptionAvailable()
            ? safeStorage.encryptString(JSON.stringify(pendingLogin))
            : Buffer.from(JSON.stringify(pendingLogin), 'utf8');
        fs.writeFileSync(PENDING_LOGIN_FILE, data);
    } catch {
        // Non-fatal: pending login simply won't survive a restart.
    }
}

function loadPersistedPendingLogin() {
    try {
        if (!fs.existsSync(PENDING_LOGIN_FILE)) return null;
        const raw = fs.readFileSync(PENDING_LOGIN_FILE);
        const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
        const data = JSON.parse(json);
        if (!data || typeof data.nonce !== 'string' || typeof data.expiresAt !== 'number') return null;
        if (Date.now() > data.expiresAt) {
            fs.unlinkSync(PENDING_LOGIN_FILE);
            return null;
        }
        return data;
    } catch {
        return null;
    }
}

function clearPendingLogin() {
    pendingLogin = null;
    try {
        if (fs.existsSync(PENDING_LOGIN_FILE)) fs.unlinkSync(PENDING_LOGIN_FILE);
    } catch {
        // ignore
    }
}

function beginLoginTransaction() {
    const nonce = crypto.randomBytes(24).toString('hex');
    const now = Date.now();
    pendingLogin = { nonce, createdAt: now, expiresAt: now + PENDING_LOGIN_TTL_MS };
    persistPendingLogin();
    setLoginState(LOGIN_STATE.WAITING_CALLBACK, { nonce: redactNonce(nonce) });
    authLog('LOGIN_STARTED', { nonce: redactNonce(nonce), ttlMs: PENDING_LOGIN_TTL_MS });
    return nonce;
}

function isPendingLoginActive() {
    if (!pendingLogin) return false;
    if (Date.now() > pendingLogin.expiresAt) {
        authLog('PENDING_EXPIRED', { nonce: redactNonce(pendingLogin.nonce) });
        clearPendingLogin();
        if (loginState === LOGIN_STATE.WAITING_CALLBACK) {
            setLoginState(loadSecureAuthToken() ? LOGIN_STATE.AUTHENTICATED : LOGIN_STATE.IDLE, { reason: 'pending_expired' });
        }
        return false;
    }
    return true;
}

function appendQueryParam(url, key, value) {
    if (!url || !value) return url;
    try {
        const parsed = new URL(url);
        parsed.searchParams.set(key, value);
        return parsed.toString();
    } catch {
        const sep = url.includes('?') ? '&' : '?';
        return `${url}${sep}${key}=${encodeURIComponent(value)}`;
    }
}

// Build the browser login URL for a desktop login transaction. It always carries
// desktop=1 (so the backend treats it as an Electron flow) and the single-use
// state nonce (so the deep link can be tied back to this exact request).
function buildDesktopLoginUrl(baseUrl, nonce) {
    let target = appendQueryParam(baseUrl, 'desktop', '1');
    target = appendQueryParam(target, 'state', nonce);
    return target;
}

function parseDesktopAuthCallback(callbackUrl) {
    if (!callbackUrl || typeof callbackUrl !== 'string' || !callbackUrl.startsWith('lerzo://')) {
        return null;
    }

    try {
        const parsed = new URL(callbackUrl);
        const host = String(parsed.hostname || '').toLowerCase();
        const path = String(parsed.pathname || '').toLowerCase();

        if (host === 'auth' && path === '/register') {
            return { type: 'register', params: parsed.searchParams };
        }

        const token = parsed.searchParams.get('token');
        const state = parsed.searchParams.get('state');
        const isAuthCallback =
            (host === 'auth' && (path === '/callback' || path === '/success'))
            || host === 'auth-success'
            || host === 'callback'
            || (host === 'auth' && (!path || path === '/'));

        if (!isAuthCallback) {
            return null;
        }

        return { type: 'auth', token, state };
    } catch {
        return null;
    }
}

// After a callback is verified we push the login result to the renderer and wait
// for it to acknowledge that it refreshed its auth state and left the
// "Authenticating..." screen. If no ack arrives within this window the renderer
// is force-refreshed (soft SPA reload) — never an application restart.
const RENDERER_ACK_TIMEOUT_MS = 2000;
let rendererAckTimer = null;

function clearRendererAckTimer() {
    if (rendererAckTimer) {
        clearTimeout(rendererAckTimer);
        rendererAckTimer = null;
    }
}

async function forceRendererSessionRefresh(reason) {
    clearRendererAckTimer();
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    // If the renderer already made it to the dashboard we're done — the ack was
    // simply slow/lost. Otherwise the renderer is stuck; reload the SPA. The JWT
    // is already stored, so the auth bootstrap re-derives the session instantly
    // without an application restart.
    const state = await mainWindow.webContents.executeJavaScript(`
        ({ hash: window.location.hash || '', hasUser: Boolean(localStorage.getItem('lerzo_user')) })
    `, true).catch(() => ({ hash: '', hasUser: false }));

    if (state.hash.includes('dashboard') && state.hasUser) {
        authLog('RENDERER_REFRESH_SKIPPED_ALREADY_READY', { reason });
        return;
    }

    authLog('RENDERER_REFRESH_FORCED', { reason, hash: state.hash || '(empty)' });
    // Nudge the renderer first (cheap), then hard-reload it to the dashboard.
    mainWindow.webContents.send('auth-token-received');
    await mainWindow.webContents.executeJavaScript(`
        window.dispatchEvent(new CustomEvent('lerzo-auth-changed'));
        window.dispatchEvent(new CustomEvent('lerzo-login-complete'));
    `, true).catch(() => {});
    navigateMainWindow('#/dashboard');
}

function armRendererAckWatchdog() {
    clearRendererAckTimer();
    rendererAckTimer = setTimeout(() => {
        rendererAckTimer = null;
        void forceRendererSessionRefresh('ack_timeout');
    }, RENDERER_ACK_TIMEOUT_MS);
}

// Tell the renderer a login attempt it is actively waiting on has failed so it
// leaves "Authenticating...", shows a retry message and re-enables the button —
// instead of polling until its own timeout.
function notifyRendererLoginFailed(reason) {
    clearRendererAckTimer();
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    authLog('RENDERER_LOGIN_FAILED_NOTIFIED', { reason });
    mainWindow.webContents.send('auth-login-failed', reason);
    mainWindow.webContents.executeJavaScript(
        `window.dispatchEvent(new CustomEvent('lerzo-login-failed', { detail: ${JSON.stringify(String(reason || 'login_failed'))} }));`,
        true,
    ).catch(() => {});
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

async function notifyRendererLoginComplete() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    // Explicit IPC push so the renderer refreshes auth + navigates immediately.
    mainWindow.webContents.send('auth-token-received');
    await mainWindow.webContents.executeJavaScript(`
        window.dispatchEvent(new CustomEvent('lerzo-login-complete'));
        window.dispatchEvent(new CustomEvent('lerzo-auth-changed'));
    `, true).catch(() => {});
    authLog('RENDERER_NOTIFIED', {});
    armRendererAckWatchdog();
}

async function completeDesktopLoginAfterAuth(token) {
    if (!mainWindow && app.isReady()) {
        createMainWindow();
    }
    if (!mainWindow) {
        return false;
    }

    await notifyRendererLoginComplete();
    startupLog('Desktop login completed', { tokenSaved: Boolean(token) });
    authLog('LOGIN_COMPLETE_NOTIFIED', {});
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return true;
}

async function handleAuthCallback(callbackUrl, source = 'unknown') {
    const parsedCallback = parseDesktopAuthCallback(callbackUrl);
    const redactedUrl = callbackUrl
        ? callbackUrl.split('token=')[0].split('state=')[0] + (callbackUrl.includes('token=') ? 'token=<redacted>' : '')
        : '(empty)';
    authLog('CALLBACK_RECEIVED', { source, url: redactedUrl });

    if (!parsedCallback) {
        authLog('CALLBACK_REJECTED', { source, reason: 'unsupported_url' });
        return false;
    }

    // Registration navigation is part of an in-progress login: only honor it
    // while a transaction is genuinely pending (does NOT consume the nonce; the
    // user still has to finish registration, which then emits auth-success).
    if (parsedCallback.type === 'register') {
        if (!isPendingLoginActive()) {
            authLog('CALLBACK_REJECTED', { source, reason: 'register_without_active_login' });
            return false;
        }
        const params = parsedCallback.params;
        if (!mainWindow && app.isReady()) {
            createMainWindow();
        }
        if (!mainWindow) return false;
        const hashParams = new URLSearchParams();
        ['email', 'name', 'google_id'].forEach((key) => {
            const value = params.get(key);
            if (value) hashParams.set(key, value);
        });
        const hash = hashParams.toString() ? `#/auth-register?${hashParams.toString()}` : '#/auth-register';
        navigateMainWindow(hash);
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        authLog('REGISTER_NAV', { source });
        return true;
    }

    const token = parsedCallback.token;
    const state = parsedCallback.state;

    // ---- Transaction + replay guards (reject anything not tied to an active login) ----
    if (!isPendingLoginActive() || loginState !== LOGIN_STATE.WAITING_CALLBACK) {
        authLog('CALLBACK_REJECTED', { source, reason: 'no_active_login_request', loginState });
        return false;
    }
    if (!token) {
        // The user's own login came back without a token — surface a fast retry.
        authLog('CALLBACK_REJECTED', { source, reason: 'token_missing' });
        notifyRendererLoginFailed('token_missing');
        return false;
    }
    if (!state) {
        // Almost always the backend did not echo the state nonce (e.g. an older
        // server build). This is the user's active attempt failing — fast retry.
        authLog('CALLBACK_REJECTED', { source, reason: 'missing_state' });
        notifyRendererLoginFailed('missing_state');
        return false;
    }
    if (consumedNonces.has(state)) {
        // A replay of an already-used callback (stale tab / duplicate delivery):
        // the real login already succeeded or was handled — do NOT disturb it.
        authLog('CALLBACK_REJECTED', { source, reason: 'replay_consumed', state: redactNonce(state) });
        return false;
    }
    if (state !== pendingLogin.nonce) {
        // A callback from a DIFFERENT (older) login attempt. The real callback for
        // the current attempt may still be arriving, so keep waiting — do not
        // consume the pending login and do not prematurely reset the renderer.
        authLog('CALLBACK_REJECTED', {
            source,
            reason: 'state_mismatch',
            expected: redactNonce(pendingLogin.nonce),
            got: redactNonce(state),
        });
        return false;
    }
    if (authCallbackInFlight) {
        authLog('CALLBACK_REJECTED', { source, reason: 'callback_in_flight' });
        return authCallbackInFlight;
    }

    // Passed every check — consume the nonce IMMEDIATELY so the exact same
    // callback (stale tab, duplicate open-url, second-instance, refresh, etc.)
    // can never be accepted a second time.
    consumedNonces.add(state);
    clearPendingLogin();
    setLoginState(LOGIN_STATE.VERIFYING, { source });
    authLog('CALLBACK_ACCEPTED', { source, state: redactNonce(state) });

    authCallbackInFlight = (async () => {
        const hadExistingSession = Boolean(loadSecureAuthToken());
        try {
            // Verify BEFORE persisting so a bad/unreachable token can never
            // overwrite or wipe an existing valid session (no accidental logout).
            await verifyDesktopAuthToken(token);

            const tokenSaved = saveSecureAuthToken(token);
            authLog('JWT_SAVED', { ok: Boolean(tokenSaved) });
            if (!tokenSaved) {
                throw new Error('Unable to save desktop auth token');
            }

            lastHandledAuthToken = token;
            setLoginState(LOGIN_STATE.AUTHENTICATED, { source });
            authLog('AUTHENTICATED', { source });
            return await completeDesktopLoginAfterAuth(token);
        } catch (error) {
            const message = error && error.message ? error.message : String(error);
            authLog('CALLBACK_REJECTED', { source, reason: 'token_verify_failed', message });
            // Do NOT auto-logout: only the failed *new* token is discarded, and
            // only if there was no pre-existing session to protect.
            if (!hadExistingSession) {
                clearSecureAuthToken();
            }
            setLoginState(hadExistingSession ? LOGIN_STATE.AUTHENTICATED : LOGIN_STATE.IDLE, { reason: 'token_verify_failed' });
            notifyRendererLoginFailed('token_verify_failed');
            return false;
        } finally {
            authCallbackInFlight = null;
        }
    })();

    return authCallbackInFlight;
}

function createMainWindow() {
    const isMac = process.platform === 'darwin';

    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        show: false,
        frame: true,
        autoHideMenuBar: true,
        title: '', // Hide title text
        backgroundColor: '#141414',
        ...(APP_ICON ? { icon: APP_ICON } : {}),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            devTools: !IS_PROD || ELECTRON_DEBUG,
            partition: 'persist:lerzo'
        }
    });

    // Prevent page title updates from displaying in the native title bar
    mainWindow.on('page-title-updated', (event) => {
        event.preventDefault();
    });

    const initialHash = loadSecureAuthToken() ? '#/dashboard' : '#/auth-login';
    navigateMainWindow(initialHash);

    mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
        if (!ELECTRON_DEBUG && IS_PROD && level !== 3) return;
        const prefix = level === 3 ? '[Renderer Error]' : '[Renderer]';
        const rendered = `${prefix} ${message}${sourceId ? ` (${sourceId}:${line})` : ''}`;
        console.log(rendered);
        if (IS_PROD && level === 3) {
            startupLog(rendered);
        }
    });

    mainWindow.webContents.on('did-finish-load', () => {
        const url = mainWindow.webContents.getURL();
        startupLog('Renderer did-finish-load', { url });
        if (url.includes('index.html') || url.includes('/dist/') || url.startsWith(RENDERER_DEV_URL)) {
            rendererLoadedOnce = true;
            resetDevRendererRetries();
        }
    });

    // Handle failure to load
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || IGNORED_FAIL_LOAD_CODES.has(errorCode)) {
            return;
        }
        if (rendererLoadedOnce && validatedURL.includes('index.html')) {
            startupLog('Renderer did-fail-load ignored after successful boot', {
                errorCode,
                errorDescription,
                validatedURL,
            });
            return;
        }
        const offlinePath = path.join(app.getAppPath(), 'offline', 'offline.html');
        if (validatedURL === offlinePath || validatedURL.includes('offline/offline.html')) {
            return;
        }
        startupLog('Renderer did-fail-load', {
            errorCode,
            errorDescription,
            validatedURL,
            offlinePath,
            rendererLoadedOnce,
        });
        closeSplashWindow();
        apiMonitorState.errors.unshift({
            timestamp: new Date().toISOString(),
            type: 'electron',
            message: `Load failed: ${errorDescription}`,
            endpoint: validatedURL,
            page: ''
        });
        apiMonitorState.errors = apiMonitorState.errors.slice(0, 100);

        // Dev: Vite server may still be starting; silently retry instead of
        // flashing a misleading offline screen.
        if (!IS_PROD && validatedURL.startsWith(RENDERER_DEV_URL) && scheduleDevRendererRetry()) {
            return;
        }

        void showConnectivityFallback(offlinePath, { errorCode, errorDescription, validatedURL });
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
        console.error('[Renderer Error] render crash =', details.reason);
        apiMonitorState.errors.unshift({
            timestamp: new Date().toISOString(),
            type: 'electron',
            message: `Renderer process gone: ${details.reason}`,
            endpoint: '',
            page: ''
        });
        apiMonitorState.errors = apiMonitorState.errors.slice(0, 100);
        if (mainWindow && !mainWindow.isDestroyed()) {
            navigateMainWindow('#/auth-error?message=The%20app%20crashed.%20Please%20sign%20in%20again.');
        }
    });

    mainWindow.webContents.on('unresponsive', () => {
        apiMonitorState.errors.unshift({
            timestamp: new Date().toISOString(),
            type: 'electron',
            message: 'Renderer became unresponsive',
            endpoint: '',
            page: ''
        });
        apiMonitorState.errors = apiMonitorState.errors.slice(0, 100);
    });

    // Ensure session cookies are handled correctly
    const ses = getPersistSession();
    allowGeolocationForSession(session.defaultSession);
    allowGeolocationForSession(ses);
    
    // Explicitly allow cookies for our domain
    ses.cookies.on('changed', (event, cookie, cause, removed) => {
        if (!removed && cookie.domain.includes('lerzo.com')) {
            // Optional: log cookie changes for debugging
        }
    });

    // Security & Navigation
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    if (IS_PROD) {
        mainWindow.webContents.on('context-menu', (e) => e.preventDefault());
    }

    mainWindow.once('ready-to-show', () => {
        startupLog('Main window ready-to-show');
        closeSplashWindow();
        mainWindow.show();
        if (ELECTRON_DEBUG) {
            mainWindow.webContents.openDevTools({ mode: 'detach' });
        }
        autoUpdater.checkForUpdatesAndNotify();
    });

    bootstrapApiMonitorBridge();
    void pingBackend();
}

function createMenu() {
    const template = [
        ...(process.platform === 'darwin' ? [{
            label: 'Lerzo',
            submenu: [
                { role: 'about', label: 'About Lerzo' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide', label: 'Hide Lerzo' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit', label: 'Quit Lerzo' }
            ]
        }] : []),
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
                { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'delete' }, { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' }, { role: 'forcereload' }, { type: 'separator' },
                { role: 'resetzoom' }, { role: 'zoomin' }, { role: 'zoomout' }, { type: 'separator' }, { role: 'togglefullscreen' }
            ]
        }
    ];
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', (_event, argv) => {
        startupLog('Second instance argv received', { argv });
        // The user clicked "Return to desktop app": always surface the existing
        // window so it visibly receives the callback (Windows deep-link path).
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        } else if (app.isReady()) {
            createMainWindow();
        }
        const callbackUrl = argv.find((arg) => typeof arg === 'string' && arg.startsWith('lerzo://'));
        if (callbackUrl) {
            void handleAuthCallback(callbackUrl, 'second-instance');
        }
    });
}

app.on('open-url', (event, url) => {
    event.preventDefault();
    void handleAuthCallback(url, 'open-url');
});

if (gotSingleInstanceLock) {
    app.whenReady().then(() => {
        const indexPath = getRendererIndexPath();
        startupLog('Lerzo startup', {
            isPackaged: app.isPackaged,
            electronDebug: ELECTRON_DEBUG,
            appPath: app.getAppPath(),
            dirname: __dirname,
            resourcesPath: process.resourcesPath,
            userData: app.getPath('userData'),
            logFile: getLogFilePath(),
            indexPath,
            indexExists: fs.existsSync(indexPath)
        });

        getApiConfig();
        const config = getApiConfig();

        // Startup auth restores ONLY from a valid stored JWT. A persisted pending
        // login (a genuine login that was interrupted by a restart) may still be
        // completed within its TTL; anything else means deep links are ignored.
        pendingLogin = loadPersistedPendingLogin();
        if (pendingLogin) {
            setLoginState(LOGIN_STATE.WAITING_CALLBACK, { restored: true, nonce: redactNonce(pendingLogin.nonce) });
        } else if (loadSecureAuthToken()) {
            setLoginState(LOGIN_STATE.AUTHENTICATED, { restoredFromStoredJwt: true });
        }

        const { healthUrl, googleLoginUrl } = config;
        startupLog('API config loaded for startup', {
            apiBaseUrl: config.apiBaseUrl,
            desktopApiBaseUrl: config.desktopApiBaseUrl,
            healthUrl,
            healthUrls: config.healthUrls,
            configPath: config.configPath,
            appEnv: config.appEnv,
        });
        console.log(`[Lerzo] Desktop health check endpoint: ${healthUrl}`);
        console.log(`[Lerzo] Desktop Google login endpoint: ${googleLoginUrl}`);
        if (process.defaultApp) {
            app.setAsDefaultProtocolClient('lerzo', process.execPath, [path.resolve(process.argv[1])]);
        } else {
            app.setAsDefaultProtocolClient('lerzo');
        }
        createMenu();
        createSplashWindow();
        createMainWindow();

        if (process.env.LERZO_AUTH_PROBE === '1') {
            setTimeout(() => {
                void runAuthLifecycleProbe();
            }, 2500);
        }

        const pendingCallbackUrl = process.argv.find((arg) => typeof arg === 'string' && arg.startsWith('lerzo://'));
        if (pendingCallbackUrl) {
            if (isPendingLoginActive()) {
                void handleAuthCallback(pendingCallbackUrl, 'argv');
            } else {
                authLog('CALLBACK_REJECTED', { source: 'argv', reason: 'no_active_login_request_at_startup' });
            }
        }
        
        // Set Dock Icon for Mac
        if (process.platform === 'darwin') {
            if (APP_ICON) {
                try {
                    app.dock.setIcon(APP_ICON);
                } catch {
                    // Missing or unreadable icons should never block startup.
                }
            }
        }
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('window-controls', (event, action) => {
    if (!mainWindow) return;
    if (action === 'minimize') mainWindow.minimize();
    if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    if (action === 'close') mainWindow.close();
});

ipcMain.handle('get-version', () => app.getVersion());
ipcMain.on('open-external', (event, url) => shell.openExternal(url));

ipcMain.handle('start-google-login', async (_event, url) => {
    const config = getApiConfig();
    const baseUrl = typeof url === 'string' && url.startsWith('http') ? url : config.googleLoginUrl;
    if (process.env.LERZO_AUTH_PROBE === '1') {
        beginLoginTransaction(); // probe drives the deep link directly; don't open a real browser
        authLog('OAUTH_OPENED', { probe: true });
        return true;
    }
    // Only open a transaction once the backend is confirmed reachable so a failed
    // pre-check never leaves a dangling pending login.
    await assertBackendAvailableForLogin(config);
    const nonce = beginLoginTransaction();
    const targetUrl = buildDesktopLoginUrl(baseUrl, nonce);
    authLog('OAUTH_OPENED', { url: targetUrl.split('state=')[0] + 'state=<redacted>' });
    await shell.openExternal(targetUrl);
    return true;
});

ipcMain.handle('auth-login-with-google', async () => {
    const config = getApiConfig();
    if (process.env.LERZO_AUTH_PROBE === '1') {
        beginLoginTransaction(); // probe drives the deep link directly; don't open a real browser
        authLog('OAUTH_OPENED', { probe: true });
        return true;
    }
    await assertBackendAvailableForLogin(config);
    const nonce = beginLoginTransaction();
    const targetUrl = buildDesktopLoginUrl(config.googleLoginUrl, nonce);
    authLog('OAUTH_OPENED', { url: targetUrl.split('state=')[0] + 'state=<redacted>' });
    await shell.openExternal(targetUrl);
    return true;
});

ipcMain.handle('open-location-settings', async () => {
    if (process.platform === 'darwin') {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices');
    } else if (process.platform === 'win32') {
        await shell.openExternal('ms-settings:privacy-location');
    } else {
        await shell.openExternal('https://support.google.com/chrome/answer/142065?hl=en');
    }
    return true;
});

ipcMain.handle('get-api-config', async () => getApiConfig());

ipcMain.handle('check-backend-health', async () => {
    const config = getApiConfig();
    const result = await probeBackendHealth(config, { timeoutMs: 5000 });
    startupLog('Renderer backend health check', {
        apiBaseUrl: config.apiBaseUrl,
        healthUrl: result.healthUrl,
        status: result.status,
        reachable: result.reachable,
        error: result.error || null,
    });
    return result;
});

ipcMain.handle('poll-desktop-auth-token', async () => {
    // A token can only exist on disk after a callback passed the transaction
    // guards (or a prior authenticated session). This is a renderer-side backup
    // to the push notification; it never authenticates an un-consumed callback.
    const token = loadSecureAuthToken();
    if (!token) {
        return { ready: false };
    }

    try {
        await verifyDesktopAuthToken(token);
        lastHandledAuthToken = token;
        if (loginState !== LOGIN_STATE.AUTHENTICATED) {
            setLoginState(LOGIN_STATE.AUTHENTICATED, { source: 'poll' });
        }
        await completeDesktopLoginAfterAuth(token);
        return { ready: true };
    } catch (error) {
        return {
            ready: false,
            error: error && error.message ? error.message : String(error),
        };
    }
});

ipcMain.handle('get-secure-auth-token', async () => loadSecureAuthToken());

ipcMain.handle('set-secure-auth-token', async (_event, token) => saveSecureAuthToken(token));

ipcMain.handle('clear-secure-auth-token', async () => clearSecureAuthToken());

ipcMain.on('retry-load', () => {
    console.log('Retry requested. Reloading target URL.');
    resetDevRendererRetries();
    if (mainWindow) {
        navigateMainWindow(loadSecureAuthToken() ? '#/dashboard' : '#/auth-login');
    }
});

ipcMain.handle('get-connectivity-status', async () => classifyConnectivity());

ipcMain.handle('clear-auth-session', async () => {
    authLog('LOGOUT_STARTED', {});
    // Wipe every persisted auth artifact + reset the in-memory transaction state.
    clearSecureAuthToken();
    clearPendingLogin();
    consumedNonces.clear();
    lastHandledAuthToken = null;
    authCallbackInFlight = null;
    setLoginState(LOGIN_STATE.LOGGED_OUT, {});

    const storages = [
        'cookies',
        'localstorage',
        'sessionstorage',
        'indexdb',
        'websql',
        'serviceworkers',
        'cachestorage',
        'shadercache',
        'filesystem',
    ];
    const targets = [getPersistSession(), session.defaultSession];
    for (const ses of targets) {
        try {
            await ses.clearStorageData({
                storages,
                quotas: ['temporary', 'persistent', 'syncable'],
            });
        } catch (error) {
            authLog('LOGOUT_STORAGE_ERROR', { message: error && error.message ? error.message : String(error) });
        }
    }
    authLog('LOGOUT_FINISHED', {});
    return true;
});

ipcMain.handle('get-login-state', async () => getLoginStateSnapshot());

// Renderer confirms it refreshed auth state and navigated to the dashboard,
// cancelling the force-refresh watchdog.
ipcMain.on('auth-renderer-ack', () => {
    authLog('RENDERER_ACK', {});
    clearRendererAckTimer();
});

ipcMain.handle('record-api-event', async (_event, payload) => {
    pushMonitorEvent(payload);
    await updateTokenSnapshot();
    return true;
});

ipcMain.handle('record-runtime-error', async (_event, payload) => {
    apiMonitorState.errors.unshift({
        timestamp: payload?.timestamp || new Date().toISOString(),
        type: payload?.type || 'renderer',
        message: payload?.message || 'Unknown runtime error',
        endpoint: payload?.source || '',
        page: ''
    });
    apiMonitorState.errors = apiMonitorState.errors.slice(0, 100);
    return true;
});

ipcMain.handle('get-api-monitor-snapshot', async () => {
    await updateTokenSnapshot();
    return getApiMonitorSnapshot();
});

ipcMain.handle('remember-email', async (_event, email) => rememberEmail(email));

ipcMain.handle('get-email-suggestions', async (_event, prefix = '') => {
    const normalizedPrefix = String(prefix || '').trim().toLowerCase();
    return loadStoredEmails().filter((email) => email.startsWith(normalizedPrefix)).slice(0, 8);
});

ipcMain.handle('set-current-user-snapshot', async (_event, user) => {
    apiMonitorState.currentUser = user || null;
    return true;
});

ipcMain.handle('set-page-map', async (_event, pages) => {
    apiMonitorState.pageMap = Array.isArray(pages) ? pages : [];
    return true;
});

setInterval(() => {
    void pingBackend();
}, 15000);
