const { app, BrowserWindow, ipcMain, shell, Tray, Menu, session, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { loadApiConfig } = require('./config/loadApiConfig');

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
const RENDERER_DEV_URL = (process.env.ELECTRON_RENDERER_URL || `http://${['127', '0', '0', '1'].join('.')}:5173`).replace(/\/$/, '');
let API_CONFIG = null;

function getApiConfig() {
    if (!API_CONFIG) {
        API_CONFIG = loadApiConfig(app);
    }
    return API_CONFIG;
}

async function assertBackendAvailableForLogin(config) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    try {
        console.log(`[Electron Health] url=${config.healthUrl}`);
        const response = await fetch(config.healthUrl, {
            method: 'GET',
            signal: controller.signal,
            credentials: 'include',
            headers: {
                Accept: 'application/json'
            }
        });
        console.log('[Electron Health] status =', response.status);
        if (!response.ok) {
            throw new Error(`Health check failed with ${response.status}`);
        }
        const payload = await response.json().catch(() => null);
        if (!payload || payload.status !== 'ok' || payload.success !== true) {
            throw new Error('Health check returned an invalid response');
        }
    } catch (error) {
        console.log('[Electron Health] status = offline');
        console.error('[Electron Error] backend unavailable', {
            mode: config.configMode,
            apiBaseUrl: config.apiBaseUrl,
            healthUrl: config.healthUrl,
            error: error && error.message ? error.message : String(error)
        });
        throw new Error('Server is currently unavailable');
    } finally {
        clearTimeout(timeout);
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

function getElectronStartUrl(hash = '') {
    const normalizedHash = hash ? (hash.startsWith('#') ? hash : `#${hash}`) : '';
    if (!IS_PROD) {
        return `${RENDERER_DEV_URL}${normalizedHash}`;
    }

    const indexFile = path.join(__dirname, 'dist/index.html');
    if (fs.existsSync(indexFile)) {
        return `${pathToFileURL(indexFile).toString()}${normalizedHash}`;
    }

    throw new Error(`Packaged renderer is missing: ${indexFile}`);
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
    const start = Date.now();
    const { healthUrl } = getApiConfig();
    try {
        // Public health check only. Protected data endpoints require a JWT and
        // must not be polled by the shell before login.
        console.log(`[Electron Health] url=${healthUrl}`);
        const response = await fetch(healthUrl, {
            method: 'GET',
            credentials: 'include',
            headers: {
                Accept: 'application/json'
            }
        });
        const latency = Date.now() - start;
        const payload = await response.json().catch(() => null);
        const reachable = response.ok && payload?.status === 'ok' && payload?.success === true;
        apiMonitorState.network.backendReachable = reachable;
        apiMonitorState.network.apiConnected = reachable;
        apiMonitorState.network.databaseReachable = reachable;
        apiMonitorState.network.lastLatencyMs = latency;
        apiMonitorState.network.lastCheckedAt = new Date().toISOString();
        apiMonitorState.network.status = reachable ? (latency > 1200 ? 'slow' : 'connected') : 'offline';
    } catch {
        apiMonitorState.network.apiConnected = false;
        apiMonitorState.network.backendReachable = false;
        apiMonitorState.network.databaseReachable = false;
        apiMonitorState.network.status = 'offline';
        apiMonitorState.network.lastCheckedAt = new Date().toISOString();
    }
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
        splashWindow.loadFile(path.join(__dirname, 'splash/splash.html')).catch(() => {});
    } catch {
        splashWindow = null;
    }
}

function navigateMainWindow(hash = '') {
    if (!mainWindow) return;
    mainWindow.loadURL(getElectronStartUrl(hash)).catch((error) => {
        apiMonitorState.errors.unshift({
            timestamp: new Date().toISOString(),
            type: 'electron',
            message: `Load failed: ${error.message || String(error)}`,
            endpoint: getElectronStartUrl(hash),
            page: ''
        });
        apiMonitorState.errors = apiMonitorState.errors.slice(0, 100);
    });
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

async function handleAuthCallback(callbackUrl) {
    console.log('[Electron Auth] deep link received =', callbackUrl ? callbackUrl.split('token=')[0] + 'token=<redacted>' : '(empty)');

    if (!callbackUrl || typeof callbackUrl !== 'string' || !callbackUrl.startsWith('lerzo://')) {
        console.warn('[Electron Auth] token extracted = no (invalid callback URL)');
        return false;
    }

    try {
        const parsed = new URL(callbackUrl);
        if (parsed.hostname === 'auth' && parsed.pathname === '/register') {
            const params = new URLSearchParams();
            ['email', 'name', 'google_id'].forEach((key) => {
                const value = parsed.searchParams.get(key);
                if (value) params.set(key, value);
            });
            if (!mainWindow && app.isReady()) {
                createMainWindow();
            }
            if (!mainWindow) return false;
            const hash = params.toString() ? `#/auth-register?${params.toString()}` : '#/auth-register';
            mainWindow.loadURL(getElectronStartUrl(hash)).catch((error) => {
                console.error('[Electron Auth] failed to open registration page:', error);
            });
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            return true;
        }

        const isAuthCallback = parsed.hostname === 'auth' && parsed.pathname === '/callback';
        const isLegacyCallback = parsed.hostname === 'callback';
        if (!isAuthCallback && !isLegacyCallback) {
            console.warn('[Electron Auth] token extracted = no (unsupported callback path)');
            return false;
        }

        const token = parsed.searchParams.get('token');
        console.log('[Electron Auth] token extracted =', token ? 'yes' : 'no');
        if (!token) return false;
        if (token === lastHandledAuthToken && authCallbackInFlight) {
            console.log('[Electron Auth] duplicate callback ignored');
            return true;
        }
        if (authCallbackInFlight) {
            return authCallbackInFlight;
        }

        authCallbackInFlight = (async () => {
            try {
                const tokenSaved = saveSecureAuthToken(token);
                console.log('[Electron Auth] token saved =', tokenSaved ? 'yes' : 'no');
                if (!tokenSaved) {
                    throw new Error('Unable to save desktop auth token');
                }

                console.log('[Electron Auth] calling /desktop-api/auth/me');
                await verifyDesktopAuthToken(token);

                if (!mainWindow && app.isReady()) {
                    createMainWindow();
                }
                if (!mainWindow) {
                    return false;
                }

                mainWindow.webContents.send('auth-token-received');
                console.log('[Electron Auth] auth token dispatched to renderer');
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.show();
                mainWindow.focus();
                lastHandledAuthToken = token;
                return true;
            } finally {
                authCallbackInFlight = null;
            }
        })();

        return authCallbackInFlight;
    } catch (error) {
        authCallbackInFlight = null;
        const message = error && error.message ? error.message : String(error);
        console.error('[Electron Auth] callback error =', message);
        showLoginAfterAuthFailure('Login could not be completed. Please try again.');
        return false;
    }
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
            devTools: !IS_PROD,
            partition: 'persist:lerzo'
        }
    });

    // Prevent page title updates from displaying in the native title bar
    mainWindow.on('page-title-updated', (event) => {
        event.preventDefault();
    });

    const initialHash = loadSecureAuthToken() ? '#/dashboard' : '#/auth-login';
    navigateMainWindow(initialHash);

    if (!IS_PROD) {
        mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
            const prefix = level === 3 ? '[Renderer Error]' : '[Renderer]';
            console.log(`${prefix} ${message}${sourceId ? ` (${sourceId}:${line})` : ''}`);
        });
    }

    // Handle failure to load
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        // If the URL that failed wasn't the offline page itself, load the offline page
        const offlinePath = path.join(__dirname, 'offline/offline.html');
        if (validatedURL !== offlinePath && !validatedURL.includes('offline/offline.html')) {
            console.log(`❌ Page failed to load: ${validatedURL} (${errorDescription}). Loading offline screen.`);
            apiMonitorState.errors.unshift({
                timestamp: new Date().toISOString(),
                type: 'electron',
                message: `Load failed: ${errorDescription}`,
                endpoint: validatedURL,
                page: ''
            });
            apiMonitorState.errors = apiMonitorState.errors.slice(0, 100);
            mainWindow.loadFile(offlinePath);
        }
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
        if (splashWindow) splashWindow.close();
        mainWindow.show();
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
        const callbackUrl = argv.find((arg) => typeof arg === 'string' && arg.startsWith('lerzo://'));
        if (callbackUrl) {
            void handleAuthCallback(callbackUrl);
        } else if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

