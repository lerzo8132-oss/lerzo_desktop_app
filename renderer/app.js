const mainFrame = document.getElementById('main-frame');
const loader = document.getElementById('main-loader');
const offlineOverlay = document.getElementById('offline-overlay');

const APP_URL = 'https://app.lerzo.com/login';

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    // Add platform class to body
    const platform = window.electronAPI.platform;
    document.body.classList.add(`platform-${platform === 'darwin' ? 'mac' : 'win'}`);
    
    loadApp();
});

function loadApp() {
    if (!window.electronAPI.checkInternet()) {
        showOffline();
        return;
    }

    loader.classList.remove('hidden');
    mainFrame.src = APP_URL;

    mainFrame.onload = () => {
        setTimeout(() => {
            loader.classList.add('hidden');
        }, 500);
    };
}

function showOffline() {
    offlineOverlay.classList.remove('hidden');
    loader.classList.add('hidden');
}

// Window Controls
document.getElementById('min-btn').addEventListener('click', () => {
    window.electronAPI.windowControls('minimize');
});

document.getElementById('max-btn').addEventListener('click', () => {
    window.electronAPI.windowControls('maximize');
});

document.getElementById('close-btn').addEventListener('click', () => {
    window.electronAPI.windowControls('close');
});

// Network Status
window.addEventListener('online', () => {
    offlineOverlay.classList.add('hidden');
    loadApp();
});

window.addEventListener('offline', () => {
    showOffline();
});

// Security: Intercept external links from iframe
// (Limited by same-origin, but for app.lerzo.com we can attempt to monitor clicks)
document.addEventListener('click', (e) => {
    const target = e.target.closest('a');
    if (target && target.href && !target.href.startsWith('https://app.lerzo.com')) {
        e.preventDefault();
        window.electronAPI.openExternal(target.href);
    }
});

// Version Info
window.electronAPI.getVersion().then(v => {
    console.log('App Version:', v);
});
