const fs = require('fs');
const path = require('path');

const DEFAULT_PRODUCTION_URL = 'https://app.lerzo.com';
const FORBIDDEN_PATH_SUFFIXES = ['/login', '/dashboard', '/api', '/auth', '/desktop-api'];

function normalizeBaseUrl(value, fallback = DEFAULT_PRODUCTION_URL) {
  const source = String(value || fallback || DEFAULT_PRODUCTION_URL).trim();
  if (!source) {
    return DEFAULT_PRODUCTION_URL;
  }

  try {
    const parsed = new URL(source.includes('://') ? source : `https://${source}`);
    let pathname = parsed.pathname.replace(/\/+$/, '') || '';

    for (const suffix of FORBIDDEN_PATH_SUFFIXES) {
      if (pathname === suffix || pathname.startsWith(`${suffix}/`)) {
        pathname = pathname.slice(suffix.length).replace(/^\/+/, '');
      }
    }

    for (const suffix of FORBIDDEN_PATH_SUFFIXES) {
      while (pathname.endsWith(suffix)) {
        pathname = pathname.slice(0, -suffix.length).replace(/\/+$/, '');
      }
    }

    pathname = pathname.replace(/\/+$/, '');
    const origin = `${parsed.protocol}//${parsed.host}`;
    return pathname ? `${origin}${pathname}`.replace(/\/+$/, '') : origin;
  } catch {
    return String(fallback || DEFAULT_PRODUCTION_URL).replace(/\/+$/, '');
  }
}

function joinUrl(baseUrl, routePath) {
  const base = normalizeBaseUrl(baseUrl);
  const route = String(routePath || '').trim();
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `${base}${normalizedRoute}`;
}

function normalizeConfigMode(app) {
  const rawMode = String(
    process.env.LERZO_API_CONFIG_MODE
    || process.env.API_CONFIG_MODE
    || 'production'
  ).trim().toLowerCase();

  if (['prod', 'production'].includes(rawMode)) return 'production';
  if (['local', 'dev', 'development'].includes(rawMode)) {
    console.warn('[API CONFIG] local mode is disabled; using production');
    return 'production';
  }
  console.warn(`[API CONFIG] Unknown mode "${rawMode}", falling back to production`);
  return 'production';
}

function resolveConfigPath(app, mode) {
  const candidates = [];
  const modeFileName = `api-config.${mode}.json`;

  if (app && app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'config', modeFileName));
    candidates.push(path.join(process.resourcesPath, 'config', 'api-config.json'));
  }

  candidates.push(path.join(__dirname, modeFileName));
  candidates.push(path.join(__dirname, 'api-config.json'));

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function buildApiConfig(raw, mode = 'production', configPath = null) {
  const apiBaseUrl = normalizeBaseUrl(raw?.apiBaseUrl);
  const webBaseUrl = normalizeBaseUrl(raw?.webBaseUrl || raw?.apiBaseUrl);

  return {
    configMode: mode,
    configPath,
    apiBaseUrl,
    webBaseUrl,
    desktopApiBaseUrl: joinUrl(apiBaseUrl, '/desktop-api'),
    healthUrl: joinUrl(apiBaseUrl, '/desktop-api/health'),
    googleLoginUrl: joinUrl(webBaseUrl, '/auth/google/login?app=electron&electron_callback=1'),
    meUrl: joinUrl(apiBaseUrl, '/desktop-api/auth/me'),
    logoutUrl: joinUrl(apiBaseUrl, '/desktop-api/auth/logout'),
    registerUrl: joinUrl(apiBaseUrl, '/desktop-api/auth/register'),
  };
}

function loadApiConfig(app) {
  const mode = normalizeConfigMode(app);
  const configPath = resolveConfigPath(app, mode);
  let raw = null;

  if (configPath) {
    try {
      raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      console.warn('[API CONFIG] Failed to parse api-config.json:', error.message);
    }
  } else {
    console.warn('[API CONFIG] api-config.json missing, using default production URL');
  }

  const config = buildApiConfig(raw, mode, configPath);

  console.log(`[API CONFIG] packaged=${Boolean(app?.isPackaged)}`);
  console.log(`[API CONFIG] apiBaseUrl=${config.apiBaseUrl}`);
  console.log(`[Electron Health] url=${config.healthUrl}`);
  console.log('[API CONFIG] mode =', config.configMode);
  console.log('[API CONFIG] file =', config.configPath || 'none');
  console.log(`[API CONFIG] webBaseUrl=${config.webBaseUrl}`);
  console.log('[Electron Auth] googleLoginUrl =', config.googleLoginUrl);

  return config;
}

module.exports = {
  DEFAULT_PRODUCTION_URL,
  FORBIDDEN_PATH_SUFFIXES,
  normalizeBaseUrl,
  joinUrl,
  buildApiConfig,
  loadApiConfig,
  normalizeConfigMode,
};
