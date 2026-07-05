const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
    windowControls: (action) => ipcRenderer.send('window-controls', action),
    getVersion: () => ipcRenderer.invoke('get-version'),
    openExternal: (url) => ipcRenderer.send('open-external', url),
    openLocationSettings: () => ipcRenderer.invoke('open-location-settings'),
    startGoogleLogin: (url) => ipcRenderer.invoke('start-google-login', url),
    getApiConfig: () => ipcRenderer.invoke('get-api-config'),
    auth: {
        loginWithGoogle: () => ipcRenderer.invoke('auth-login-with-google'),
    },
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),
    // Reliable desktop-login notification. The main process pushes
    // `auth-token-received` over IPC the instant it authenticates; we expose two
    // named subscriptions (auth-token / login-complete) that both ride this same
    // reliable channel so the renderer is notified regardless of which it uses.
    onAuthTokenReceived: (callback) => {
        const listener = () => {
            console.info('[Renderer Auth] IPC auth-token-received received');
            callback();
        };
        ipcRenderer.on('auth-token-received', listener);
        return () => ipcRenderer.removeListener('auth-token-received', listener);
    },
    onLoginComplete: (callback) => {
        const listener = () => {
            console.info('[Renderer Auth] IPC login-complete received');
            callback();
        };
        ipcRenderer.on('auth-token-received', listener);
        return () => ipcRenderer.removeListener('auth-token-received', listener);
    },
    ackDesktopLogin: () => {
        console.info('[Renderer Auth] ackDesktopLogin -> main');
        ipcRenderer.send('auth-renderer-ack');
    },
    onAuthLoginFailed: (callback) => {
        const listener = (_event, reason) => {
            console.warn('[Renderer Auth] login failed =', reason);
            callback(reason);
        };
        ipcRenderer.on('auth-login-failed', listener);
        return () => ipcRenderer.removeListener('auth-login-failed', listener);
    },
    checkInternet: () => ipcRenderer.invoke('check-backend-health').then((result) => Boolean(result?.reachable)),
    getConnectivityStatus: () => ipcRenderer.invoke('get-connectivity-status'),
    pollDesktopAuthToken: () => ipcRenderer.invoke('poll-desktop-auth-token'),
    retryLoad: () => ipcRenderer.send('retry-load'),
    clearAuthSession: () => ipcRenderer.invoke('clear-auth-session'),
    getSecureAuthToken: () => ipcRenderer.invoke('get-secure-auth-token'),
    setSecureAuthToken: (token) => ipcRenderer.invoke('set-secure-auth-token', token),
    clearSecureAuthToken: () => ipcRenderer.invoke('clear-secure-auth-token'),
    getLoginState: () => ipcRenderer.invoke('get-login-state'),
    recordApiEvent: (payload) => ipcRenderer.invoke('record-api-event', payload),
    recordRuntimeError: (payload) => ipcRenderer.invoke('record-runtime-error', payload),
    getApiMonitorSnapshot: () => ipcRenderer.invoke('get-api-monitor-snapshot'),
    rememberEmail: (email) => ipcRenderer.invoke('remember-email', email),
    getEmailSuggestions: (prefix) => ipcRenderer.invoke('get-email-suggestions', prefix),
    setCurrentUserSnapshot: (user) => ipcRenderer.invoke('set-current-user-snapshot', user),
    setPageMap: (pages) => ipcRenderer.invoke('set-page-map', pages),
});
