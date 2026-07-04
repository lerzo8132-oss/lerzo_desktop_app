import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { initTheme } from './theme';
import { initApiConfig } from './config/api';
import { BOOT_MAX_LOADER_MS, withTimeout } from './services/boot';
import './index.css';
import './styles/lerzo-loader.css';

console.info('[BOOT] start');
console.info('[Renderer Boot] main.tsx started');

function recordRendererError(error: unknown, source = 'renderer') {
  const message = error instanceof Error ? error.message : String(error || 'Unknown renderer error');
  console.error('[Renderer Error] full error =', error);
  void window.electronAPI?.recordRuntimeError?.({
    timestamp: new Date().toISOString(),
    type: source,
    message,
    source,
    line: null,
    column: null,
  });
}

window.addEventListener('error', (event) => {
  recordRendererError(event.error || event.message, 'window-error');
});

window.addEventListener('unhandledrejection', (event) => {
  recordRendererError(event.reason, 'unhandled-rejection');
});

initTheme();

function hideBootFallback() {
  document.getElementById('electron-boot-fallback')?.remove();
}

function showBootError(error: unknown) {
  const rootElement = document.getElementById('root');
  const message = error instanceof Error ? error.message : String(error || 'Unknown renderer error');
  if (!rootElement) return;
  rootElement.innerHTML = `
    <div class="auth-error-page">
      <div class="auth-error-card">
        <h1>App could not start</h1>
        <p>${message.replace(/[&<>"']/g, (char) => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        }[char] || char))}</p>
        <div class="auth-error-actions">
          <button class="btn btn-primary" type="button" onclick="window.location.reload()">Reload App</button>
        </div>
      </div>
    </div>
  `;
}

function renderApp() {
  const rootElement = document.getElementById('root');
  console.info('[Renderer Boot] root found', rootElement ? 'yes' : 'no');
  if (!rootElement) {
    console.error('[Renderer Error] render crash = #root element missing');
    return;
  }

  try {
    console.info('[Renderer Boot] React render started');
    ReactDOM.createRoot(rootElement).render(
      <HashRouter>
        <App />
      </HashRouter>,
    );

    window.setTimeout(() => {
      hideBootFallback();
      console.info('[Renderer Boot] React render completed');
    }, 0);
  } catch (error) {
    recordRendererError(error, 'react-render');
    showBootError(error);
  }
}

renderApp();

void withTimeout(initApiConfig(), BOOT_MAX_LOADER_MS, 'api config').catch((error) => {
  console.error('[Renderer Error] API config init failed =', error);
});
