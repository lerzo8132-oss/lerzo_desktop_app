export type ApiConfig = {
  configMode?: string;
  configPath?: string | null;
  apiBaseUrl: string;
  webBaseUrl: string;
  desktopApiBaseUrl: string;
  healthUrl: string;
  googleLoginUrl: string;
  meUrl: string;
  logoutUrl: string;
  registerUrl: string;
};

const DEFAULT_PRODUCTION_URL = 'https://app.lerzo.com';
const FORBIDDEN_PATH_SUFFIXES = ['/login', '/dashboard', '/api', '/auth', '/desktop-api'];

let cachedConfig: ApiConfig | null = null;
let initPromise: Promise<ApiConfig> | null = null;

export function normalizeBaseUrl(value?: string | null, fallback = DEFAULT_PRODUCTION_URL): string {
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

export function joinUrl(baseUrl: string, routePath: string): string {
  const base = normalizeBaseUrl(baseUrl);
  const route = String(routePath || '').trim();
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `${base}${normalizedRoute}`;
}

/** Append a path to desktop-api base without stripping /desktop-api. */
export function joinDesktopApiUrl(desktopApiBaseUrl: string, routePath: string): string {
  const base = String(desktopApiBaseUrl || '').trim().replace(/\/+$/, '');
  const route = String(routePath || '').trim();
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `${base}${normalizedRoute}`;
}

function buildFallbackConfig(): ApiConfig {
  console.warn('[API CONFIG] api-config.json missing, using default production URL');
  const apiBaseUrl = normalizeBaseUrl(DEFAULT_PRODUCTION_URL);
  const webBaseUrl = normalizeBaseUrl(DEFAULT_PRODUCTION_URL);
  return {
    configMode: 'production',
    configPath: null,
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

function logApiConfig(config: ApiConfig) {
  console.info('[API CONFIG] mode =', config.configMode || 'unknown');
  console.info('[API CONFIG] file =', config.configPath || 'none');
  console.info(`[API CONFIG] apiBaseUrl=${config.apiBaseUrl}`);
  console.info(`[API CONFIG] webBaseUrl=${config.webBaseUrl}`);
  console.info('[Electron Auth] googleLoginUrl =', config.googleLoginUrl);
  console.info(`[Electron Health] url=${config.healthUrl}`);
}

async function loadRendererApiConfig(): Promise<ApiConfig> {
  const fromMain = await window.electronAPI?.getApiConfig?.();
  if (fromMain?.apiBaseUrl && fromMain?.webBaseUrl) {
    return {
      configMode: fromMain.configMode,
      configPath: fromMain.configPath,
      apiBaseUrl: normalizeBaseUrl(fromMain.apiBaseUrl),
      webBaseUrl: normalizeBaseUrl(fromMain.webBaseUrl || fromMain.apiBaseUrl),
      desktopApiBaseUrl: fromMain.desktopApiBaseUrl || joinUrl(fromMain.apiBaseUrl, '/desktop-api'),
      healthUrl: fromMain.healthUrl || joinUrl(fromMain.apiBaseUrl, '/desktop-api/health'),
      googleLoginUrl:
        fromMain.googleLoginUrl
        || joinUrl(fromMain.webBaseUrl || fromMain.apiBaseUrl, '/auth/google/login?app=electron&electron_callback=1'),
      meUrl: fromMain.meUrl || joinUrl(fromMain.apiBaseUrl, '/desktop-api/auth/me'),
      logoutUrl: fromMain.logoutUrl || joinUrl(fromMain.apiBaseUrl, '/desktop-api/auth/logout'),
      registerUrl: fromMain.registerUrl || joinUrl(fromMain.apiBaseUrl, '/desktop-api/auth/register'),
    };
  }

  return buildFallbackConfig();
}

export async function initApiConfig(): Promise<ApiConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  if (!initPromise) {
    initPromise = loadRendererApiConfig().then((config) => {
      cachedConfig = config;
      logApiConfig(config);
      return config;
    });
  }

  return initPromise;
}

export function getApiConfig(): ApiConfig {
  if (!cachedConfig) {
    throw new Error('API config not initialized. Call initApiConfig() first.');
  }
  return cachedConfig;
}

export function getApiBaseUrl(): string {
  return getApiConfig().apiBaseUrl;
}

export function getWebBaseUrl(): string {
  return getApiConfig().webBaseUrl;
}

export function getDesktopApiBaseUrl(): string {
  return getApiConfig().desktopApiBaseUrl;
}

export function getGoogleLoginUrl(): string {
  return getApiConfig().googleLoginUrl;
}

export function getHealthUrl(): string {
  return getApiConfig().healthUrl;
}

export function getRegisterUrl(): string {
  return getApiConfig().registerUrl;
}
