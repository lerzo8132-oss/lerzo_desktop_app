const fs = require('fs');
const path = require('path');

const DEFAULT_PRODUCTION_URL = 'https://app.lerzo.com';
const FORBIDDEN_PATH_SUFFIXES = ['/login', '/dashboard', '/api', '/auth', '/desktop-api'];

function resolveProductionOrigin(value, fallback = DEFAULT_PRODUCTION_URL) {
  const source = String(value || fallback || DEFAULT_PRODUCTION_URL).trim();
  if (!source) {
    return DEFAULT_PRODUCTION_URL;
  }

  try {
    const parsed = new URL(source.includes('://') ? source : `https://${source}`);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return String(fallback || DEFAULT_PRODUCTION_URL).replace(/\/+$/, '');
  }
}

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

function buildHealthUrls(apiBaseUrl) {
  return [
    joinUrl(apiBaseUrl, '/desktop-api/health'),
    joinUrl(apiBaseUrl, '/api/health'),
    joinUrl(apiBaseUrl, '/api/staff/health'),
  ];
}

function isHealthPayloadOk(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  if (payload.status !== 'ok') {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'success')) {
    return payload.success === true;
  }
  return true;
}

async function probeBackendHealth(config, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 5000);
  const healthUrls = Array.isArray(config?.healthUrls) && config.healthUrls.length
    ? config.healthUrls
    : buildHealthUrls(config?.apiBaseUrl || DEFAULT_PRODUCTION_URL);
  const attempts = [];

  for (const healthUrl of healthUrls) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    try {
      console.log(`[Electron Health] url=${healthUrl}`);
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: controller.signal,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
        },
      });
      const latencyMs = Date.now() - startedAt;
      const payload = await response.json().catch(() => null);
      const reachable = response.ok && isHealthPayloadOk(payload);
      const attempt = {
        healthUrl,
        status: response.status,
        reachable,
        latencyMs,
        payload,
        error: reachable ? null : `Unexpected health response (${response.status})`,
      };
      attempts.push(attempt);
      console.log('[Electron Health] status =', response.status, 'reachable =', reachable);
      if (reachable) {
        return {
          reachable: true,
          healthUrl,
          status: response.status,
          latencyMs,
          payload,
          attempts,
        };
      }
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      attempts.push({
        healthUrl,
        status: null,
        reachable: false,
        latencyMs: Date.now() - startedAt,
        payload: null,
        error: message,
      });
      console.log('[Electron Health] status = offline', message);
    } finally {
      clearTimeout(timeout);
    }
  }

  const lastAttempt = attempts[attempts.length - 1] || null;
  return {
    reachable: false,
    healthUrl: lastAttempt?.healthUrl || healthUrls[0],
    status: lastAttempt?.status ?? null,
    latencyMs: lastAttempt?.latencyMs ?? null,
    payload: lastAttempt?.payload ?? null,
    error: lastAttempt?.error || 'All health checks failed',
    attempts,
  };
}

function buildApiConfig(raw, mode = 'production', configPath = null) {
  const envOrigin = resolveProductionOrigin(
    process.env.VITE_API_BASE_URL || process.env.LERZO_API_BASE_URL,
    DEFAULT_PRODUCTION_URL
  );
  const apiBaseUrl = resolveProductionOrigin(raw?.apiBaseUrl, envOrigin);
  const webBaseUrl = resolveProductionOrigin(raw?.webBaseUrl || raw?.apiBaseUrl, apiBaseUrl);
  const healthUrls = buildHealthUrls(apiBaseUrl);

  return {
    configMode: mode,
    configPath,
    appEnv: raw?.appEnv || process.env.VITE_APP_ENV || 'production',
    apiBaseUrl,
    webBaseUrl,
    desktopApiBaseUrl: joinUrl(apiBaseUrl, '/desktop-api'),
    healthUrl: healthUrls[0],
    healthUrls,
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
  console.log(`[API CONFIG] appEnv=${config.appEnv}`);
  console.log(`[API CONFIG] apiBaseUrl=${config.apiBaseUrl}`);
  console.log(`[API CONFIG] desktopApiBaseUrl=${config.desktopApiBaseUrl}`);
  console.log(`[Electron Health] url=${config.healthUrl}`);
  console.log('[API CONFIG] healthUrls =', config.healthUrls);
  console.log('[API CONFIG] mode =', config.configMode);
  console.log('[API CONFIG] file =', config.configPath || 'none');
  console.log(`[API CONFIG] webBaseUrl=${config.webBaseUrl}`);
  console.log('[Electron Auth] googleLoginUrl =', config.googleLoginUrl);

  return config;
}

module.exports = {
  DEFAULT_PRODUCTION_URL,
  FORBIDDEN_PATH_SUFFIXES,
  resolveProductionOrigin,
  normalizeBaseUrl,
  joinUrl,
  buildApiConfig,
  buildHealthUrls,
  isHealthPayloadOk,
  probeBackendHealth,
  loadApiConfig,
  normalizeConfigMode,
};
