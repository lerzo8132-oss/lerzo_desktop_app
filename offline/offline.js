document.getElementById('retry-btn').addEventListener('click', () => {
    if (window.electronAPI && window.electronAPI.retryLoad) {
        window.electronAPI.retryLoad();
    } else {
        window.location.reload();
    }
});

// Auto-retry when connection is restored
window.addEventListener('online', () => {
    if (window.electronAPI && window.electronAPI.retryLoad) {
        window.electronAPI.retryLoad();
    } else {
        window.location.reload();
    }
});
