const params = new URLSearchParams(window.location.search);

const PRESENTATION = {
    network: {
        icon: '📡',
        title: 'No Internet Connection',
        message: 'Your device appears to be offline. Please check your Wi‑Fi or network settings and try again.',
    },
    server: {
        icon: '🛠️',
        title: 'Server Unreachable',
        message: 'You are online, but Lerzo servers can’t be reached right now. This is usually temporary — please try again in a moment.',
    },
    renderer: {
        icon: '🔄',
        title: 'Loading Lerzo…',
        message: 'Your connection is fine. Finishing loading the app — this should only take a moment.',
    },
};

const iconEl = document.getElementById('status-icon');
const titleEl = document.getElementById('status-title');
const messageEl = document.getElementById('status-message');
const statusLineEl = document.getElementById('status-line');
const retryBtn = document.getElementById('retry-btn');

function applyPresentation(reason) {
    const p = PRESENTATION[reason] || PRESENTATION.network;
    iconEl.textContent = p.icon;
    titleEl.textContent = p.title;
    messageEl.textContent = p.message;
}

function setStatusLine(text) {
    if (statusLineEl) statusLineEl.textContent = text || '';
}

// Initial render from the reason main process passed in the query string.
applyPresentation(params.get('reason') || 'network');

// If the app content just needs a moment (renderer reason), auto-retry quietly.
if ((params.get('reason') || '') === 'renderer') {
    setTimeout(triggerRetry, 1200);
}

function triggerRetry() {
    if (window.electronAPI && window.electronAPI.retryLoad) {
        window.electronAPI.retryLoad();
    } else {
        window.location.reload();
    }
}

async function recheckAndRetry() {
    retryBtn.disabled = true;
    setStatusLine('Rechecking connection…');

    let status = null;
    if (window.electronAPI && window.electronAPI.getConnectivityStatus) {
        try {
            status = await window.electronAPI.getConnectivityStatus();
        } catch {
            status = null;
        }
    }

    if (status) {
        applyPresentation(status.reason);
        // Backend reachable means the real page can load — reload the app.
        if (status.backend) {
            setStatusLine('Connection restored. Reopening Lerzo…');
            triggerRetry();
            return;
        }
        setStatusLine(status.internet
            ? 'Internet OK, but the server is still unreachable.'
            : 'Still offline. Check your network and try again.');
    } else {
        // No status API available; just attempt a reload.
        triggerRetry();
        return;
    }

    retryBtn.disabled = false;
}

retryBtn.addEventListener('click', () => {
    void recheckAndRetry();
});

// Auto-retry when the OS reports the connection is restored (real transition).
window.addEventListener('online', () => {
    setStatusLine('Network restored. Rechecking…');
    void recheckAndRetry();
});