app.on('open-url', (event, url) => {
    event.preventDefault();
    void handleAuthCallback(url);
});

if (gotSingleInstanceLock) {
    app.whenReady().then(() => {
        getApiConfig();
        const { healthUrl, googleLoginUrl } = getApiConfig();
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

        const pendingCallbackUrl = process.argv.find((arg) => typeof arg === 'string' && arg.startsWith('lerzo://'));
        if (pendingCallbackUrl) {
            void handleAuthCallback(pendingCallbackUrl);
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
    const targetUrl = typeof url === 'string' && url.startsWith('http') ? url : config.googleLoginUrl;
    await assertBackendAvailableForLogin(config);
    await shell.openExternal(targetUrl);
    return true;
});

ipcMain.handle('auth-login-with-google', async () => {
    const config = getApiConfig();
    await assertBackendAvailableForLogin(config);
    await shell.openExternal(config.googleLoginUrl);
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

ipcMain.handle('get-secure-auth-token', async () => loadSecureAuthToken());

ipcMain.handle('set-secure-auth-token', async (_event, token) => saveSecureAuthToken(token));

ipcMain.handle('clear-secure-auth-token', async () => clearSecureAuthToken());

ipcMain.on('retry-load', () => {
    console.log('Retry requested. Reloading target URL.');
    if (mainWindow) {
        navigateMainWindow();
    }
});

ipcMain.handle('clear-auth-session', async () => {
    clearSecureAuthToken();
    const ses = getPersistSession();
    await ses.clearStorageData({
        storages: ['cookies', 'localstorage', 'sessionstorage', 'caches'],
        quotas: ['temporary', 'persistent', 'syncable']
    });
    return true;
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
