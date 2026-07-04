import { api, clearAuthTokens, setAuthTokens, getAuthToken, configureApiClient } from './api';
import { stopNotificationPoller } from './notificationsPoll';
import { getApiBaseUrl, getDesktopApiBaseUrl, getRegisterUrl, getWebBaseUrl, joinUrl } from '../config/api';
import type { ApiResponse, CurrentUser } from '../types/auth';

export class AuthVerificationError extends Error {
  code: 'unauthorized' | 'unavailable';

  constructor(code: 'unauthorized' | 'unavailable', message: string) {
    super(message);
    this.name = 'AuthVerificationError';
    this.code = code;
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { success: false, error: text } as T;
  }
}

export async function loadCurrentUser() {
  await configureApiClient();
  const token = await getAuthToken();
  // Desktop app is JWT-only. No JWT = not logged in; skip all API calls.
  if (!token) return null;

  try {
    const response = await api.get<ApiResponse<never>>('/auth/me', { lerzoSkipLoader: true });
    if (response.data?.user) {
      return response.data.user;
    }
    throw new AuthVerificationError('unauthorized', 'Login session could not be verified.');
  } catch (error: unknown) {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 401) {
      throw new AuthVerificationError('unauthorized', 'Login session expired. Please sign in again.');
    }
    if (error instanceof AuthVerificationError) {
      throw error;
    }
    console.warn('[auth] loadCurrentUser transient error:', error);
    throw new AuthVerificationError(
      'unavailable',
      error instanceof Error ? error.message : 'Could not verify login session.',
    );
  }
}

export async function refreshDesktopSession() {
  await configureApiClient();
  const token = await getAuthToken();
  if (!token) return null;

  try {
    const response = await api.post<ApiResponse<never> & { token?: string }>('/auth/refresh', undefined, { lerzoSkipLoader: true });
    if (response.data?.token) {
      await setAuthTokens(response.data.token);
    }
    return response.data?.token || token;
  } catch {
    return token;
  }
}

export async function loginWithGoogleToken(firebaseToken: string) {
  await configureApiClient();
  const apiBaseUrl = getApiBaseUrl();
  const endpoints = [
    {
      url: joinUrl(apiBaseUrl, '/google-login'),
      body: { token: firebaseToken },
    },
    {
      url: joinUrl(apiBaseUrl, '/auth/google'),
      body: { idToken: firebaseToken },
    },
  ];

  let lastPayload: (ApiResponse<never> & { unique_id?: string; redirect?: string; new_user?: boolean }) | null = null;

  for (const endpoint of endpoints) {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(endpoint.body),
    });

    const payload = await parseJsonResponse<ApiResponse<never> & { unique_id?: string; redirect?: string; new_user?: boolean }>(response);
    lastPayload = payload;

    if (payload.token) {
      await setAuthTokens(payload.token);
    }

    if (response.ok || payload.success || payload.new_user) {
      return payload;
    }
  }

  return lastPayload ?? { success: false };
}

export async function registerDesktopUser(payload: Partial<CurrentUser> & { google_id?: string; owner_name?: string; terms?: boolean }) {
  await configureApiClient();
  const response = await fetch(getRegisterUrl(), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await parseJsonResponse<ApiResponse<never> & { token?: string }>(response);
  if (data.token) {
    await setAuthTokens(data.token);
  }
  if (!response.ok && !data.success) {
    throw new Error(data.error || data.message || 'Registration failed.');
  }
  return data;
}

export async function logout() {
  await configureApiClient();
  try {
    const token = await getAuthToken();
    await Promise.allSettled([
      fetch(joinUrl(getWebBaseUrl(), '/logout'), {
        method: 'GET',
        credentials: 'include',
      }),
      token
        ? api.post('/auth/logout').catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
  } finally {
    stopNotificationPoller();
    await clearAuthTokens();
    if (window.electronAPI?.clearAuthSession) {
      await window.electronAPI.clearAuthSession();
    }
    window.dispatchEvent(new CustomEvent('lerzo-auth-changed'));
  }
}
