import axios, { type InternalAxiosRequestConfig } from 'axios';
import { initApiConfig } from '../config/api';
import { beginRequestLoading, endRequestLoading } from './appShell';
import { extractApiErrorMessage } from './apiErrors';
import { markAuthExpiredHandled, resetAuthExpiredHandled } from './authFlags';

let inMemoryToken: string | null = null;
let apiClientPromise: Promise<typeof api> | null = null;

export class SubscriptionExpiredError extends Error {
  code = 'SUBSCRIPTION_EXPIRED';

  constructor(message = 'Trial expired or subscription inactive') {
    super(message);
    this.name = 'SubscriptionExpiredError';
  }
}

export const api = axios.create({
  baseURL: '/desktop-api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

export async function configureApiClient() {
  if (!apiClientPromise) {
    apiClientPromise = initApiConfig().then((config) => {
      api.defaults.baseURL = config.desktopApiBaseUrl;
      return api;
    });
  }
  return apiClientPromise;
}

function trackLoader(config: InternalAxiosRequestConfig) {
  if (config.lerzoSkipLoader) return;
  beginRequestLoading();
  config.lerzoLoaderTracked = true;
}

function releaseLoader(config?: InternalAxiosRequestConfig) {
  if (!config?.lerzoLoaderTracked) return;
  config.lerzoLoaderTracked = false;
  endRequestLoading();
}

export function isSubscriptionExpiredPayload(status?: number, data?: { code?: unknown; error?: unknown }) {
  const marker = String(data?.code || data?.error || '');
  return (status === 402 || status === 403) && marker === 'SUBSCRIPTION_EXPIRED';
}

export async function handleSubscriptionExpired(message?: string) {
  const { stopNotificationPoller } = await import('./notificationsPoll');
  stopNotificationPoller();
  sessionStorage.setItem('lerzo_subscription_expired', '1');
  window.dispatchEvent(new CustomEvent('lerzo-subscription-expired'));
  const hash = window.location.hash || '';
  if (!hash.startsWith('#/subscription-')) {
    window.location.hash = '#/subscription-plans';
  }
  return new SubscriptionExpiredError(message);
}

api.interceptors.request.use(async (config) => {
  await configureApiClient();
  const token = await getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  trackLoader(config);
  return config;
});

api.interceptors.response.use(
  (response) => {
    releaseLoader(response.config);
    return response;
  },
  async (error) => {
    releaseLoader(error?.config);
    const requestUrl = String(error?.config?.url || '');
    const isAuthMeRequest = requestUrl.includes('/auth/me');
    if (isSubscriptionExpiredPayload(error?.response?.status, error?.response?.data)) {
      const message = extractApiErrorMessage(error, 'Trial expired or subscription inactive.');
      return Promise.reject(await handleSubscriptionExpired(message));
    }
    if (error?.response?.status === 401 && isAuthMeRequest && markAuthExpiredHandled()) {
      const { stopNotificationPoller } = await import('./notificationsPoll');
      stopNotificationPoller();
      await clearAuthTokens();
      window.dispatchEvent(new CustomEvent('lerzo-auth-changed'));
    }
    const message = extractApiErrorMessage(error, 'Request failed.');
    return Promise.reject(new Error(message));
  }
);

export async function setAuthTokens(token?: string | null) {
  if (token) {
    resetAuthExpiredHandled();
    inMemoryToken = token;
    await window.electronAPI?.setSecureAuthToken?.(token);
  } else {
    inMemoryToken = null;
    await window.electronAPI?.clearSecureAuthToken?.();
  }
}

export async function getAuthToken() {
  if (inMemoryToken) return inMemoryToken;
  inMemoryToken = await window.electronAPI?.getSecureAuthToken?.() ?? null;
  return inMemoryToken;
}

export function resetAuthTokenCache() {
  inMemoryToken = null;
}

export async function clearAuthTokens() {
  inMemoryToken = null;
  await window.electronAPI?.clearSecureAuthToken?.();
  localStorage.removeItem('lerzo_user');
  localStorage.removeItem('token');
  localStorage.removeItem('authToken');
  localStorage.removeItem('jwt');
  localStorage.removeItem('lerzo_token');
  localStorage.removeItem('lerzo_refresh_token');
  sessionStorage.clear();
}
