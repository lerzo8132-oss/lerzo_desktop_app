export type ApiConfig = {
  configMode?: string;
  configPath?: string | null;
  appEnv?: string;
  apiBaseUrl: string;
  webBaseUrl: string;
  desktopApiBaseUrl: string;
  healthUrl: string;
  healthUrls?: string[];
  googleLoginUrl: string;
  meUrl: string;
  logoutUrl: string;
  registerUrl: string;
};

const DEFAULT_PRODUCTION_URL = 'https://app.lerzo.com';
const FORBIDDEN_PATH_SUFFIXES = ['/login', '/dashboard', '/api', '/auth', '/desktop-api'];

let cachedConfig: ApiConfig | null = null;
let initPromise: Promise<ApiConfig> | null = null;

export function resolveProductionOrigin(value?: string | null, fallback = DEFAULT_PRODUCTION_URL): string {
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

function buildHealthUrls(apiBaseUrl: string): string[] {
  return [
    joinUrl(apiBaseUrl, '/desktop-api/health'),
    joinUrl(apiBaseUrl, '/api/health'),
    joinUrl(apiBaseUrl, '/api/staff/health'),
  ];
}

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
  const envOrigin = resolveProductionOrigin(import.meta.env.VITE_API_BASE_URL, DEFAULT_PRODUCTION_URL);
  console.warn('[API CONFIG] api-config.json missing, using default production URL');
  const apiBaseUrl = envOrigin;
  const webBaseUrl = envOrigin;
  const healthUrls = buildHealthUrls(apiBaseUrl);
  return {
    configMode: import.meta.env.VITE_APP_ENV || 'production',
    configPath: null,
    appEnv: import.meta.env.VITE_APP_ENV || 'production',
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

function logApiConfig(config: ApiConfig) {
  console.info('[API CONFIG] mode =', config.configMode || 'unknown');
  console.info('[API CONFIG] appEnv =', config.appEnv || import.meta.env.VITE_APP_ENV || 'production');
  console.info('[API CONFIG] file =', config.configPath || 'none');
  console.info(`[API CONFIG] apiBaseUrl=${config.apiBaseUrl}`);
  console.info(`[API CONFIG] desktopApiBaseUrl=${config.desktopApiBaseUrl}`);
  console.info(`[API CONFIG] webBaseUrl=${config.webBaseUrl}`);
  console.info('[Electron Auth] googleLoginUrl =', config.googleLoginUrl);
  console.info(`[Electron Health] url=${config.healthUrl}`);
  if (config.healthUrls?.length) {
    console.info('[API CONFIG] healthUrls =', config.healthUrls);
  }
}

async function loadRendererApiConfig(): Promise<ApiConfig> {
  const fromMain = await window.electronAPI?.getApiConfig?.();
  if (fromMain?.apiBaseUrl && fromMain?.webBaseUrl) {
    const apiBaseUrl = resolveProductionOrigin(fromMain.apiBaseUrl);
    const webBaseUrl = resolveProductionOrigin(fromMain.webBaseUrl || fromMain.apiBaseUrl);
    const healthUrls = fromMain.healthUrls?.length
      ? fromMain.healthUrls
      : buildHealthUrls(apiBaseUrl);
    return {
      configMode: fromMain.configMode,
      configPath: fromMain.configPath,
      appEnv: fromMain.appEnv || import.meta.env.VITE_APP_ENV || 'production',
      apiBaseUrl,
      webBaseUrl,
      desktopApiBaseUrl: fromMain.desktopApiBaseUrl || joinUrl(apiBaseUrl, '/desktop-api'),
      healthUrl: fromMain.healthUrl || healthUrls[0],
      healthUrls,
      googleLoginUrl:
        fromMain.googleLoginUrl
        || joinUrl(webBaseUrl, '/auth/google/login?app=electron&electron_callback=1'),
      meUrl: fromMain.meUrl || joinUrl(apiBaseUrl, '/desktop-api/auth/me'),
      logoutUrl: fromMain.logoutUrl || joinUrl(apiBaseUrl, '/desktop-api/auth/logout'),
      registerUrl: fromMain.registerUrl || joinUrl(apiBaseUrl, '/desktop-api/auth/register'),
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
