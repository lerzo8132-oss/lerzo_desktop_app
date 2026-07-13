import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { applyTheme, getStoredThemePreference } from '../theme';
import { getApiBaseUrl, getDesktopApiBaseUrl, getWebBaseUrl, joinUrl } from '../config/api';
import { APP_LOGO_SRC, AUTH_ILLUSTRATION_SRC, EXPORT_ILLUSTRATION_SRC } from '../config/assets';
import { registerDesktopUser, loadCurrentUser } from '../services/auth';
import { clearAuthTokens, handleSubscriptionExpired, isSubscriptionExpiredPayload, SubscriptionExpiredError } from '../services/api';
import { extractApiErrorMessage } from '../services/apiErrors';
import {
  beginPageLoading,
  beginRequestLoading,
  endPageLoading,
  endRequestLoading,
  endpointMatchesScope,
  invalidateScopes,
  refreshAfterMutation,
  refreshScopes,
  registerCacheInvalidator,
  registerPageRefresh,
  scopesForTemplate,
  showAppToast,
  TEMPLATE_SCOPE_MAP,
  type RefreshScope,
} from '../services/appShell';
import { markAuthExpiredHandled } from '../services/authFlags';
import { stopNotificationPoller } from '../services/notificationsPoll';
import {
  formatAttendanceDateTime,
  formatAttendanceTime,
  formatBatchScheduleTiming,
  formatScheduleTimeRange,
} from '../utils/formatDateTime';

interface TemplateHtmlPageProps {
  title: string;
  templatePath: string;
  html: string;
}

const iconCache = new Map<string, string>();

const desktopApiMap: Array<[RegExp, string]> = [
  [/^\/api\/auth\/me(?:\?.*)?$/, '/auth/me'],
  [/^\/api\/dashboard(?:\?.*)?$/, '/dashboard'],
  [/^\/api\/students(?:\?.*)?$/, '/students'],
  [/^\/api\/enquiries(?:\?.*)?$/, '/enquiries'],
  [/^\/api\/courses(?:\?.*)?$/, '/courses'],
  [/^\/api\/schemes(?:\?.*)?$/, '/schemes'],
  [/^\/api\/batches(?:\?.*)?$/, '/batches'],
  [/^\/api\/staff(?:\?.*)?$/, '/staff'],
  [/^\/api\/reports\/students(?:\?.*)?$/, '/reports/students'],
  [/^\/api\/reports\/fees(?:\?.*)?$/, '/reports/fees'],
  [/^\/api\/reports\/batches(?:\?.*)?$/, '/reports/batches'],
  [/^\/api\/reports\/enquiries(?:\?.*)?$/, '/reports/enquiries'],
  [/^\/api\/subscription\/plans(?:\?.*)?$/, '/subscription/plans'],
  [/^\/api\/notifications\/list(?:\?.*)?$/, '/notifications/list'],
  [/^\/api\/notifications\/unread-count(?:\?.*)?$/, '/notifications/unread-count'],
  [/^\/api\/notifications\/(\d+)\/read(?:\?.*)?$/, '/notifications/$1/read'],
  [/^\/api\/notifications\/mark-all-read(?:\?.*)?$/, '/notifications/mark-all-read'],
  [/^\/c\/[^/]+\/api\/backup\/export(?:\?.*)?$/, '/dashboard'],
];

const routeMap: Array<[RegExp, string]> = [
  [/\/dashboard$/, '/dashboard'],
  [/\/enquiries$/, '/enquiries-list'],
  [/\/enquiries\/add$/, '/enquiries-add'],
  [/\/students$/, '/students-list'],
  [/\/students\/add$/, '/students-add'],
  [/\/batches$/, '/batches-list'],
  [/\/batches\/add$/, '/batches-add'],
  [/\/schemes$/, '/schemes-list'],
  [/\/schemes\/add$/, '/schemes-add'],
  [/\/courses$/, '/courses-list'],
  [/\/courses\/add$/, '/courses-add'],
  [/\/reports$/, '/reports'],
  [/\/reports\/students$/, '/reports-students'],
  [/\/reports\/fees$/, '/reports-fees'],
  [/\/reports\/batches$/, '/reports-batches'],
  [/\/reports\/enquiries$/, '/reports-enquiries'],
  [/\/staff$/, '/staff-list'],
  [/\/staff\/add$/, '/staff-add'],
  [/\/staff\/dashboard$/, '/staff-dashboard'],
  [/\/staff\/attendance$/, '/staff-attendance_list'],
  [/\/staff\/leave-requests$/, '/staff-leave_requests'],
  [/\/staff\/corrections$/, '/staff-corrections'],
  [/\/staff\/reports$/, '/staff-reports'],
  [/\/subscription\/plans$/, '/subscription-plans'],
  [/\/settings\/profile$/, '/settings-profile'],
  [/\/settings\/attendance$/, '/settings-attendance'],
  [/\/settings\/logo$/, '/settings-logo'],
  [/\/settings\/invoices$/, '/settings-invoices'],
  [/\/settings\/backup$/, '/settings-backup'],
  [/\/notifications$/, '/notifications'],
  [/\/exports\/options$/, '/exports-options'],
];

function iconComponentName(name: string) {
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function parseStyle(style: string) {
  if (!style) return undefined;

  return Object.fromEntries(
    style
      .split(';')
      .filter(Boolean)
      .map((rule) => {
        const [key, value] = rule.split(':');
        return [
          key.trim().replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
          value.trim(),
        ];
      }),
  ) as React.CSSProperties;
}

function renderIcon(name: string, className: string, style: string) {
  const cacheKey = `${name}:${className}:${style}`;
  if (iconCache.has(cacheKey)) return iconCache.get(cacheKey) ?? '';

  const Icon = (LucideIcons as unknown as Record<string, React.ComponentType<{
    className?: string;
    style?: React.CSSProperties;
    'aria-hidden'?: string;
  }>>)[iconComponentName(name)];
  if (!Icon) return '';

  const markup = renderToStaticMarkup(
    <Icon
      className={className || undefined}
      style={parseStyle(style)}
      aria-hidden="true"
    />,
  );

  iconCache.set(cacheKey, markup);
  return markup;
}

function refreshLucideIcons(root: HTMLElement) {
  root.querySelectorAll('i[data-lucide]').forEach((node) => {
    const iconName = node.getAttribute('data-lucide');
    if (!iconName) return;

    const markup = renderIcon(iconName, node.getAttribute('class') || '', node.getAttribute('style') || '');
    if (!markup) return;

    const wrapper = document.createElement('span');
    wrapper.innerHTML = markup;
    const icon = wrapper.firstElementChild;
    if (icon) node.replaceWith(icon);
  });
}

function desktopApiPathFor(rawUrl: string) {
  const match = desktopApiMap.find(([pattern]) => pattern.test(rawUrl));
  if (!match) return null;
  const query = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : '';
  const path = rawUrl.replace(match[0], match[1]);
  return `${path}${path.includes('?') ? '' : query}`;
}

function electronRouteFor(href: string) {
  if (!href || href === '#') return null;
  if (href.startsWith('#/')) {
    return href.slice(1);
  }
  let pathname = href;
  try {
    const parsed = new URL(href, window.location.origin);
    pathname = parsed.pathname;
  } catch {
    pathname = href.split('?')[0];
  }

  const normalized = pathname.replace(/\/+$/, '');
  const match = routeMap.find(([pattern]) => pattern.test(normalized));
  return match?.[1] ?? null;
}

function pageQueryParam(name: string) {
  const hash = window.location.hash || '';
  const searchStart = hash.indexOf('?');
  const search = searchStart >= 0 ? hash.slice(searchStart) : window.location.search;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return params.get(name);
}

function setFormFieldValue(root: HTMLElement, name: string, value: unknown) {
  const field = root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`);
  if (!field || value === null || value === undefined || value === '') return;
  field.value = String(value);
}

function ensureHiddenField(root: HTMLElement, name: string, value: string) {
  const form = root.querySelector('form');
  if (!form) return;
  let field = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!field) {
    field = document.createElement('input');
    field.type = 'hidden';
    field.name = name;
    form.appendChild(field);
  }
  field.value = value;
}

function feeStatusBadgeClass(status: unknown) {
  const text = valueText(status).toLowerCase();
  if (text === 'paid') return 'badge-success';
  if (text === 'partial') return 'badge-warning';
  return 'badge-error';
}

function enquiryStatusBadge(status: unknown) {
  const text = valueText(status || 'active');
  const lower = text.toLowerCase();
  const cls = lower === 'converted' ? 'badge-neutral' : lower === 'closed' ? 'badge-error' : 'badge-success';
  const label = lower === 'active' ? 'Active' : lower.charAt(0).toUpperCase() + lower.slice(1);
  return `<span class="badge ${cls}">${label}</span>`;
}

function valueText(value: unknown) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return value.toLocaleString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return '';
  return String(value);
}

function valueFrom(record: Record<string, unknown>, keys: string[], fallback: unknown = 0) {
  for (const key of keys) {
    const value = record[key];
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function unwrapData(payload: unknown): unknown {
  let current = payload;
  for (let i = 0; i < 3; i += 1) {
    const record = asRecord(current);
    if (!('data' in record)) break;
    current = record.data;
  }
  return current;
}

function collectArraysByKey(value: unknown, keys: string[], depth = 0): Record<string, unknown>[] | null {
  if (depth > 5 || value === null || value === undefined) return null;
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  const record = asRecord(value);
  for (const key of keys) {
    const item = record[key];
    if (Array.isArray(item)) return item as Record<string, unknown>[];
    const nested = collectArraysByKey(unwrapData(item), keys, depth + 1);
    if (nested) return nested;
  }
  for (const item of Object.values(record)) {
    const nested = collectArraysByKey(unwrapData(item), keys, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function findArray(value: unknown, keys: string[]): Record<string, unknown>[] {
  const unwrapped = unwrapData(value);
  if (Array.isArray(unwrapped)) return unwrapped as Record<string, unknown>[];

  const record = asRecord(unwrapped);
  const allKeys = [...keys, 'items', 'results', 'list'];
  for (const key of allKeys) {
    const item = record[key];
    if (Array.isArray(item)) return item as Record<string, unknown>[];
    const nested = unwrapData(item);
    if (Array.isArray(nested)) return nested as Record<string, unknown>[];
  }

  const nestedByKey = collectArraysByKey(record, allKeys);
  if (nestedByKey) return nestedByKey;

  for (const item of Object.values(record)) {
    if (Array.isArray(item)) return item as Record<string, unknown>[];
  }

  return [];
}

function findRecord(value: unknown, keys: string[]): Record<string, unknown> {
  const unwrapped = unwrapData(value);
  const record = asRecord(unwrapped);
  for (const key of keys) {
    const nested = asRecord(unwrapData(record[key]));
    if (Object.keys(nested).length) return nested;
  }
  return record;
}

function findNumber(value: unknown, keys: string[], fallback: number) {
  const record = asRecord(unwrapData(value));
  for (const key of keys) {
    const next = record[key];
    if (typeof next === 'number') return next;
    if (typeof next === 'string' && next.trim() && !Number.isNaN(Number(next))) return Number(next);
  }
  return fallback;
}

function debugPageState(templatePath: string, stage: string, data: Record<string, unknown>) {
  void templatePath;
  void stage;
  void data;
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

function normalizeTemplateHtml(html: string, templatePath: string) {
  let next = html
    .replace(/src="#"/g, 'src=""')
    .replace(/href="#"/g, 'href=""')
    .replace(/{{\s*url_for\('static',\s*filename='([^']+)'\)\s*}}/g, '/static/$1')
    .replace(/{{\s*url_for\("static",\s*filename="([^"]+)"\)\s*}}/g, '/static/$1')
    .replace(/Demo Admin/g, 'Account')
    .replace(/Sample Plan/g, '')
    .replace(/Sample Name/g, '')
    .replace(/\bSample\b/g, '')
    .replace(/₹24,500(?:\.00)?/g, '₹0')
    .replace(/value="24,500"/g, 'value=""')
    .replace(/Total Records:\s*124/g, 'Total Records: 0')
    .replace(/data-target="(?:124|98|15|245,000\.00|32,000)"/g, 'data-target="0"')
    .replace(/>124</g, '>0<')
    .replace(/>98</g, '>0<')
    .replace(/>15</g, '>0<');

  if (templatePath === 'auth/login.html') {
    next = next
      .replace(/<img src="" alt="Lerzo Auth Illustration">/g, `<img src="${AUTH_ILLUSTRATION_SRC}" alt="Lerzo Auth Illustration">`)
      .replace(/<img src="" alt="Lerzo" style="width: 100%; height: 100%; object-fit: contain;">/g, `<img src="${APP_LOGO_SRC}" alt="Lerzo" style="width: 100%; height: 100%; object-fit: contain;">`);
  }

  if (templatePath === 'settings/profile.html') {
    next = next.replace(/<img src="" alt="Profile Settings"/g, '<img src="/static/images/Profile data-pana.svg" alt="Profile Settings"');
  }

  if (templatePath === 'reports/index.html') {
    next = next.replace(/<img src="" alt="Reports & Analytics"/g, '<img src="/static/images/Report-bro.svg" alt="Reports & Analytics"');
  }

  if (templatePath === 'exports/options.html') {
    next = next
      .replace(/<img src="" alt="Data Management"/g, `<img src="${EXPORT_ILLUSTRATION_SRC}" alt="Data Management"`)
      .replace(/<img src="#" alt="Export Data"/g, `<img src="${EXPORT_ILLUSTRATION_SRC}" alt="Export Data"`)
      .replace(/<img src="" alt="Export Data"/g, `<img src="${EXPORT_ILLUSTRATION_SRC}" alt="Export Data"`);
  }

  return next;
}

function installFlaskApiBridge() {
  const win = window as typeof window & { __lerzoFlaskApiBridgeInstalled?: boolean };
  if (win.__lerzoFlaskApiBridgeInstalled || !window.fetch) return;
  win.__lerzoFlaskApiBridgeInstalled = true;

  const originalFetch = window.fetch.bind(window);
  const backendBase = getApiBaseUrl();

  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    let nextInput = input;
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const rawPath = rawUrl.startsWith('http') ? new URL(rawUrl).pathname + new URL(rawUrl).search : rawUrl;
    const desktopPath = desktopApiPathFor(rawPath);

    if (desktopPath) {
      nextInput = `${getDesktopApiBaseUrl()}${desktopPath}`;
    } else if (rawUrl.startsWith('/')) {
      nextInput = joinUrl(backendBase, rawUrl);
    }

    const token = await window.electronAPI?.getSecureAuthToken?.();
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    if (token && (rawPath.startsWith('/api/') || rawPath.startsWith('/desktop-api/') || Boolean(desktopPath))) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    return originalFetch(nextInput, {
      ...init,
      credentials: init.credentials || 'include',
      headers,
    });
  };
}

function installNavigationBridge(root: HTMLElement) {
  const controller = new AbortController();
  const listenerOptions = { capture: true, signal: controller.signal } as const;

  root.addEventListener('click', (event) => {
    const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;
    const route = electronRouteFor(anchor.getAttribute('href') || '');
    if (!route) return;
    event.preventDefault();
    window.location.hash = route.startsWith('#') ? route : `#${route.startsWith('/') ? route : `/${route}`}`;
  }, listenerOptions);

  return () => controller.abort();
}

function installFlaskDialogBridge() {
  const win = window as typeof window & { __lerzoDialogBridgeInstalled?: boolean };
  if (win.__lerzoDialogBridgeInstalled) return;
  win.__lerzoDialogBridgeInstalled = true;

  window.alert = (message?: unknown) => {
    if (window.showToast) {
      window.showToast('Notification', String(message ?? ''), 'info');
      return;
    }
    console.info(message);
  };
}

function showLoginToast(root: HTMLElement, message: string) {
  const toast = root.querySelector<HTMLElement>('#toast-notification');
  if (toast) {
    const title = toast.querySelector<HTMLElement>('.toast-title');
    const body = toast.querySelector<HTMLElement>('.toast-message');
    if (title) title.textContent = 'Login';
    if (body) body.textContent = message;
    toast.style.display = 'block';
    window.setTimeout(() => {
      toast.style.display = 'none';
    }, 2800);
    return;
  }

  window.showToast?.('Login', message, 'error');
}

function isServerUnavailableMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('server is currently unavailable') ||
    normalized.includes('backend unavailable') ||
    normalized.includes('backend is not running') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('network error') ||
    normalized.includes('err_connection_refused') ||
    normalized.includes('connection refused') ||
    normalized.includes('timeout') ||
    normalized.includes('timed out') ||
    normalized.includes('request failed with 404') ||
    normalized.includes('request failed with 500') ||
    normalized.includes('request failed with 502') ||
    normalized.includes('request failed with 503') ||
    normalized.includes('request failed with 504')
  );
}

function openServerDownPage(from = '/auth-login') {
  const currentHash = window.location.hash.replace(/^#/, '') || window.location.pathname;
  const currentPath = currentHash.split('?')[0] || '/';
  if (currentPath === '/server-down') {
    console.warn('[ROUTE GUARD] preventing server-down loop');
    return;
  }

  const cleanFrom = (from || '/dashboard').split('?')[0] === '/server-down' ? '/dashboard' : (from || '/dashboard').split('?')[0];
  const target = `/server-down?from=${encodeURIComponent(cleanFrom)}`;
  window.location.hash = target;
}

function isMissingIpcHandlerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('No handler registered') || message.includes('not registered');
}

async function startElectronGoogleLogin() {
  const authLogin = window.electronAPI?.auth?.loginWithGoogle;
  if (authLogin) {
    try {
      return await authLogin();
    } catch (error) {
      if (!isMissingIpcHandlerError(error)) {
        throw error;
      }
    }
  }

  const legacyLogin = window.electronAPI?.startGoogleLogin;
  if (legacyLogin) {
    return legacyLogin();
  }

  throw new Error('Desktop login bridge is unavailable. Restart the app and try again.');
}

function hideElectronLoginLoading(root: HTMLElement) {
  const loading = root.querySelector<HTMLElement>('#auth-loading');
  const button = root.querySelector<HTMLButtonElement>('#google-login-btn');
  if (loading) {
    loading.style.display = 'none';
    loading.style.pointerEvents = 'none';
  }
  if (button) {
    button.disabled = false;
    button.removeAttribute('disabled');
  }
}

function showElectronLoginRetry(root: HTMLElement, message: string) {
  hideElectronLoginLoading(root);
  const errorBox = root.querySelector<HTMLElement>('#config-error');
  const errorMessage = root.querySelector<HTMLElement>('#error-message');
  if (errorMessage) errorMessage.textContent = message;
  if (errorBox) errorBox.style.display = 'block';
}

async function completeElectronLoginFromToken(root: HTMLElement) {
  hideElectronLoginLoading(root);
  window.dispatchEvent(new CustomEvent('lerzo-auth-changed'));
  window.dispatchEvent(new CustomEvent('lerzo-login-complete'));
}

function startDesktopAuthCompletionWatch(root: HTMLElement) {
  let stopped = false;
  let completed = false;
  let attempts = 0;
  // ~60s of polling (30 * 2s) as a desktop-session fallback when IPC notify is lost.
  const maxAttempts = 30;
  let pollTimer: number | undefined;
  let unsubscribeFailed: (() => void) | undefined;

  // Removing the listener here (before any completion work) is critical: the
  // completion path dispatches 'lerzo-login-complete' again to notify the auth
  // context. If the watch listener were still attached it would re-enter this
  // watch synchronously and overflow the call stack.
  const stop = () => {
    stopped = true;
    if (pollTimer) {
      window.clearTimeout(pollTimer);
      pollTimer = undefined;
    }
    window.removeEventListener('lerzo-login-complete', onLoginComplete);
    window.removeEventListener('lerzo-login-failed', onLoginFailed as EventListener);
    unsubscribeFailed?.();
    unsubscribeFailed = undefined;
  };

  const failWithRetry = (reason?: string) => {
    if (completed || stopped) return;
    stop();
    console.warn('[Renderer Auth] desktop login failed =', reason || 'unknown');
    showElectronLoginRetry(
      root,
      'We could not complete sign-in. Please click "Continue with Google" to try again.',
    );
  };

  const onLoginFailed = (event: Event) => {
    const detail = (event as CustomEvent<string>).detail;
    failWithRetry(detail);
  };

  const finish = async () => {
    if (completed) return;
    completed = true;
    stop();
    await completeElectronLoginFromToken(root);
  };

  const poll = async () => {
    if (stopped) return;
    attempts += 1;

    try {
      const polled = await window.electronAPI?.pollDesktopAuthToken?.();
      if (polled?.ready) {
        await finish();
        return;
      }

      const token = await window.electronAPI?.getSecureAuthToken?.();
      if (token) {
        await finish();
        return;
      }
    } catch (error) {
      console.warn('[Renderer Auth] desktop login poll failed =', error);
    }

    if (stopped) return;

    if (attempts >= maxAttempts) {
      failWithRetry('poll_timeout');
      return;
    }

    pollTimer = window.setTimeout(() => {
      void poll();
    }, 2000);
  };

  const onLoginComplete = () => {
    void finish();
  };

  window.addEventListener('lerzo-login-complete', onLoginComplete);
  window.addEventListener('lerzo-login-failed', onLoginFailed as EventListener);
  unsubscribeFailed = window.electronAPI?.onAuthLoginFailed?.((reason) => failWithRetry(reason));
  pollTimer = window.setTimeout(() => {
    void poll();
  }, 2000);

  return () => {
    stop();
  };
}

function installElectronLoginBridge(root: HTMLElement) {
  const button = root.querySelector<HTMLButtonElement>('#google-login-btn');
  const loading = root.querySelector<HTMLElement>('#auth-loading');
  const errorBox = root.querySelector<HTMLElement>('#config-error');
  const errorMessage = root.querySelector<HTMLElement>('#error-message');

  root.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    const src = image.getAttribute('src') || '';
    if (!src || src === '#') {
      const fallback = document.createElement('div');
      fallback.className = image.closest('.logo-box') ? 'login-logo-fallback' : 'login-illustration-fallback';
      fallback.textContent = image.closest('.logo-box') ? 'L' : 'Lerzo';
      image.replaceWith(fallback);
      return;
    }
    image.addEventListener('error', () => {
      const fallback = document.createElement('div');
      fallback.className = image.closest('.logo-box') ? 'login-logo-fallback' : 'login-illustration-fallback';
      fallback.textContent = image.closest('.logo-box') ? 'L' : '';
      image.replaceWith(fallback);
    }, { once: true });
  });

  if (loading) {
    loading.style.display = 'none';
    loading.style.pointerEvents = 'none';
  }
  if (errorBox) errorBox.style.display = 'none';
  const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?').slice(1).join('?') : '';
  const loginError = hashQuery ? new URLSearchParams(hashQuery).get('error') : '';
  if (loginError && errorBox && errorMessage) {
    errorMessage.textContent = loginError;
    errorBox.style.display = 'block';
  }
  if (!button) return;

  button.disabled = false;
  button.removeAttribute('disabled');
  button.style.pointerEvents = 'auto';
  button.style.position = 'relative';
  button.style.zIndex = '5';
  button.dataset.electronLoginInstalled = 'true';
  let stopAuthWatch: (() => void) | undefined;

  button.onclick = async (event) => {
    event.preventDefault();
    event.stopPropagation();

    button.disabled = true;
    if (loading) loading.style.display = 'flex';
    if (errorBox) errorBox.style.display = 'none';

    try {
      await startElectronGoogleLogin();
      showLoginToast(root, 'Opening Google sign-in in your browser.');
      stopAuthWatch?.();
      stopAuthWatch = startDesktopAuthCompletionWatch(root);
    } catch (error) {
      button.disabled = false;
      if (loading) loading.style.display = 'none';
      const message = error instanceof Error ? error.message : 'Could not start Google sign-in.';
      if (isServerUnavailableMessage(message)) {
        openServerDownPage('/auth-login');
        return;
      }
      if (errorMessage) errorMessage.textContent = message;
      if (errorBox) errorBox.style.display = 'block';
      showLoginToast(root, message);
    }
  };
}

function installElectronRegisterBridge(root: HTMLElement) {
  if (root.dataset.registerBridgeInstalled === 'true') return;
  root.dataset.registerBridgeInstalled = 'true';

  root.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    const src = image.getAttribute('src') || '';
    if (!src || src === '#') {
      image.src = image.closest('.logo-box') ? APP_LOGO_SRC : AUTH_ILLUSTRATION_SRC;
    }
  });

  const email = pageQueryParam('email') || '';
  const name = pageQueryParam('name') || '';
  const googleId = pageQueryParam('google_id') || '';

  root.querySelectorAll<HTMLAnchorElement>('.terms-label a').forEach((link, index) => {
    link.href = joinUrl(getWebBaseUrl(), index === 0 ? '/terms-of-service' : '/privacy-policy');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });

  if (email || name || googleId) {
    setFormFieldValue(root, 'owner_name', name);
    const emailField = root.querySelector<HTMLInputElement>('input[type="email"]');
    if (emailField && email) {
      emailField.value = email;
      emailField.name = 'email';
    }
    ensureHiddenField(root, 'email', email);
    ensureHiddenField(root, 'google_id', googleId);
  } else {
    showActionToast(root, 'Google sign-in details are missing. Please sign in again.', 'error');
    window.setTimeout(() => {
      window.location.hash = '#/auth-login';
    }, 1800);
  }

  const form = root.querySelector<HTMLFormElement>('.register-form');
  if (!form) return;

  const formSide = root.querySelector<HTMLElement>('.auth-form-side');
  if (formSide) {
    formSide.scrollTop = 0;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const body = formToJson(form);
    const submitBtn = form.querySelector<HTMLButtonElement>('.submit-btn');
    const originalHtml = submitBtn?.innerHTML || '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Creating account...</span>';
    }
    try {
      if (!email && !body.email) {
        throw new Error('Google sign-in details are missing. Please sign in again.');
      }
      if (!googleId && !body.google_id) {
        throw new Error('Google sign-in details are missing. Please sign in again.');
      }
      const result = await registerDesktopUser({
        email: String(body.email || email),
        google_id: String(body.google_id || googleId),
        owner_name: String(body.owner_name || ''),
        center_name: String(body.center_name || ''),
        phone: String(body.phone || ''),
        address: String(body.address || ''),
        city: String(body.city || ''),
        pincode: String(body.pincode || ''),
        terms: body.terms === true || body.terms === 'on',
      });
      if (!result.token) {
        throw new Error(result.error || 'Registration completed without a login token.');
      }
      window.dispatchEvent(new CustomEvent('lerzo-auth-changed'));
      window.location.hash = '#/dashboard';
    } catch (error) {
      showActionToast(root, error instanceof Error ? error.message : 'Registration failed.', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
      }
    }
  }, true);
}

function setLocationStatus(status: HTMLElement | null, message: string, type: 'loading' | 'success' | 'error') {
  if (!status) return;
  status.style.display = 'block';
  status.className = `location-status location-status--${type}`;
  status.innerHTML = `<span>${message.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char))}</span>`;
}

function geolocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return 'Location permission denied. Allow location access in system settings, or use Scan QR to Set Location from your phone.';
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return 'Desktop location is unavailable on this device. Enable Location Services in macOS/Windows settings, or use Scan QR to Set Location from your phone for accurate GPS.';
  }
  if (error.code === error.TIMEOUT) {
    return 'Timed out getting location. Try again near a window, or use Scan QR to Set Location from your phone.';
  }
  return 'Could not get current location. Use Scan QR from your phone, or enter latitude and longitude manually.';
}

function installAttendanceLocationBridge(root: HTMLElement) {
  const latitude = root.querySelector<HTMLInputElement>('#latitude');
  const longitude = root.querySelector<HTMLInputElement>('#longitude');
  const status = root.querySelector<HTMLElement>('#locationStatus');
  const saveButton = root.querySelector<HTMLButtonElement>('button[type="submit"]');
  const desktopButton = root.querySelector<HTMLButtonElement>('#useLocationBtn');
  const idleHtml = '<i data-lucide="crosshair"></i><span>Use Current Location (Desktop)</span>';

  const resetDesktopButton = () => {
    if (!desktopButton) return;
    desktopButton.disabled = false;
    desktopButton.innerHTML = idleHtml;
    root.querySelectorAll('i[data-lucide]').forEach((node) => {
      const iconName = node.getAttribute('data-lucide');
      if (!iconName) return;
      const markup = renderIcon(iconName, node.getAttribute('class') || '', node.getAttribute('style') || '');
      if (!markup) return;
      const wrapper = document.createElement('span');
      wrapper.innerHTML = markup;
      const icon = wrapper.firstElementChild;
      if (icon) node.replaceWith(icon);
    });
  };

  const detectLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus(status, 'GPS/location not available on this device. Scan the QR code from your phone instead.', 'error');
      return;
    }

    if (desktopButton) {
      desktopButton.disabled = true;
      desktopButton.innerHTML = '<span class="template-spinner"></span><span>Getting current location...</span>';
    }
    setLocationStatus(
      status,
      'Getting current location… Desktop uses network/Wi‑Fi location and may be less accurate than phone GPS. For best accuracy, use Scan QR.',
      'loading',
    );

    let bestPosition: GeolocationPosition | null = null;
    let watchId: number | null = null;
    let settled = false;

    const finishSuccess = (position: GeolocationPosition) => {
      if (settled) return;
      settled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      window.clearTimeout(fallbackTimer);

      const lat = position.coords.latitude.toFixed(6);
      const lng = position.coords.longitude.toFixed(6);
      const accuracyM = Math.round(position.coords.accuracy || 0);
      if (latitude) latitude.value = lat;
      if (longitude) longitude.value = lng;
      if (saveButton) saveButton.disabled = false;
      setLocationStatus(
        status,
        `Location detected: ${lat}, ${lng}${accuracyM ? ` (±${accuracyM} m)` : ''}. Verify on a map, then click Save Attendance Settings.`,
        'success',
      );
      resetDesktopButton();
    };

    const finishError = (error: GeolocationPositionError) => {
      if (settled) return;
      settled = true;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      window.clearTimeout(fallbackTimer);

      const message = geolocationErrorMessage(error);
      setLocationStatus(status, message, 'error');
      if (error.code === error.PERMISSION_DENIED && status) {
        const help = document.createElement('button');
        help.type = 'button';
        help.className = 'btn btn-secondary';
        help.style.marginTop = '12px';
        help.style.width = '100%';
        help.innerHTML = '<span>Open Location Settings</span>';
        help.addEventListener('click', () => {
          void window.electronAPI?.openLocationSettings?.();
        });
        status.appendChild(help);
      }
      resetDesktopButton();
    };

    const fallbackTimer = window.setTimeout(() => {
      if (bestPosition) {
        finishSuccess(bestPosition);
        return;
      }
      finishError({
        code: 3,
        message: 'Timeout',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError);
    }, 30000);

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!bestPosition || position.coords.accuracy < bestPosition.coords.accuracy) {
          bestPosition = position;
        }
        if (position.coords.accuracy > 0 && position.coords.accuracy <= 75) {
          finishSuccess(position);
        }
      },
      (error) => {
        if (bestPosition) {
          finishSuccess(bestPosition);
          return;
        }
        finishError(error);
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 },
    );
  };

  if (desktopButton && desktopButton.dataset.electronLocationInstalled !== 'true') {
    desktopButton.dataset.electronLocationInstalled = 'true';
    desktopButton.onclick = (event) => {
      event.preventDefault();
      detectLocation();
    };
  }

  (window as typeof window & { useCurrentLocation?: () => void }).useCurrentLocation = detectLocation;
}

function restructureAttendanceOfficeCard(root: HTMLElement) {
  const officeCard = Array.from(root.querySelectorAll<HTMLElement>('.card')).find((card) => (
    card.querySelector('h5')?.textContent?.trim() === 'Office Location'
  ));
  if (!officeCard) return;

  root.querySelectorAll<HTMLButtonElement>('button[type="submit"]').forEach((button) => {
    if (button.textContent?.includes('Save Attendance Settings') && !officeCard.contains(button)) {
      button.closest('div')?.remove();
    }
  });

  const body = officeCard.querySelector<HTMLElement>('div[style*="padding: 24px"], div[style*="padding:24px"]');
  if (!body) return;

  if (!body.querySelector('#scanQrLocationBtn')) {
    const actions = document.createElement('div');
    actions.className = 'attendance-office-actions';
    actions.innerHTML = `
      <button type="button" id="scanQrLocationBtn" class="btn btn-primary" style="width:100%;">
        <i data-lucide="qr-code"></i><span>Scan QR to Set Location</span>
      </button>
      <button type="button" id="useLocationBtn" class="btn btn-secondary" style="width:100%;">
        <i data-lucide="crosshair"></i><span>Use Current Location (Desktop)</span>
      </button>
    `;
    const existingUseButton = body.querySelector('#useLocationBtn');
    if (existingUseButton) {
      existingUseButton.replaceWith(actions);
    } else {
      body.prepend(actions);
    }
  }

  if (!officeCard.querySelector('[data-attendance-save="true"]')) {
    const saveWrap = document.createElement('div');
    saveWrap.style.marginTop = '20px';
    saveWrap.innerHTML = `
      <button type="submit" class="btn btn-primary" data-attendance-save="true" style="width:100%;justify-content:center;padding:14px 24px;font-size:15px;">
        <i data-lucide="save"></i><span>Save Attendance Settings</span>
      </button>
    `;
    body.appendChild(saveWrap);
  }

  const grid = root.querySelector<HTMLElement>('#attendanceSettingsForm div[style*="grid-template-columns"]');
  if (grid) {
    grid.style.gridTemplateColumns = '1fr';
    grid.style.maxWidth = '760px';
  }
}

function installAttendanceQrBridge(root: HTMLElement, refetch: () => void) {
  if (root.dataset.qrBridgeInstalled === 'true') return;
  root.dataset.qrBridgeInstalled = 'true';

  const status = root.querySelector<HTMLElement>('#locationStatus');
  let pollTimer: number | null = null;
  let activeToken: string | null = null;

  const closeModal = () => {
    document.querySelector('[data-qr-location-modal="true"]')?.remove();
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
    activeToken = null;
  };

  const startQrLocationSetup = async () => {
    closeModal();
    setLocationStatus(status, 'Generating QR code...', 'loading');
    try {
      const payload = await desktopApiRequest('/settings/attendance/location-qr', 'POST', undefined, { silent: true }) as {
        token?: string;
        setup_url?: string;
        qr_image_url?: string;
      };
      const setupUrl = payload.setup_url || '';
      const qrImageUrl = `${payload.qr_image_url || ''}${payload.qr_image_url?.includes('?') ? '&' : '?'}t=${Date.now()}`;
      const token = payload.token || '';
      if (!setupUrl || !token || !payload.qr_image_url) {
        throw new Error('Could not create QR setup session. Deploy the latest Lerzo API and try again.');
      }
      activeToken = token;

      const modal = document.createElement('div');
      modal.dataset.qrLocationModal = 'true';
      modal.className = 'qr-location-modal';
      modal.innerHTML = `
        <div class="qr-location-panel">
          <h3 class="card-title" style="margin-bottom:8px;">Scan QR to Set Location</h3>
          <p class="label-meta">Scan this code with your phone, tap Share Current Location, and allow GPS access.</p>
          <div class="qr-code-shell">
            <p class="qr-code-loading">Loading QR code…</p>
            <img src="${qrImageUrl}" alt="Location setup QR code" style="display:none;" />
          </div>
          <p class="label-meta" style="word-break:break-all;">${setupUrl}</p>
          <div style="display:flex;gap:12px;margin-top:18px;">
            <button type="button" class="btn btn-secondary" data-qr-regenerate="true" style="flex:1;">Generate New QR</button>
            <button type="button" class="btn btn-secondary" data-qr-close="true" style="flex:1;">Close</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
      const qrImg = modal.querySelector<HTMLImageElement>('img');
      const qrLoading = modal.querySelector<HTMLElement>('.qr-code-loading');
      if (qrImg) {
        qrImg.addEventListener('load', () => {
          qrImg.style.display = 'block';
          qrLoading?.remove();
        });
        qrImg.addEventListener('error', () => {
          if (qrLoading) qrLoading.textContent = 'Could not load QR image. Use the link below or tap Generate New QR.';
        });
      }
      modal.querySelector('[data-qr-close="true"]')?.addEventListener('click', closeModal);
      modal.querySelector('[data-qr-regenerate="true"]')?.addEventListener('click', () => {
        void startQrLocationSetup();
      });
      modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
      });

      setLocationStatus(status, 'Waiting for phone location. Scan the QR code and allow GPS on your mobile device.', 'loading');

      pollTimer = window.setInterval(async () => {
        if (!activeToken) return;
        try {
          const poll = await desktopApiGet(`/settings/attendance/location-qr/${encodeURIComponent(activeToken)}`, { silent: true }) as {
            status?: string;
            latitude?: number;
            longitude?: number;
            error?: string;
          };
          if (poll.status === 'completed' && poll.latitude != null && poll.longitude != null) {
            const lat = Number(poll.latitude).toFixed(6);
            const lng = Number(poll.longitude).toFixed(6);
            const latField = root.querySelector<HTMLInputElement>('#latitude');
            const lngField = root.querySelector<HTMLInputElement>('#longitude');
            if (latField) latField.value = lat;
            if (lngField) lngField.value = lng;
            setLocationStatus(status, `Location received from phone: ${lat}, ${lng}. Click Save Attendance Settings to store it.`, 'success');
            closeModal();
            showActionToast(root, 'Office location updated from mobile GPS.');
            refetch();
          } else if (poll.status === 'error') {
            setLocationStatus(status, poll.error || 'Mobile location setup failed.', 'error');
            closeModal();
          }
        } catch {
          // Keep polling until the session expires.
        }
      }, 2500);
    } catch (error) {
      setLocationStatus(status, error instanceof Error ? error.message : 'Could not start QR location setup.', 'error');
      closeModal();
    }
  };

  root.querySelector('#scanQrLocationBtn')?.addEventListener('click', () => {
    void startQrLocationSetup();
  });
}

function installDashboardClock(root: HTMLElement) {
  const element = root.querySelector<HTMLElement>('#current-datetime');
  if (!element || element.dataset.clockInstalled === 'true') return;
  element.dataset.clockInstalled = 'true';
  const update = () => {
    element.textContent = new Date().toLocaleString('en-IN', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };
  update();
  const timer = window.setInterval(update, 1000);
  element.dataset.clockTimer = String(timer);
}

function currentUserIsSuperAdmin() {
  try {
    const rawUser = localStorage.getItem('lerzo_user');
    if (!rawUser) return false;
    const user = JSON.parse(rawUser) as { is_super_admin?: boolean; permissions?: string[] };
    return Boolean(user.is_super_admin || user.permissions?.includes('super_admin'));
  } catch {
    return false;
  }
}

function hideTenantDeveloperControls(root: HTMLElement) {
  if (currentUserIsSuperAdmin()) return;

  root.querySelectorAll('a, button').forEach((node) => {
    const label = node.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
    const href = node instanceof HTMLAnchorElement ? node.getAttribute('href') || '' : '';
    if (
      label.includes('developer tools') ||
      label.includes('api configuration') ||
      label.includes('sdk settings') ||
      label.includes('debug') ||
      href.includes('developer-tools') ||
      href.includes('api-monitor')
    ) {
      const wrapper = node.closest('.card') && label.includes('developer tools') ? node : node;
      (wrapper as HTMLElement).style.display = 'none';
    }
  });
}

function emptyPayloadForEndpoint(endpoint: string) {
  const path = endpoint.split('?')[0].replace(/^\/+/, '');
  const emptyByPath: Record<string, Record<string, unknown>> = {
    dashboard: { stats: {}, data: { stats: {} } },
    'staff/dashboard': {
      data: {
        total_staff: 0,
        present_today: 0,
        absent_today: 0,
        pending_leaves: 0,
        active_batches: 0,
      },
      total_staff: 0,
      present_today: 0,
      absent_today: 0,
      pending_leaves: 0,
      active_batches: 0,
    },
    'staff/attendance': { attendances: [], attendance: [], total: 0 },
    'staff/leave-requests': { leave_requests: [], leaves: [], total: 0 },
    'staff/corrections': { corrections: [], requests: [], total: 0 },
    'staff/reports': { attendance_summary: [], month_label: '', total: 0 },
    'subscription/plans': { plans: [], subscription: {} },
    'subscription/payment-session': { plan: {}, order: {} },
  };
  if (emptyByPath[path]) {
    return { success: true, ...emptyByPath[path] };
  }

  const key = path.split('/')[0] || 'items';
  const moduleKeys: Record<string, string> = {
    enquiries: 'enquiries',
    students: 'students',
    batches: 'batches',
    courses: 'courses',
    schemes: 'schemes',
    staff: 'staff',
    reports: 'reports',
    subscription: 'plans',
    notifications: 'notifications',
    settings: 'settings',
  };
  const moduleKey = moduleKeys[key] || key;
  return {
    success: true,
    data: {
      items: [],
      [moduleKey]: [],
    },
    items: [],
    [moduleKey]: [],
  };
}

const desktopApiInflight = new Map<string, Promise<unknown>>();
const DESKTOP_API_TIMEOUT_MS = 12000;
const SECURE_TOKEN_TIMEOUT_MS = 3000;
const TEMPLATE_LOADING_TIMEOUT_MS = 15000;

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function getSecureAuthTokenWithTimeout() {
  const tokenPromise = window.electronAPI?.getSecureAuthToken?.();
  if (!tokenPromise) return undefined;
  let timeoutId: number | undefined;
  const timeoutPromise = new Promise<undefined>((resolve) => {
    timeoutId = window.setTimeout(() => resolve(undefined), SECURE_TOKEN_TIMEOUT_MS);
  });
  try {
    return await Promise.race([tokenPromise, timeoutPromise]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

async function handleDesktopUnauthorized(endpoint?: string) {
  if (endpoint && !endpoint.includes('/auth/me')) return;
  if (!markAuthExpiredHandled()) return;
  stopNotificationPoller();
  await clearAuthTokens();
  window.dispatchEvent(new CustomEvent('lerzo-auth-changed'));
}

async function handleDesktopSubscriptionExpired(payload?: { message?: string; error?: string }) {
  throw await handleSubscriptionExpired(payload?.message || payload?.error || 'Trial expired or subscription inactive.');
}

interface DesktopApiOptions {
  silent?: boolean;
}

async function desktopApiGet<T>(endpoint: string, options: DesktopApiOptions = {}): Promise<T> {
  const cacheKey = `GET:${endpoint}`;
  const inflight = desktopApiInflight.get(cacheKey);
  if (inflight) return inflight as Promise<T>;

  const task = (async () => {
    if (!options.silent) beginRequestLoading();
    try {
      const token = await getSecureAuthTokenWithTimeout();
      const separator = endpoint.includes('?') ? '&' : '?';
      const url = `${getDesktopApiBaseUrl()}${endpoint}${separator}_=${Date.now()}`;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), DESKTOP_API_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          cache: 'no-store',
          credentials: 'include',
          signal: controller.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
      } catch (error) {
        if (isAbortError(error)) {
          console.warn(`[Electron API] GET timed out: ${endpoint}`);
          return emptyPayloadForEndpoint(endpoint) as T;
        }
        throw error;
      } finally {
        window.clearTimeout(timeout);
      }

      if (response.status === 404) {
        return emptyPayloadForEndpoint(endpoint) as T;
      }
      const payload = await parseJsonResponse<T & { success?: boolean; error?: string; message?: string }>(response);
      if (!response.ok || payload?.success === false) {
        if (isSubscriptionExpiredPayload(response.status, payload)) {
          await handleDesktopSubscriptionExpired(payload);
        }
        if (response.status === 401) {
          await handleDesktopUnauthorized(endpoint);
        }
        const apiError = new Error(payload?.error || payload?.message || `Request failed with ${response.status}`) as Error & { status?: number };
        apiError.status = response.status;
        throw apiError;
      }
      return payload as T;
    } finally {
      if (!options.silent) endRequestLoading();
    }
  })();

  desktopApiInflight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    desktopApiInflight.delete(cacheKey);
  }
}

async function desktopApiRequest<T>(
  endpoint: string,
  method: string,
  body?: Record<string, unknown>,
  options: DesktopApiOptions = {},
): Promise<T> {
  if (!options.silent) beginRequestLoading();
  try {
    const token = await getSecureAuthTokenWithTimeout();
    const url = `${getDesktopApiBaseUrl()}${endpoint}`;
    const response = await fetch(url, {
      method,
      cache: 'no-store',
      credentials: 'include',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await parseJsonResponse<T & { success?: boolean; error?: string; message?: string }>(response);
    if (!response.ok || payload?.success === false) {
      if (isSubscriptionExpiredPayload(response.status, payload)) {
        await handleDesktopSubscriptionExpired(payload);
      }
      if (response.status === 401) {
        await handleDesktopUnauthorized(endpoint);
      }
      const apiError = new Error(payload?.error || payload?.message || `Request failed with ${response.status}`) as Error & { status?: number };
      apiError.status = response.status;
      throw apiError;
    }
    desktopApiInflight.forEach((_, key) => {
      if (key.startsWith('GET:')) desktopApiInflight.delete(key);
    });
    return payload as T;
  } catch (error) {
    if (error instanceof SubscriptionExpiredError) {
      throw error;
    }
    throw error instanceof Error ? error : new Error(extractApiErrorMessage(error));
  } finally {
    if (!options.silent) endRequestLoading();
  }
}

async function desktopApiDownload(endpoint: string, fallbackName: string) {
  const token = await getSecureAuthTokenWithTimeout();
  const url = `${getDesktopApiBaseUrl()}${endpoint}`;
  const response = await fetch(url, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Download failed with ${response.status}`);
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallbackName;
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function downloadTextFile(filename: string, content: string, type = 'text/csv;charset=utf-8') {
  const objectUrl = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

function csvEscape(value: unknown) {
  const text = valueText(value) === '-' ? '' : valueText(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function recordsToCsv(records: Record<string, unknown>[], fields: string[]) {
  return [
    fields.join(','),
    ...records.map((record) => fields.map((field) => csvEscape(record[field])).join(',')),
  ].join('\n');
}

function parseCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const split = (line: string) => {
    const values: string[] = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && quoted && next === '"') {
        current += '"';
        index += 1;
        continue;
      }
      if (char === '"') {
        quoted = !quoted;
        continue;
      }
      if (char === ',' && !quoted) {
        values.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    values.push(current.trim());
    return values;
  };
  const headers = split(lines[0]);
  return lines.slice(1).map((line) => {
    const values = split(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

function formatCurrency(value: unknown) {
  const amount = Number(value || 0);
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function setText(element: Element | null | undefined, text: unknown) {
  if (element) element.textContent = valueText(text);
}

function setCount(element: Element | null | undefined, value: unknown, formatter: (value: unknown) => string = valueText) {
  if (!element) return;
  const text = formatter(value);
  element.textContent = text;
  element.setAttribute('data-target', text.replace(/[^\d.]/g, '') || '0');
}

function emptyRow(colspan: number, message: string, addRoute = '#', addLabel = 'Add New') {
  return `<tr><td colspan="${colspan}" style="text-align:center; padding:32px; color:var(--text-muted);">
    <div style="display:flex;flex-direction:column;align-items:center;gap:12px;">
      <span>${message}</span>
      <a href="${addRoute}" class="btn btn-secondary" style="display:inline-flex;">${addLabel}</a>
    </div>
  </td></tr>`;
}

function tbody(root: HTMLElement) {
  return root.querySelector<HTMLTableSectionElement>('table tbody');
}

function removeGeneratedEmptyBlocks(root: HTMLElement) {
  const emptyPhrases = [
    'No enquiries',
    'No students',
    'No records',
    'No batches',
    'No courses',
    'No schemes',
    'No staff',
    'No plans',
  ];

  root.querySelectorAll<HTMLElement>('div').forEach((node) => {
    const text = node.textContent?.replace(/\s+/g, ' ').trim() || '';
    if (!emptyPhrases.some((phrase) => text.includes(phrase))) return;
    if (node.querySelector('table, form, #plans-grid, #overview-grid, .card, .grid')) return;
    const directChildren = Array.from(node.children);
    const looksLikeEmptyState = node.style.textAlign === 'center' && directChildren.length <= 3;
    if (looksLikeEmptyState) node.remove();
  });
}

function updateFirstLabel(root: HTMLElement, startsWith: string, text: string) {
  const node = Array.from(root.querySelectorAll<HTMLElement>('.label-meta, p, span'))
    .find((item) => item.textContent?.trim().startsWith(startsWith));
  if (node) node.textContent = text;
}

function scrubGeneratedSampleText(root: HTMLElement) {
  if (root.dataset.hydrated === 'true') return;

  const legacyAmountPattern = new RegExp([
    String.fromCharCode(0x20b9),
    ['24', '500'].join(','),
    '(?:\\.00)?',
  ].join(''), 'g');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach((node) => {
    const parent = node.parentElement;
    if (parent?.closest('[data-live-content="true"]')) return;
    node.textContent = (node.textContent || '')
      .replace(/Demo Admin/g, 'Account')
      .replace(/Sample Plan/g, '')
      .replace(/Sample Name/g, '')
      .replace(/Sample Days/g, '')
      .replace(/Sample records/gi, '0 records')
      .replace(/per Sample days/gi, 'per selected days')
      .replace(/\b124\b/g, '0')
      .replace(/\b98\b/g, '0')
      .replace(/\b9876543210\b/g, '')
      .replace(legacyAmountPattern, '₹0')
      .replace(/Total Records:\s*124/g, 'Total Records: 0');
  });
}

function showPageError(root: HTMLElement, message: string, retry: () => void) {
  root.querySelector('[data-page-error="true"]')?.remove();
  if (message.toLowerCase().includes('body stream already read')) {
    return;
  }
  if (isServerUnavailableMessage(message)) {
    openServerDownPage(window.location.hash.replace(/^#/, '') || '/dashboard');
    return;
  }
  scrubGeneratedSampleText(root);
  void retry;
}

function clearPageError(root: HTMLElement) {
  root.querySelector('[data-page-error="true"]')?.remove();
}

function showActionToast(_root: HTMLElement, message: string, type: 'success' | 'error' = 'success') {
  showAppToast(message, type);
}

function promptRequiredText(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  placeholder?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector('[data-prompt-modal="true"]');
    existing?.remove();

    const overlay = document.createElement('div');
    overlay.dataset.promptModal = 'true';
    overlay.className = 'qr-location-modal';
    overlay.innerHTML = `
      <div class="qr-location-panel" style="text-align:left;">
        <h3 class="card-title" style="margin-bottom:8px;">${options.title}</h3>
        <p class="label-meta" style="margin-bottom:16px;">${options.message}</p>
        <textarea data-prompt-input="true" rows="4" placeholder="${options.placeholder || ''}" style="width:100%;border:1.5px solid var(--border);border-radius:12px;padding:12px;font-size:14px;resize:vertical;"></textarea>
        <p data-prompt-error="true" class="label-meta" style="color:var(--danger);display:none;margin-top:8px;">Please enter a reason before continuing.</p>
        <div style="display:flex;gap:12px;margin-top:18px;">
          <button type="button" class="btn btn-secondary" data-prompt-cancel="true" style="flex:1;">${options.cancelLabel || 'Cancel'}</button>
          <button type="button" class="btn btn-primary" data-prompt-confirm="true" style="flex:1;">${options.confirmLabel || 'Confirm'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector<HTMLTextAreaElement>('[data-prompt-input="true"]');
    const error = overlay.querySelector<HTMLElement>('[data-prompt-error="true"]');

    const cleanup = (value: string | null) => {
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector('[data-prompt-cancel="true"]')?.addEventListener('click', () => cleanup(null));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) cleanup(null);
    });
    overlay.querySelector('[data-prompt-confirm="true"]')?.addEventListener('click', () => {
      const value = (input?.value || '').trim();
      if (!value) {
        if (error) error.style.display = 'block';
        input?.focus();
        return;
      }
      cleanup(value);
    });

    window.setTimeout(() => input?.focus(), 0);
  });
}

function invalidateDesktopApiCache(scopes?: RefreshScope[]) {
  if (!scopes?.length) {
    desktopApiInflight.clear();
    return;
  }
  desktopApiInflight.forEach((_, key) => {
    if (!key.startsWith('GET:')) return;
    const endpoint = key.slice(4);
    if (scopes.some((scope) => endpointMatchesScope(endpoint, scope))) {
      desktopApiInflight.delete(key);
    }
  });
}

function playNotificationSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const audio = new AudioContextClass();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.value = 0.05;
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.16);
  } catch (error) {
    console.warn('[Lerzo UI] Notification sound unavailable', error);
  }
}

function installNotificationPoller() {
  // Notification polling is managed globally from AuthContext after login.
}

function applyStoredTheme() {
  applyTheme();
}

async function startSubscriptionPayment(root: HTMLElement, planId: string, button: HTMLButtonElement) {
  if (button.classList.contains('cursor-not-allowed')) {
    showActionToast(root, 'You have already used the free trial. Please choose a premium plan.', 'error');
    return;
  }
  const originalHtml = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span class="template-spinner"></span><span>Processing...</span>';
  root.querySelectorAll('[data-plan-id]').forEach((node) => node.closest('.card')?.classList.remove('selected-plan'));
  button.closest('.card')?.classList.add('selected-plan');
  try {
    window.location.hash = `#/subscription-payment?plan_id=${encodeURIComponent(planId)}`;
  } catch (error) {
    showActionToast(root, error instanceof Error ? error.message : 'Could not start payment. Please try again.', 'error');
    button.disabled = false;
    button.innerHTML = originalHtml;
    root.querySelectorAll('#plans-grid .card').forEach((card) => card.classList.remove('selected-plan'));
  }
}

async function handleReportAction(root: HTMLElement, label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes('import')) {
    window.location.hash = '/exports-options';
    return true;
  }
  if (normalized.includes('export')) {
    let type = 'students';
    if (normalized.includes('enquir')) type = 'enquiries';
    if (normalized.includes('financial') || normalized.includes('fee')) type = 'fees';
    if (normalized.includes('batch')) type = 'batches';
    if (normalized.includes('course')) type = 'courses';
    if (normalized.includes('staff')) type = 'staff';
    const format = normalized.includes('pdf') ? 'pdf' : 'excel';
    await downloadReportDataset(root, type, format);
    return true;
  }
  return false;
}

const exportFieldMap: Record<string, string[]> = {
  students: ['enrollment_number', 'name', 'mobile1', 'course', 'batch', 'net_fees', 'balance'],
  enquiries: ['name', 'mobile1', 'course_interested', 'qualification', 'created_at'],
  courses: ['name', 'description', 'duration_months', 'fees', 'is_active'],
  batches: ['name', 'start_time', 'end_time', 'is_active'],
  schemes: ['name', 'description', 'discount_percentage', 'is_active'],
  staff: ['name', 'email', 'phone', 'role', 'week_off_days', 'is_active'],
  fees: ['total_collected', 'pending_fees', 'monthly_revenue', 'collection_rate'],
};

const importTemplateMap: Record<string, string> = {
  students: 'enrollment_number,name,father_name,sex,age,date_of_birth,date_of_joining,mobile1,mobile2,address_line1,address_line2,city,pincode,qualification,course,scheme,batch,total_fees,concession,bill_number\n',
  enquiries: 'name,father_name,sex,mobile1,mobile2,address,pincode,employment_status,qualification,course,scheme,reason_for_interest,joining_plan,source_of_information\n',
  courses: 'name,description,duration_months,fees\n',
  batches: 'name,start_time,end_time,is_active\n',
  schemes: 'name,description,discount_percentage,is_active\n',
  staff: 'name,email,phone,role,password,is_active,week_off_days\n',
};

type ImportReferenceContext = {
  courses: Record<string, unknown>[];
  schemes: Record<string, unknown>[];
  batches: Record<string, unknown>[];
  createdCourseIds: Map<string, number>;
};

async function downloadReportDataset(root: HTMLElement, type: string, format = 'excel') {
  if ((type === 'students' || type === 'enquiries') && (format === 'excel' || format === 'pdf')) {
    await desktopApiDownload(`/exports/${format}?export_type=${type}`, `${type}_export.${format === 'pdf' ? 'pdf' : 'xlsx'}`);
    showActionToast(root, 'Export downloaded.');
    return;
  }

  if (format === 'pdf') {
    showActionToast(root, `${type} PDF export is not available in the desktop API yet. Downloading CSV instead.`, 'error');
  }

  const endpointByType: Record<string, string> = {
    courses: '/courses',
    batches: '/batches',
    schemes: '/schemes',
    staff: '/staff',
    fees: '/reports/fees',
  };
  const endpoint = endpointByType[type];
  if (!endpoint) {
    showActionToast(root, 'This export type is not available.', 'error');
    return;
  }
  const payload = await desktopApiGet(endpoint);
  const rows = type === 'fees' ? [findRecord(payload, ['fees', 'summary', 'report'])] : findArray(payload, [type, 'items']);
  downloadTextFile(`${type}_export.csv`, recordsToCsv(rows, exportFieldMap[type] || Object.keys(rows[0] || {})));
  showActionToast(root, 'Export downloaded.');
}

async function exportSelectedData(root: HTMLElement) {
  const type = root.querySelector<HTMLInputElement>('#exportType')?.value || 'students';
  const format = root.querySelector<HTMLInputElement>('#exportFormat')?.value || 'excel';
  if ((type === 'students' || type === 'enquiries') && (format === 'excel' || format === 'pdf')) {
    const params = new URLSearchParams({ export_type: type });
    root.querySelectorAll<HTMLInputElement>(`input[name="${type === 'students' ? 'student_fields' : 'enquiry_fields'}"]:checked`).forEach((field) => params.append('fields', field.value));
    const status = root.querySelector<HTMLInputElement>(`input[name="${type === 'students' ? 'fee_status' : 'enquiry_status'}"]:checked`)?.value;
    if (status) params.set(type === 'students' ? 'fee_status' : 'status', status);
    await desktopApiDownload(`/exports/${format}?${params.toString()}`, `${type}_export.${format === 'pdf' ? 'pdf' : 'xlsx'}`);
    showActionToast(root, 'Export downloaded.');
    return;
  }

  await downloadReportDataset(root, type, format);
}

async function downloadSelectedTemplate(root: HTMLElement) {
  const type = root.querySelector<HTMLInputElement>('#importType')?.value || 'students';
  const template = importTemplateMap[type];
  if (!template) {
    showActionToast(root, 'Template is not available for this category.', 'error');
    return;
  }
  downloadTextFile(`${type}_import_template.csv`, template);
  showActionToast(root, 'Template downloaded.');
}

function lookupKey(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function isNumericId(value: unknown) {
  const text = String(value || '').trim();
  return /^\d+$/.test(text);
}

function findReferenceId(items: Record<string, unknown>[], value: unknown, aliases: string[] = []) {
  const key = lookupKey(value);
  if (!key) return null;
  if (isNumericId(key)) return Number(key);

  const match = items.find((item) => {
    const candidates = [
      item.id,
      item.name,
      item.course_name,
      item.batch_name,
      item.scheme_name,
      item.code,
      item.short_name,
      ...aliases.map((alias) => item[alias]),
    ];
    return candidates.some((candidate) => lookupKey(candidate) === key);
  });
  return match?.id ? Number(match.id) : null;
}

async function loadImportReferences(type: string): Promise<ImportReferenceContext> {
  if (!['students', 'enquiries'].includes(type)) {
    return { courses: [], schemes: [], batches: [], createdCourseIds: new Map() };
  }

  const [coursesPayload, schemesPayload, batchesPayload] = await Promise.all([
    desktopApiGet('/courses'),
    desktopApiGet('/schemes'),
    desktopApiGet('/batches'),
  ]);

  return {
    courses: findArray(coursesPayload, ['courses']),
    schemes: findArray(schemesPayload, ['schemes']),
    batches: findArray(batchesPayload, ['batches']),
    createdCourseIds: new Map(),
  };
}

async function resolveCourseId(value: unknown, refs: ImportReferenceContext, fees?: unknown) {
  const key = lookupKey(value);
  if (!key) return null;
  if (isNumericId(value)) return Number(value);

  const existingId = findReferenceId(refs.courses, value);
  if (existingId) return existingId;

  const createdId = refs.createdCourseIds.get(key);
  if (createdId) return createdId;

  const payload = await desktopApiRequest('/courses', 'POST', {
    name: String(value).trim(),
    fees: Number(fees || 0),
    duration_months: 0,
    is_active: true,
  });
  const course = findRecord(payload, ['course']);
  const id = Number(course.id);
  if (Number.isFinite(id)) {
    refs.createdCourseIds.set(key, id);
    refs.courses.push(course);
    return id;
  }
  return null;
}

async function resolveImportReferences(type: string, row: Record<string, unknown>, refs: ImportReferenceContext) {
  const next = { ...row };

  if (type === 'students') {
    const courseValue = next.course_id || next.course || next.course_name || next['course name'];
    const courseId = await resolveCourseId(courseValue, refs, next.total_fees || next.fees);
    if (courseId) {
      next.course_id = courseId;
    }

    const schemeValue = next.scheme_id || next.scheme || next.scheme_name || next['scheme name'];
    next.scheme_id = findReferenceId(refs.schemes, schemeValue);

    const batchValue = next.batch_id || next.batch || next.batch_name || next['batch name'];
    next.batch_id = findReferenceId(refs.batches, batchValue);
  }

  if (type === 'enquiries') {
    const courseValue = next.course_interested_id || next.course || next.course_name || next['course interest'] || next['course name'];
    next.course_interested_id = await resolveCourseId(courseValue, refs);

    const schemeValue = next.scheme_id || next.scheme || next.scheme_name || next['scheme name'];
    next.scheme_id = findReferenceId(refs.schemes, schemeValue);
  }

  return next;
}

async function importSelectedData(root: HTMLElement) {
  const type = root.querySelector<HTMLInputElement>('#importType')?.value || 'students';
  const file = root.querySelector<HTMLInputElement>('#fileInput')?.files?.[0];
  if (!file) {
    showActionToast(root, 'Choose a CSV file before importing.', 'error');
    return;
  }
  if (!file.name.toLowerCase().endsWith('.csv')) {
    showActionToast(root, 'Desktop import currently supports CSV templates only.', 'error');
    return;
  }
  const importMap: Record<string, { endpoint: string; module: string }> = {
    students: { endpoint: '/students', module: 'student' },
    enquiries: { endpoint: '/enquiries', module: 'enquiry' },
    courses: { endpoint: '/courses', module: 'course' },
    batches: { endpoint: '/batches', module: 'batch' },
    schemes: { endpoint: '/schemes', module: 'scheme' },
    staff: { endpoint: '/staff', module: 'staff' },
  };
  const config = importMap[type];
  if (!config) {
    showActionToast(root, 'Desktop import API is not available for this category.', 'error');
    return;
  }
  const rows = parseCsv(await file.text());
  if (!rows.length) {
    showActionToast(root, 'No records found in the selected file.', 'error');
    return;
  }
  const refs = await loadImportReferences(type);
  let success = 0;
  const errors: string[] = [];
  for (const [index, row] of rows.entries()) {
    try {
      const resolvedRow = await resolveImportReferences(type, row, refs);
      await desktopApiRequest(config.endpoint, 'POST', normalizeActionBody(config.module, resolvedRow));
      success += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Import failed.';
      errors.push(`Row ${index + 2}: ${message}`);
    }
  }

  if (!success) {
    showActionToast(root, errors[0] || 'No records were imported.', 'error');
    return;
  }

  if (errors.length) {
    showActionToast(root, `Imported ${success}; ${errors.length} rows failed. ${errors[0]}`, 'error');
    await refreshAfterMutation(config.module, 'exports/options.html');
    return;
  }
  showActionToast(root, `Imported ${success} ${type} records successfully.`);
  await refreshAfterMutation(config.module, 'exports/options.html');
}

function formToJson(form: HTMLFormElement) {
  const data: Record<string, unknown> = {};
  const formData = new FormData(form);
  formData.forEach((value, key) => {
    if (key === 'csrf_token') return;
    if (data[key] !== undefined) {
      data[key] = Array.isArray(data[key]) ? [...data[key] as unknown[], value] : [data[key], value];
      return;
    }
    data[key] = value;
  });

  form.querySelectorAll<HTMLInputElement>('input[type="checkbox"][name]').forEach((checkbox) => {
    if (!checkbox.checked && data[checkbox.name] === undefined) data[checkbox.name] = false;
    if (checkbox.checked && checkbox.value === 'on') data[checkbox.name] = true;
  });

  return data;
}

function formatPlanBillingPeriod(plan: Record<string, unknown>) {
  const days = Number(plan.duration_days || 0);
  if (days > 0) return `${days} days`;
  const planName = valueText(plan.name).toLowerCase();
  if (planName.includes('month')) return '30 days';
  if (planName.includes('year') || planName.includes('annual')) return '365 days';
  return 'billing cycle';
}

const DEFAULT_PLAN_FEATURES = [
  'Unlimited Students',
  'Batch Management',
  'PDF & Excel Exports',
  'Priority Support',
  'Cloud Backup',
];

function resolvePlanFeatureItems(plan: Record<string, unknown>) {
  const rawFeatures = Array.isArray(plan.features)
    ? plan.features.map((feature) => valueText(feature)).filter((feature) => feature && feature !== '-')
    : typeof plan.features === 'string' && plan.features.trim()
      ? plan.features.split(/[\n,|]+/).map((feature) => feature.trim()).filter(Boolean)
      : [];
  return rawFeatures.length ? rawFeatures : DEFAULT_PLAN_FEATURES;
}

function validateActionBody(module: string, body: Record<string, unknown>) {
  if (module === 'student') {
    if (!body.name) return 'Student name is required.';
    if (!body.mobile1) return 'Mobile number is required.';
    if (!body.course_id) return 'Please select a course.';
  }
  if (module === 'enquiry') {
    if (!body.name) return 'Enquiry name is required.';
    if (!body.mobile1) return 'Mobile number is required.';
  }
  if (module === 'batch') {
    if (!body.name) return 'Please select a batch slot.';
    if (!body.start_time || !body.end_time) return 'Batch start and end times are required.';
  }
  if (module === 'course') {
    if (!body.name) return 'Course name is required.';
    if (body.fees === null || body.fees === undefined || Number.isNaN(Number(body.fees))) {
      return 'Course fee is required.';
    }
  }
  return null;
}

function normalizeActionBody(module: string, body: Record<string, unknown>) {
  const next = { ...body };
  if (module === 'batch' && next.batch_template) {
    const [name, start, end] = String(next.batch_template).split('|');
    next.name = name || next.name;
    next.start_time = start || next.start_time;
    next.end_time = end || next.end_time;
  }
  delete next.batch_template;
  if (module === 'course') {
    delete next.start_date;
    delete next.end_date;
  }
  if (module === 'staff') {
    const weekOff = next.week_off_days;
    next.week_off_days = Array.isArray(weekOff) ? weekOff.join(',') : (weekOff || '');
    const batches = next.batches;
    next.batch_ids = (Array.isArray(batches) ? batches : batches ? [batches] : []).map((value) => Number(value)).filter(Number.isFinite);
    delete next.batches;
    if (next.is_active === undefined || next.is_active === null) next.is_active = false;
  }
  Object.entries(next).forEach(([key, value]) => {
    if (value === '') next[key] = null;
    if (['is_active', 'allow_check_in', 'allow_check_out', 'require_selfie', 'require_gps_validation', 'allow_corrections'].includes(key)) {
      if (typeof value === 'string') next[key] = !['false', '0', 'no', 'off'].includes(value.toLowerCase());
    }
    if (['fees', 'total_fees', 'concession', 'discount_percentage', 'duration_months', 'age', 'amount', 'initial_payment_amount'].includes(key)) {
      next[key] = Number(value || 0);
    }
    if (['course_id', 'scheme_id', 'batch_id', 'course_interested_id', 'enquiry_id'].includes(key)) {
      next[key] = value ? Number(value) : null;
    }
  });
  return next;
}

function actionButtons(module: string, id: unknown, row?: Record<string, unknown>) {
  const safeId = valueText(id);
  if (!safeId || safeId === '-') {
    return '<button type="button" class="btn-icon" title="Action unavailable" disabled style="opacity:0.5;">-</button>';
  }
  const deleteButton = `<button type="button" class="btn-icon" title="Delete" data-crud-action="delete" data-module="${module}" data-id="${safeId}" style="color:var(--danger);">
        <i data-lucide="trash-2"></i>
      </button>`;
  const whatsappButton = module === 'student'
    ? `<button type="button" class="btn-icon" title="Send WhatsApp fee reminder" data-crud-action="whatsapp-fee" data-module="student" data-id="${safeId}" style="color:#16A34A;">
        <i data-lucide="message-circle"></i>
      </button>`
    : '';
  const convertButton = module === 'enquiry' && String(row?.status || 'active').toLowerCase() === 'active'
    ? `<button type="button" class="btn-icon" title="Add as Student" data-crud-action="convert-enquiry" data-module="enquiry" data-id="${safeId}" style="color:var(--success);">
        <i data-lucide="user-check"></i>
      </button>`
    : '';
  const viewButton = module === 'student'
    ? `<button type="button" class="btn-icon" title="View Details" data-crud-action="view" data-module="student" data-id="${safeId}">
        <i data-lucide="eye"></i>
      </button>`
    : '';
  const payButton = module === 'student' && Number(row?.balance || 0) > 0
    ? `<button type="button" class="btn-icon" title="Pay Fees" data-crud-action="pay-fees" data-module="student" data-id="${safeId}" style="color:var(--success);">
        <i data-lucide="credit-card"></i>
      </button>`
    : '';
  return `
    <div class="flex justify-end gap-8">
      ${viewButton}
      ${payButton}
      ${convertButton}
      <button type="button" class="btn-icon" title="Edit" data-crud-action="edit" data-module="${module}" data-id="${safeId}">
        <i data-lucide="edit-2"></i>
      </button>
      ${whatsappButton}
      ${deleteButton}
    </div>
  `;
}

const templateActionMap: Record<string, { module: string; endpoint: string; listRoute: string; addRoute?: string; label: string }> = {
  'enquiries/list.html': { module: 'enquiry', endpoint: '/enquiries', listRoute: '#/enquiries-list', addRoute: '#/enquiries-add', label: 'Enquiry' },
  'enquiries/add.html': { module: 'enquiry', endpoint: '/enquiries', listRoute: '#/enquiries-list', label: 'Enquiry' },
  'enquiries/edit.html': { module: 'enquiry', endpoint: '/enquiries', listRoute: '#/enquiries-list', label: 'Enquiry' },
  'students/list.html': { module: 'student', endpoint: '/students', listRoute: '#/students-list', addRoute: '#/students-add', label: 'Student' },
  'students/add.html': { module: 'student', endpoint: '/students', listRoute: '#/students-list', label: 'Student' },
  'students/edit.html': { module: 'student', endpoint: '/students', listRoute: '#/students-list', label: 'Student' },
  'students/view.html': { module: 'student', endpoint: '/students', listRoute: '#/students-list', label: 'Student' },
  'fees/payment.html': { module: 'student', endpoint: '/students', listRoute: '#/students-list', label: 'Payment' },
  'batches/list.html': { module: 'batch', endpoint: '/batches', listRoute: '#/batches-list', addRoute: '#/batches-add', label: 'Batch' },
  'batches/add.html': { module: 'batch', endpoint: '/batches', listRoute: '#/batches-list', label: 'Batch' },
  'batches/edit.html': { module: 'batch', endpoint: '/batches', listRoute: '#/batches-list', label: 'Batch' },
  'schemes/list.html': { module: 'scheme', endpoint: '/schemes', listRoute: '#/schemes-list', addRoute: '#/schemes-add', label: 'Scheme' },
  'schemes/add.html': { module: 'scheme', endpoint: '/schemes', listRoute: '#/schemes-list', label: 'Scheme' },
  'schemes/edit.html': { module: 'scheme', endpoint: '/schemes', listRoute: '#/schemes-list', label: 'Scheme' },
  'courses/list.html': { module: 'course', endpoint: '/courses', listRoute: '#/courses-list', addRoute: '#/courses-add', label: 'Course' },
  'courses/add.html': { module: 'course', endpoint: '/courses', listRoute: '#/courses-list', label: 'Course' },
  'courses/edit.html': { module: 'course', endpoint: '/courses', listRoute: '#/courses-list', label: 'Course' },
  'staff/list.html': { module: 'staff', endpoint: '/staff', listRoute: '#/staff-list', addRoute: '#/staff-add', label: 'Staff' },
  'staff/add.html': { module: 'staff', endpoint: '/staff', listRoute: '#/staff-list', label: 'Staff' },
  'staff/edit.html': { module: 'staff', endpoint: '/staff', listRoute: '#/staff-list', label: 'Staff' },
  'staff/dashboard.html': { module: 'staff', endpoint: '/staff', listRoute: '#/staff-list', label: 'Staff' },
  'staff/attendance_list.html': { module: 'staff', endpoint: '/staff', listRoute: '#/staff-list', label: 'Staff' },
  'staff/leave_requests.html': { module: 'staff', endpoint: '/staff/leave-requests', listRoute: '#/staff-list', label: 'Staff' },
  'staff/corrections.html': { module: 'staff', endpoint: '/staff/corrections', listRoute: '#/staff-list', label: 'Staff' },
  'staff/reports.html': { module: 'staff', endpoint: '/staff/reports', listRoute: '#/staff-list', label: 'Staff' },
  'reports/index.html': { module: 'report', endpoint: '/reports', listRoute: '#/reports', label: 'Report' },
  'reports/students.html': { module: 'report', endpoint: '/reports/students', listRoute: '#/reports', label: 'Report' },
  'reports/fees.html': { module: 'report', endpoint: '/reports/fees', listRoute: '#/reports', label: 'Report' },
  'reports/batches.html': { module: 'report', endpoint: '/reports/batches', listRoute: '#/reports', label: 'Report' },
  'reports/enquiries.html': { module: 'report', endpoint: '/reports/enquiries', listRoute: '#/reports', label: 'Report' },
  'settings/attendance.html': { module: 'settings', endpoint: '/settings/attendance', listRoute: '#/settings-profile', label: 'Settings' },
  'settings/profile.html': { module: 'settings', endpoint: '/settings/profile', listRoute: '#/settings-profile', label: 'Settings' },
  'exports/options.html': { module: 'export', endpoint: '/exports', listRoute: '#/reports', label: 'Export' },
};

const moduleEndpointMap: Record<string, string> = {
  enquiry: '/enquiries',
  student: '/students',
  batch: '/batches',
  scheme: '/schemes',
  course: '/courses',
  staff: '/staff',
};

const batchTemplates = [
  ['Morning Batch', '06:00', '08:00'],
  ['Morning Batch', '08:00', '10:00'],
  ['Morning Batch', '10:00', '12:00'],
  ['Afternoon Batch', '12:00', '14:00'],
  ['Afternoon Batch', '14:00', '16:00'],
  ['Evening Batch', '16:00', '18:00'],
  ['Night Batch', '18:00', '20:00'],
  ['Night Batch', '20:00', '22:00'],
];

const courseDurations = [1, 2, 3, 4, 6, 12];
const weekDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const staffRoles = ['Teacher', 'Admin'];

function rowCache() {
  const win = window as typeof window & { __lerzoRows?: Record<string, Record<string, unknown>[]> };
  if (!win.__lerzoRows) win.__lerzoRows = {};
  return win.__lerzoRows;
}

function cacheRows(module: string, rows: Record<string, unknown>[]) {
  rowCache()[module] = rows;
}

function formValue(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return value == null ? '' : String(value).replace(/"/g, '&quot;');
}

function inputField(row: Record<string, unknown>, key: string, label: string, attrs = '') {
  return `<div class="form-group"><label class="label">${label}</label><input class="input" name="${key}" value="${formValue(row, key)}" ${attrs} /></div>`;
}

function textareaField(row: Record<string, unknown>, key: string, label: string, attrs = '') {
  return `<div class="form-group"><label class="label">${label}</label><textarea class="input" name="${key}" ${attrs}>${formValue(row, key)}</textarea></div>`;
}

function selectField(name: string, label: string, options: string) {
  return `<div class="form-group"><label class="label">${label}</label><select class="input" name="${name}">${options}</select></div>`;
}

function sexOptions(selected?: unknown) {
  return ['Male', 'Female', 'Other'].map((value) => `<option value="${value}" ${String(selected || '') === value ? 'selected' : ''}>${value}</option>`).join('');
}

function staffRoleOptions(selected?: unknown) {
  return staffRoles.map((value) => `<option value="${value}" ${String(selected || '') === value || String(selected || '').toLowerCase() === value.toLowerCase() ? 'selected' : ''}>${value}</option>`).join('');
}

function selectedList(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function weekOffCards(selected: string[] = []) {
  return weekDays.map((day) => `
    <label class="card" style="display:flex;align-items:center;gap:12px;padding:16px;margin:0;cursor:pointer;transition:all 0.2s;border:1px solid var(--border);">
      <input type="checkbox" name="week_off_days" value="${day}" ${selected.includes(day) ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent);">
      <span style="font-weight:600;color:var(--text-primary);font-size:13px;">${day}</span>
    </label>
  `).join('');
}

function batchCards(batches: Record<string, unknown>[], selected: string[] = []) {
  return batches.length ? `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;">
      ${batches.map((batch) => {
        const id = valueText(batch.id);
        return `
          <label class="card" style="display:flex;align-items:center;gap:12px;padding:16px;margin:0;cursor:pointer;transition:all 0.2s;border:1px solid var(--border);">
            <input type="checkbox" name="batches" value="${id}" ${selected.includes(id) ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent);">
            <div>
              <div style="font-weight:600;color:var(--text-primary);font-size:13px;">${valueText(batch.name)}</div>
              ${(batch.timing || batch.start_time || batch.end_time) ? `<div class="label-meta">${formatBatchScheduleTiming(batch.timing, batch.start_time, batch.end_time)}</div>` : ''}
            </div>
          </label>
        `;
      }).join('')}
    </div>
  ` : `
    <div style="background:var(--bg-secondary);border-radius:12px;padding:20px;text-align:center;">
      <p class="label-meta">No batches found for this center. Create a batch in Batches module first.</p>
    </div>
  `;
}

function staffFormHtml(row: Record<string, unknown>, batches: Record<string, unknown>[], submitLabel: string, passwordPlaceholder: string) {
  const assignedBatches = Array.isArray(row.batches) ? row.batches.map((batch) => String((batch as Record<string, unknown>).id)) : selectedList(row.batch_ids);
  return `
    <form method="post">
      <div style="margin-bottom:32px;">
        <div class="flex items-center gap-8" style="margin-bottom:24px;color:var(--accent);">
          <i data-lucide="user" style="width:18px;"></i>
          <h3 class="card-title" style="margin-bottom:0;">Profile Information</h3>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;">
          ${inputField(row, 'name', 'Name', 'placeholder="Full Name"')}
          ${inputField(row, 'email', 'Email', 'placeholder="email@example.com"')}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;">
          ${inputField(row, 'phone', 'Phone', 'placeholder="Phone Number (Optional)"')}
          ${selectField('role', 'Role', staffRoleOptions(row.role))}
        </div>
        <div style="display:grid;grid-template-columns:1fr;gap:24px;margin-bottom:24px;">
          ${inputField({}, 'password', 'Password', `type="password" placeholder="${passwordPlaceholder}"`)}
        </div>
        <div class="form-group flex items-center gap-8" style="margin-top:12px;">
          <input type="checkbox" name="is_active" id="is_active_checkbox" ${row.is_active === false ? '' : 'checked'} />
          <label for="is_active_checkbox" class="label" style="margin-bottom:0;cursor:pointer;user-select:none;">Account is Active</label>
        </div>
        <div style="margin-top:32px;">
          <div class="flex items-center gap-8" style="margin-bottom:12px;color:var(--accent);">
            <i data-lucide="calendar" style="width:18px;"></i>
            <h3 class="card-title" style="margin-bottom:0;">Week Off Days</h3>
          </div>
          <p class="label-meta" style="margin-bottom:20px;">Select week off days for this staff member. These days will be treated as non-working days on the attendance calendar.</p>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;">
            ${weekOffCards(selectedList(row.week_off_days))}
          </div>
        </div>
      </div>
      <div style="height:1px;background:var(--border);margin-bottom:32px;"></div>
      <div style="margin-bottom:40px;">
        <div class="flex items-center gap-8" style="margin-bottom:12px;color:var(--accent);">
          <i data-lucide="layers" style="width:18px;"></i>
          <h3 class="card-title" style="margin-bottom:0;">Assign Batches</h3>
        </div>
        <p class="label-meta" style="margin-bottom:20px;">Assign one or more batches to this staff member. They will be able to manage attendance for these batches.</p>
        ${batchCards(batches, assignedBatches)}
      </div>
      <div class="flex justify-end gap-16">
        <a href="#/staff-list" class="btn btn-secondary">Cancel</a>
        <button type="submit" class="btn btn-primary"><i data-lucide="save"></i><span>${submitLabel}</span></button>
      </div>
    </form>
  `;
}

async function openStructuredEditModal(root: HTMLElement, module: string, id: string, row: Record<string, unknown>, onSaved: () => void) {
  const endpoint = moduleEndpointMap[module];
  const fullPayload = module === 'student' ? await desktopApiGet(`/students/${id}`) : null;
  const fullRow = module === 'student' ? findRecord(fullPayload, ['student']) : row;
  const [coursesPayload, schemesPayload, batchesPayload] = await Promise.all([
    desktopApiGet('/courses'),
    desktopApiGet('/schemes'),
    module === 'student' ? desktopApiGet('/batches') : Promise.resolve({ batches: [] }),
  ]);

  root.querySelector('[data-crud-modal="true"]')?.remove();
  const modal = document.createElement('div');
  modal.dataset.crudModal = 'true';
  modal.className = 'crud-modal-overlay';

  const courseOptions = optionList(findArray(coursesPayload, ['courses']), module === 'student' ? fullRow.course_id : fullRow.course_interested_id);
  const schemeOptions = optionList(findArray(schemesPayload, ['schemes']), fullRow.scheme_id);
  const batchOptions = optionList(findArray(batchesPayload, ['batches']), fullRow.batch_id);
  const title = module === 'student' ? 'Edit Student' : 'Edit Enquiry';

  const enquiryForm = `
    <div style="margin-bottom:32px;">
      <div class="flex items-center gap-8" style="margin-bottom:24px;color:var(--accent);"><i data-lucide="user" style="width:18px;"></i><h3 class="card-title" style="margin-bottom:0;">Basic Information</h3></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;">
        ${inputField(fullRow, 'name', 'Name', 'placeholder="FULL NAME"')}
        ${inputField(fullRow, 'father_name', 'Father Name', 'placeholder="FATHER\'S NAME"')}
        ${selectField('sex', 'Sex', sexOptions(fullRow.sex))}
      </div>
    </div>
    <div style="height:1px;background:var(--border);margin-bottom:32px;"></div>
    <div style="margin-bottom:32px;">
      <div class="flex items-center gap-8" style="margin-bottom:24px;color:var(--accent);"><i data-lucide="phone" style="width:18px;"></i><h3 class="card-title" style="margin-bottom:0;">Contact Information</h3></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;">
        ${inputField(fullRow, 'mobile1', 'Mobile1', 'placeholder="Primary Mobile"')}
        ${inputField(fullRow, 'mobile2', 'Mobile2', 'placeholder="Alternative Mobile"')}
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:24px;">
        ${textareaField(fullRow, 'address', 'Address', 'placeholder="FULL ADDRESS" style="height:auto;padding:12px;"')}
        ${inputField(fullRow, 'pincode', 'Pincode', 'placeholder="PINCODE"')}
      </div>
    </div>
    <div style="height:1px;background:var(--border);margin-bottom:32px;"></div>
    <div style="margin-bottom:40px;">
      <div class="flex items-center gap-8" style="margin-bottom:24px;color:var(--accent);"><i data-lucide="graduation-cap" style="width:18px;"></i><h3 class="card-title" style="margin-bottom:0;">Academic & Interest</h3></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;">
        ${inputField(fullRow, 'employment_status', 'Employment Status', 'placeholder="e.g. STUDENT, WORKING"')}
        ${inputField(fullRow, 'qualification', 'Qualification', 'placeholder="e.g. B.TECH, 12TH"')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;">
        ${selectField('course_interested_id', 'Course Interested Id', `<option value="">Select course</option>${courseOptions}`)}
        ${selectField('scheme_id', 'Scheme Id', `<option value="">Select scheme</option>${schemeOptions}`)}
      </div>
      ${textareaField(fullRow, 'reason_for_interest', 'Reason For Interest', 'placeholder="Why are they interested?" style="height:auto;padding:12px;margin-bottom:24px;"')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        ${inputField(fullRow, 'joining_plan', 'Joining Plan', 'placeholder="e.g. IMMEDIATELY, NEXT WEEK"')}
        ${inputField(fullRow, 'source_of_information', 'Source Of Information', 'placeholder="e.g. GOOGLE AD, FRIEND"')}
      </div>
    </div>`;

  const studentForm = `
    <div style="margin-bottom:32px;">
      <div class="flex items-center gap-8" style="margin-bottom:24px;color:var(--accent);"><i data-lucide="user" style="width:18px;"></i><h3 class="card-title" style="margin-bottom:0;">Basic Information</h3></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-bottom:24px;">
        ${inputField(fullRow, 'enrollment_number', 'Enrollment Number', 'placeholder="Auto-generated if empty"')}
        ${inputField(fullRow, 'name', 'Name', 'placeholder="FULL NAME"')}
        ${inputField(fullRow, 'father_name', 'Father Name', 'placeholder="FATHER\'S NAME"')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:24px;">
        ${selectField('sex', 'Sex', sexOptions(fullRow.sex))}
        ${inputField(fullRow, 'age', 'Age', 'type="number" placeholder="Age"')}
        ${inputField(fullRow, 'date_of_birth', 'Date Of Birth', 'type="date"')}
        ${inputField(fullRow, 'date_of_joining', 'Date Of Joining', 'type="date"')}
      </div>
    </div>
    <div style="height:1px;background:var(--border);margin-bottom:32px;"></div>
    <div style="margin-bottom:32px;">
      <div class="flex items-center gap-8" style="margin-bottom:24px;color:var(--accent);"><i data-lucide="phone" style="width:18px;"></i><h3 class="card-title" style="margin-bottom:0;">Contact Information</h3></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;">${inputField(fullRow, 'mobile1', 'Mobile1')}${inputField(fullRow, 'mobile2', 'Mobile2')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;">${textareaField(fullRow, 'address_line1', 'Address Line1')}${textareaField(fullRow, 'address_line2', 'Address Line2')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">${inputField(fullRow, 'city', 'City')}${inputField(fullRow, 'pincode', 'Pincode')}</div>
    </div>
    <div style="height:1px;background:var(--border);margin-bottom:32px;"></div>
    <div style="margin-bottom:32px;">
      <div class="flex items-center gap-8" style="margin-bottom:24px;color:var(--accent);"><i data-lucide="graduation-cap" style="width:18px;"></i><h3 class="card-title" style="margin-bottom:0;">Academic & Course</h3></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:24px;">
        ${inputField(fullRow, 'qualification', 'Qualification')}
        ${selectField('course_id', 'Course Id', `<option value="">Select course</option>${courseOptions}`)}
        ${selectField('scheme_id', 'Scheme Id', `<option value="">Select scheme</option>${schemeOptions}`)}
        ${selectField('batch_id', 'Batch Id', `<option value="">Select batch</option>${batchOptions}`)}
      </div>
    </div>
    <div style="height:1px;background:var(--border);margin-bottom:32px;"></div>
    <div style="margin-bottom:32px;">
      <div class="flex items-center gap-8" style="margin-bottom:24px;color:var(--accent);"><i data-lucide="credit-card" style="width:18px;"></i><h3 class="card-title" style="margin-bottom:0;">Fee Information</h3></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-bottom:24px;">${inputField(fullRow, 'total_fees', 'Total Fees', 'type="number"')}${inputField(fullRow, 'concession', 'Concession', 'type="number"')}${inputField(fullRow, 'bill_number', 'Bill Number')}</div>
    </div>`;

  modal.innerHTML = `
    <div class="card" style="width:min(1100px,100%);max-height:85vh;overflow:auto;">
      <div class="card-header">
        <h3 class="card-title">${title}</h3>
        <button type="button" class="btn-icon" data-modal-close="true"><i data-lucide="x"></i></button>
      </div>
      <form data-modal-form="true">
        ${module === 'student' ? studentForm : enquiryForm}
        <div class="flex justify-end gap-16">
          <button type="button" class="btn btn-secondary" data-modal-close="true">Cancel</button>
          <button type="submit" class="btn btn-primary"><i data-lucide="save"></i><span>Save Changes</span></button>
        </div>
      </form>
    </div>
  `;

  modal.querySelectorAll('[data-modal-close="true"]').forEach((button) => button.addEventListener('click', () => modal.remove()));
  modal.querySelector('form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await desktopApiRequest(`${endpoint}/${id}`, 'PUT', normalizeActionBody(module, formToJson(event.currentTarget as HTMLFormElement)));
      modal.remove();
      showActionToast(root, `${module.charAt(0).toUpperCase()}${module.slice(1)} updated successfully.`);
      onSaved();
    } catch (error) {
      showActionToast(root, extractApiErrorMessage(error, 'Save failed.'), 'error');
    }
  });

  document.body.appendChild(modal);
  modal.querySelectorAll('i[data-lucide]').forEach((node) => {
    const iconName = node.getAttribute('data-lucide');
    if (!iconName) return;
    const markup = renderIcon(iconName, node.getAttribute('class') || '', node.getAttribute('style') || '');
    if (markup) node.outerHTML = markup;
  });
}

function openEditModal(root: HTMLElement, module: string, id: string, onSaved: () => void) {
  const endpoint = moduleEndpointMap[module];
  const row = rowCache()[module]?.find((item) => String(item.id) === String(id));
  if (!endpoint || !row) {
    showActionToast(root, 'This record could not be opened. Refresh the page and try again.', 'error');
    return;
  }
  if (module === 'enquiry' || module === 'student') {
    void openStructuredEditModal(root, module, id, row, onSaved).catch((error) => {
      showActionToast(root, error instanceof Error ? error.message : 'Could not open edit form.', 'error');
    });
    return;
  }
  if (module === 'staff') {
    void (async () => {
      const batchesPayload = await desktopApiGet('/batches');
      root.querySelector('[data-crud-modal="true"]')?.remove();
      const modal = document.createElement('div');
      modal.dataset.crudModal = 'true';
      modal.className = 'crud-modal-overlay';
      modal.innerHTML = `
        <div class="card" style="width:min(900px,100%);max-height:85vh;overflow:auto;">
          <div class="card-header">
            <h3 class="card-title">Edit Staff Member</h3>
            <button type="button" class="btn-icon" data-modal-close="true"><i data-lucide="x"></i></button>
          </div>
          ${staffFormHtml(row, findArray(batchesPayload, ['batches']), 'Save Changes', 'Leave blank to keep current password')}
        </div>
      `;
      modal.querySelectorAll('[data-modal-close="true"], a[href="#/staff-list"]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.preventDefault();
          modal.remove();
        });
      });
      modal.querySelector('form')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          await desktopApiRequest(`${endpoint}/${id}`, 'PUT', normalizeActionBody(module, formToJson(event.currentTarget as HTMLFormElement)));
          modal.remove();
          showActionToast(root, 'Staff updated successfully.');
          onSaved();
        } catch (error) {
          showActionToast(root, extractApiErrorMessage(error, 'Save failed.'), 'error');
        }
      });
      document.body.appendChild(modal);
      modal.querySelectorAll('i[data-lucide]').forEach((node) => {
        const iconName = node.getAttribute('data-lucide');
        if (!iconName) return;
        const markup = renderIcon(iconName, node.getAttribute('class') || '', node.getAttribute('style') || '');
        if (markup) node.outerHTML = markup;
      });
    })().catch((error) => showActionToast(root, error instanceof Error ? error.message : 'Could not open edit form.', 'error'));
    return;
  }

  root.querySelector('[data-crud-modal="true"]')?.remove();
  const modal = document.createElement('div');
  modal.dataset.crudModal = 'true';
  modal.className = 'crud-modal-overlay';

  const editableKeys = Object.keys(row).filter((key) => (
    !['id', 'created_at', 'updated_at', 'centre_id', 'user_id'].includes(key) &&
    ['string', 'number', 'boolean'].includes(typeof row[key])
  )).slice(0, 10);

  modal.innerHTML = `
    <div class="card" style="width:min(720px,100%);max-height:85vh;overflow:auto;">
      <div class="card-header">
        <h3 class="card-title">Edit ${module}</h3>
        <button type="button" class="btn-icon" data-modal-close="true"><i data-lucide="x"></i></button>
      </div>
      <form data-modal-form="true">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;">
          ${editableKeys.map((key) => `
            <label class="form-group">
              <span class="label">${key.replace(/_/g, ' ')}</span>
              <input class="input" name="${key}" value="${valueText(row[key]).replace(/"/g, '&quot;')}" />
            </label>
          `).join('')}
        </div>
        <div class="flex justify-end gap-16" style="margin-top:24px;">
          <button type="button" class="btn btn-secondary" data-modal-close="true">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Changes</button>
        </div>
      </form>
    </div>
  `;

  modal.querySelectorAll('[data-modal-close="true"]').forEach((button) => {
    button.addEventListener('click', () => modal.remove());
  });
  modal.querySelector('form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await desktopApiRequest(`${endpoint}/${id}`, 'PUT', normalizeActionBody(module, formToJson(event.currentTarget as HTMLFormElement)));
      modal.remove();
      showActionToast(root, `${module.charAt(0).toUpperCase()}${module.slice(1)} updated successfully.`);
      onSaved();
    } catch (error) {
      showActionToast(root, extractApiErrorMessage(error, 'Save failed.'), 'error');
    }
  });

  document.body.appendChild(modal);
}

function optionList(items: Record<string, unknown>[], selected?: unknown) {
  return items.map((item) => `<option value="${valueText(item.id)}" ${String(selected || '') === String(item.id) ? 'selected' : ''}>${valueText(item.name)}</option>`).join('');
}

function setSelectOptions(select: HTMLSelectElement | null, items: Record<string, unknown>[], placeholder: string, selected?: unknown, labelFor?: (item: Record<string, unknown>) => string) {
  if (!select) return;
  select.innerHTML = `<option value="">${placeholder}</option>${items.map((item) => {
    const value = valueText(item.id);
    const label = labelFor ? labelFor(item) : valueText(item.name);
    return `<option value="${value}" ${String(selected || '') === String(item.id) ? 'selected' : ''}>${label}</option>`;
  }).join('')}`;
}

async function hydrateExistingAddForm(root: HTMLElement, templatePath: string) {
  if (root.dataset.existingAddHydrated === templatePath) return;
  root.dataset.existingAddHydrated = templatePath;

  if (templatePath === 'enquiries/add.html') {
    const [coursesPayload, schemesPayload] = await Promise.all([desktopApiGet('/courses'), desktopApiGet('/schemes')]);
    setSelectOptions(root.querySelector<HTMLSelectElement>('select[name="course_interested_id"]'), findArray(coursesPayload, ['courses']), 'Select course');
    setSelectOptions(root.querySelector<HTMLSelectElement>('select[name="scheme_id"]'), findArray(schemesPayload, ['schemes']), 'Select scheme');
  }

  if (templatePath === 'students/add.html') {
    const [coursesPayload, batchesPayload, schemesPayload] = await Promise.all([
      desktopApiGet('/courses'),
      desktopApiGet('/batches'),
      desktopApiGet('/schemes'),
    ]);
    const batches = findArray(batchesPayload, ['batches']);
    setSelectOptions(root.querySelector<HTMLSelectElement>('select[name="course_id"]'), findArray(coursesPayload, ['courses']), 'Select course');
    setSelectOptions(root.querySelector<HTMLSelectElement>('select[name="scheme_id"]'), findArray(schemesPayload, ['schemes']), 'Select scheme');
    setSelectOptions(root.querySelector<HTMLSelectElement>('select[name="batch_id"]'), batches, 'Select batch', undefined, (item) => {
      const start = valueText(item.start_time);
      const end = valueText(item.end_time);
      return `${valueText(item.name)}${start !== '-' || end !== '-' ? ` (${start} - ${end})` : ''}`;
    });

    const calculateNetFees = () => {
      const total = Number(root.querySelector<HTMLInputElement>('#totalFees')?.value || 0);
      const concession = Number(root.querySelector<HTMLInputElement>('#concession')?.value || 0);
      const netFees = root.querySelector<HTMLInputElement>('#netFees');
      if (netFees) netFees.value = Math.max(total - concession, 0).toFixed(2);
    };
    root.querySelector('#totalFees')?.addEventListener('input', calculateNetFees);
    root.querySelector('#concession')?.addEventListener('input', calculateNetFees);
    calculateNetFees();

    const batchSelect = root.querySelector<HTMLSelectElement>('select[name="batch_id"]');
    const timingDisplay = root.querySelector<HTMLElement>('#batch-timing-display');
    const updateTiming = () => {
      const text = batchSelect?.selectedOptions?.[0]?.textContent || '';
      if (timingDisplay) {
        timingDisplay.textContent = text.includes('(') ? text.split('(')[1]?.split(')')[0] || '' : '';
        timingDisplay.style.color = 'var(--accent)';
      }
    };
    batchSelect?.addEventListener('change', updateTiming);
    updateTiming();

    const enquiryId = pageQueryParam('enquiry_id');
    if (enquiryId) {
      const payload = await desktopApiGet(`/enquiries/${enquiryId}`) as { enquiry?: Record<string, unknown> };
      const enquiry = findRecord(payload, ['enquiry']);
      setFormFieldValue(root, 'name', enquiry.name);
      setFormFieldValue(root, 'father_name', enquiry.father_name);
      setFormFieldValue(root, 'sex', enquiry.sex);
      setFormFieldValue(root, 'mobile1', enquiry.mobile1);
      setFormFieldValue(root, 'mobile2', enquiry.mobile2);
      setFormFieldValue(root, 'address_line1', enquiry.address);
      setFormFieldValue(root, 'pincode', enquiry.pincode);
      setFormFieldValue(root, 'qualification', enquiry.qualification);
      setFormFieldValue(root, 'course_id', enquiry.course_interested_id);
      setFormFieldValue(root, 'scheme_id', enquiry.scheme_id);
      setFormFieldValue(root, 'date_of_joining', new Date().toISOString().slice(0, 10));
      ensureHiddenField(root, 'enquiry_id', enquiryId);
      const form = root.querySelector('form');
      if (form && !form.querySelector('[data-enquiry-banner]')) {
        form.insertAdjacentHTML('afterbegin', `
          <div data-enquiry-banner="true" class="card" style="margin-bottom:24px;padding:16px 20px;background:var(--accent-light);border:1px solid var(--accent);">
            <p style="font-size:14px;color:var(--text-primary);margin:0;">
              Converting enquiry for <strong>${valueText(enquiry.name)}</strong>. Review the details and save to create the student.
            </p>
          </div>
        `);
      }
      calculateNetFees();
      updateTiming();
    }
  }
}

function setManagedPage(root: HTMLElement, title: string, subtitle: string, formHtml: string, backRoute: string) {
  root.innerHTML = `
    <div class="flex justify-between items-center" style="margin-bottom:32px;padding:0 32px;margin-top:32px;">
      <div>
        <h1 class="page-title">${title}</h1>
        <p class="label-meta">${subtitle}</p>
      </div>
      <a href="${backRoute}" class="btn btn-secondary">
        <i data-lucide="arrow-left"></i>
        <span>Back</span>
      </a>
    </div>
    <div class="p-32" style="padding-top:0;">
      <div class="card" style="max-width:900px;margin:0 auto;">
        ${formHtml}
      </div>
    </div>
  `;
}

async function renderManagedAddForm(root: HTMLElement, templatePath: string) {
  if (root.dataset.managedAddRendered === templatePath) return;
  root.dataset.managedAddRendered = templatePath;

  if (templatePath === 'students/add.html' || templatePath === 'enquiries/add.html') {
    await hydrateExistingAddForm(root, templatePath);
    return;
  }

  if (templatePath === 'staff/add.html') {
    const batchesPayload = await desktopApiGet('/batches');
    setManagedPage(root, 'Add Staff Member', 'Create a new staff profile and assign batches', staffFormHtml({ is_active: true }, findArray(batchesPayload, ['batches']), 'Save Staff', 'Set password (leave empty for default: 123456)'), '#/staff-list');
    return;
  }

  if (templatePath === 'batches/add.html') {
    setManagedPage(root, 'Add Batch', 'Select a predefined batch slot', `
      <form method="post" data-managed-add="batch">
        <label class="form-group">
          <span class="label">Batch Slot</span>
          <select class="input" name="batch_template" required>
            <option value="">Select batch</option>
            ${batchTemplates.map(([name, start, end]) => `<option value="${name}|${start}|${end}">${name} (${start} - ${end})</option>`).join('')}
          </select>
        </label>
        <input type="hidden" name="name" />
        <input type="hidden" name="start_time" />
        <input type="hidden" name="end_time" />
        <div class="card" style="background:var(--bg-secondary);margin:16px 0;">
          <p class="label-meta">Selected Batch</p>
          <h3 class="card-title" data-batch-preview>Name, start time and end time will fill automatically.</h3>
        </div>
        <div class="flex justify-end gap-16">
          <a href="#/batches-list" class="btn btn-secondary">Cancel</a>
          <button type="submit" class="btn btn-primary"><i data-lucide="save"></i><span>Save Batch</span></button>
        </div>
      </form>
    `, '#/batches-list');
    const select = root.querySelector<HTMLSelectElement>('select[name="batch_template"]');
    select?.addEventListener('change', () => {
      const [name, start, end] = (select.value || '').split('|');
      (root.querySelector<HTMLInputElement>('input[name="name"]')!).value = name || '';
      (root.querySelector<HTMLInputElement>('input[name="start_time"]')!).value = start || '';
      (root.querySelector<HTMLInputElement>('input[name="end_time"]')!).value = end || '';
      const preview = root.querySelector<HTMLElement>('[data-batch-preview]');
      if (preview) preview.textContent = name ? `${name}: ${start} - ${end}` : 'Name, start time and end time will fill automatically.';
    });
    return;
  }

  if (templatePath === 'courses/add.html') {
    setManagedPage(root, 'Add Course', 'Create a course with duration-based dates', `
      <form method="post" data-managed-add="course">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
          <label class="form-group"><span class="label">Course Name</span><input class="input" name="name" required /></label>
          <label class="form-group"><span class="label">Duration</span><select class="input" name="duration_months" required>${courseDurations.map((m) => `<option value="${m}">${m} ${m === 1 ? 'Month' : 'Months'}</option>`).join('')}</select></label>
          <label class="form-group"><span class="label">Start Date</span><input class="input" name="start_date" type="date" readonly /></label>
          <label class="form-group"><span class="label">End Date</span><input class="input" name="end_date" type="date" readonly /></label>
          <label class="form-group"><span class="label">Fee</span><input class="input" name="fees" type="number" min="0" step="0.01" required /></label>
          <label class="form-group"><span class="label">Description</span><input class="input" name="description" /></label>
        </div>
        <div class="flex justify-end gap-16"><a href="#/courses-list" class="btn btn-secondary">Cancel</a><button type="submit" class="btn btn-primary"><i data-lucide="save"></i><span>Save Course</span></button></div>
      </form>
    `, '#/courses-list');
    const updateDates = () => {
      const start = new Date();
      const months = Number(root.querySelector<HTMLSelectElement>('select[name="duration_months"]')?.value || 1);
      const end = new Date(start);
      end.setMonth(end.getMonth() + months);
      const fmt = (date: Date) => date.toISOString().slice(0, 10);
      (root.querySelector<HTMLInputElement>('input[name="start_date"]')!).value = fmt(start);
      (root.querySelector<HTMLInputElement>('input[name="end_date"]')!).value = fmt(end);
    };
    root.querySelector('select[name="duration_months"]')?.addEventListener('change', updateDates);
    updateDates();
    return;
  }

  if (templatePath === 'schemes/add.html') {
    setManagedPage(root, 'Add Scheme', 'Create a new discount or promotional offer', `
      <form method="post" data-managed-add="scheme">
        <label class="form-group"><span class="label">Scheme Name</span><input class="input" name="name" required /></label>
        <label class="form-group"><span class="label">Discount Percentage</span><input class="input" type="number" min="0" max="100" name="discount_percentage" value="0" required /></label>
        <label class="form-group"><span class="label">Description</span><textarea class="input" name="description" style="height:90px;padding:12px;"></textarea></label>
        <div class="flex justify-end gap-16"><a href="#/schemes-list" class="btn btn-secondary">Cancel</a><button type="submit" class="btn btn-primary"><i data-lucide="save"></i><span>Save Scheme</span></button></div>
      </form>
    `, '#/schemes-list');
  }
}

function validCoordinate(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

function installCrudActionBridge(root: HTMLElement, templatePath: string) {
  const controller = new AbortController();
  const listenerOptions = { capture: true, signal: controller.signal } as const;

  const refetchCurrentPage = async () => {
    await hydrateTemplateData(root, templatePath);
  };

  const refreshData = async (module?: string) => {
    if (module) {
      await refreshAfterMutation(module, templatePath);
      return;
    }
    invalidateScopes(scopesForTemplate(templatePath));
    await refetchCurrentPage();
  };

  const refetch = () => {
    void refreshData();
  };

  root.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest?.('[data-crud-action]') as HTMLElement | null;
    const plainButton = target?.closest?.('button') as HTMLButtonElement | null;
    const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;

    if (button) {
      event.preventDefault();
      event.stopPropagation();
      const action = button.dataset.crudAction || '';
      const module = button.dataset.module || '';
      const id = button.dataset.id || '';
      const endpoint = moduleEndpointMap[module];

      if (module === 'notification' && action === 'read' && id) {
        try {
          await desktopApiRequest(`/notifications/${id}/read`, 'POST');
          showActionToast(root, 'Notification marked read.');
          await refreshData('notification');
        } catch (error) {
          showActionToast(root, extractApiErrorMessage(error, 'Action failed.'), 'error');
        }
        return;
      }

      if (module === 'attendance' && action === 'delete-holiday' && id) {
        try {
          await desktopApiRequest(`/settings/attendance/holiday/${id}/delete`, 'POST');
          showActionToast(root, 'Holiday deleted successfully.');
          await refreshData('attendance');
        } catch (error) {
          showActionToast(root, extractApiErrorMessage(error, 'Action failed.'), 'error');
        }
        return;
      }

      if (module === 'staff-leave' && action === 'status' && id) {
        try {
          await desktopApiRequest(`/staff/leave-requests/${id}/status`, 'POST', { status: button.dataset.status || 'Approved' });
          showActionToast(root, 'Leave request updated successfully.');
          await refreshData('staff-leave');
        } catch (error) {
          showActionToast(root, extractApiErrorMessage(error, 'Action failed.'), 'error');
        }
        return;
      }

      if (module === 'staff-correction' && action === 'status' && id) {
        const status = button.dataset.status || 'Approved';
        const note = status === 'Rejected' ? window.prompt('Reason / note for rejection', '') || '' : '';
        try {
          await desktopApiRequest(`/staff/corrections/${id}/status`, 'POST', { status, note });
          showActionToast(root, 'Correction request updated successfully.');
          await refreshData('staff-correction');
        } catch (error) {
          showActionToast(root, extractApiErrorMessage(error, 'Action failed.'), 'error');
        }
        return;
      }

      if (module === 'staff-attendance' && action === 'status' && id) {
        const status = button.dataset.status || 'Approved';
        let reason = '';
        if (status === 'Rejected') {
          const entered = await promptRequiredText({
            title: 'Reject Attendance',
            message: 'Enter a clear reason for rejecting this check-in. Staff will see this note in the mobile app.',
            placeholder: 'e.g. Selfie unclear, outside office area, duplicate entry',
            confirmLabel: 'Reject',
          });
          if (entered === null) return;
          reason = entered;
        }
        try {
          await desktopApiRequest(`/staff/attendance/${id}/status`, 'POST', {
            status,
            rejection_reason: reason,
          });
          invalidateDesktopApiCache(['staff']);
          showActionToast(root, status === 'Rejected' ? 'Attendance rejected successfully.' : 'Attendance approved successfully.');
          await refetchCurrentPage();
        } catch (error) {
          showActionToast(root, extractApiErrorMessage(error, 'Action failed.'), 'error');
        }
        return;
      }

      if (module === 'student' && action === 'whatsapp-fee' && id) {
        try {
          const preview = await desktopApiGet(`/whatsapp/pending-fee/${id}/preview`) as { message?: string; whatsapp_url?: string; student?: { id?: number | string } };
          const message = window.prompt('Confirm WhatsApp fee reminder message', preview.message || '');
          if (!message) return;
          const result = await desktopApiRequest('/whatsapp/send-pending-fee', 'POST', { student_id: id, message }) as { whatsapp_url?: string };
          const whatsappUrl = result.whatsapp_url || preview.whatsapp_url;
          if (whatsappUrl) {
            window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
            showActionToast(root, 'WhatsApp message sent successfully.');
          } else {
            showActionToast(root, 'WhatsApp message prepared.');
          }
          await refreshScopes(['whatsapp']);
        } catch (error) {
          showActionToast(root, extractApiErrorMessage(error, 'WhatsApp action failed.'), 'error');
        }
        return;
      }

      if (module === 'enquiry' && action === 'convert-enquiry' && id) {
        if (!window.confirm('Open student form with this enquiry\'s details? The enquiry stays active until you save the student.')) return;
        window.location.hash = `/students-add?enquiry_id=${id}`;
        return;
      }

      if (module === 'student' && action === 'view' && id) {
        window.location.hash = `/students-view?id=${id}`;
        return;
      }

      if (module === 'student' && action === 'pay-fees' && id) {
        window.location.hash = `/fees-payment?id=${id}`;
        return;
      }

      if (!endpoint || !id) {
        showActionToast(root, 'This action is not available yet.', 'error');
        return;
      }

      if (action === 'edit') {
        openEditModal(root, module, id, () => { void refreshData(module); });
        return;
      }

      if (action === 'delete') {
        if (!window.confirm(`Delete this ${module}?`)) return;
        try {
          await desktopApiRequest(`${endpoint}/${id}`, 'DELETE');
          showActionToast(root, `${module.charAt(0).toUpperCase()}${module.slice(1)} deleted successfully.`);
          await refreshData(module);
        } catch (error) {
          showActionToast(root, extractApiErrorMessage(error, 'Delete failed.'), 'error');
        }
      }
      return;
    }

    if (plainButton) {
      const label = plainButton.textContent?.replace(/\s+/g, ' ').trim() || '';
      const planId = plainButton.dataset.planId || '';
      if (planId) {
        event.preventDefault();
        event.stopPropagation();
        const card = plainButton.closest('.card');
        if (card?.classList.contains('current-plan') || plainButton.disabled) {
          showActionToast(root, 'This is already your current plan.');
          return;
        }
        await startSubscriptionPayment(root, planId, plainButton);
        return;
      }
      if (plainButton.id === 'btnExport') {
        event.preventDefault();
        event.stopPropagation();
        try {
          await exportSelectedData(root);
        } catch (error) {
          showActionToast(root, error instanceof Error ? error.message : 'Export failed.', 'error');
        }
        return;
      }
      if (templatePath === 'exports/options.html' && plainButton.closest('#importForm')) {
        event.preventDefault();
        event.stopPropagation();
        try {
          await importSelectedData(root);
        } catch (error) {
          showActionToast(root, error instanceof Error ? error.message : 'Import failed.', 'error');
        }
        return;
      }
      if (label.toLowerCase().includes('mark all read')) {
        event.preventDefault();
        event.stopPropagation();
        try {
          await desktopApiRequest('/notifications/mark-all-read', 'POST');
          showActionToast(root, 'All notifications marked read.');
          await refreshData('notification');
        } catch (error) {
          showActionToast(root, extractApiErrorMessage(error, 'Action failed.'), 'error');
        }
        return;
      }
      if (await handleReportAction(root, label)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    if (anchor) {
      const href = anchor.getAttribute('href') || '';
      if (href === '#' || href === '') {
        event.preventDefault();
        event.stopPropagation();
        const config = templateActionMap[templatePath];
        const label = anchor.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
        if (anchor.id === 'downloadSampleBtn') {
          await downloadSelectedTemplate(root);
          return;
        }
        if (await handleReportAction(root, label)) return;
        if (label.includes('refresh')) {
          refetch();
          return;
        }
        if (config?.listRoute && (label.includes('cancel') || label.includes('back'))) {
          window.location.hash = config.listRoute.replace(/^#/, '');
          return;
        }
        const quickRoutes: Array<[string, string]> = [
          ['new enrollment', '#/students-add'],
          ['new student', '#/students-add'],
          ['add student', '#/students-add'],
          ['new enquiry', '#/enquiries-add'],
          ['add enquiry', '#/enquiries-add'],
          ['new batch', '#/batches-add'],
          ['add batch', '#/batches-add'],
          ['new course', '#/courses-add'],
          ['add course', '#/courses-add'],
          ['new scheme', '#/schemes-add'],
          ['add scheme', '#/schemes-add'],
          ['add staff', '#/staff-add'],
          ['staff list', '#/staff-list'],
          ['staff dashboard', '#/staff-dashboard'],
          ['attendance list', '#/staff-attendance_list'],
          ['leave requests', '#/staff-leave_requests'],
          ['corrections', '#/staff-corrections'],
          ['staff reports', '#/staff-reports'],
          ['attendance settings', '#/settings-attendance'],
          ['back to reports', '#/reports'],
          ['back to staff', '#/staff-list'],
          ['back to students', '#/students-list'],
          ['back to enquiries', '#/enquiries-list'],
          ['back to batches', '#/batches-list'],
          ['back to courses', '#/courses-list'],
          ['back to schemes', '#/schemes-list'],
          ['back to dashboard', '#/dashboard'],
          ['back to settings', '#/settings-profile'],
          ['view all students', '#/students-list'],
          ['reports', '#/reports'],
        ];
        const quickRoute = quickRoutes.find(([key]) => label.includes(key))?.[1];
        if (quickRoute) {
          window.location.hash = quickRoute.replace(/^#/, '');
          return;
        }
        if (config?.addRoute && (label.includes('add') || label.includes('new'))) {
          window.location.hash = config.addRoute.replace(/^#/, '');
          return;
        }
      }
    }
  }, listenerOptions);

  let filterRefreshTimer: number | undefined;
  root.addEventListener('change', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('form')) return;
    if (!(templatePath.endsWith('/list.html') || templatePath.startsWith('reports/'))) return;
    if (target.closest('#exportForm, #importForm')) return;
    if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) return;
    if (target instanceof HTMLInputElement && !['checkbox', 'radio', 'search'].includes(target.type)) return;
    window.clearTimeout(filterRefreshTimer);
    filterRefreshTimer = window.setTimeout(refetch, 150);
  }, listenerOptions);

  root.addEventListener('submit', async (event) => {
    const form = event.target as HTMLFormElement;
    if (templatePath === 'auth/register.html' || form.classList.contains('register-form')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const config = templateActionMap[templatePath];
    const body = formToJson(form);

    try {
      if (templatePath.endsWith('/list.html') && (form.method || '').toLowerCase() !== 'post') {
        refetch();
        return;
      }

      if (config && templatePath.endsWith('/add.html')) {
        const normalizedBody = normalizeActionBody(config.module, body);
        const validationError = validateActionBody(config.module, normalizedBody);
        if (validationError) {
          showActionToast(root, validationError, 'error');
          return;
        }
        await desktopApiRequest(config.endpoint, 'POST', normalizedBody);
        showActionToast(root, `${config.label} added successfully.`);
        await refreshAfterMutation(config.module, templatePath);
        window.location.hash = config.listRoute.replace(/^#/, '');
        return;
      }

      if (templatePath === 'settings/profile.html') {
        const settingsForm = root.querySelector<HTMLFormElement>('.settings-form');
        if (settingsForm?.dataset.editing !== 'true') {
          showActionToast(root, 'Click Edit to update your profile.', 'error');
          return;
        }
        await desktopApiRequest('/settings/profile', 'PUT', body);
        showActionToast(root, 'Settings saved successfully.');
        await refreshData('settings');
        return;
      }

      if (templatePath === 'settings/attendance.html') {
        if ('holiday_date' in body || 'holiday_name' in body) {
          await desktopApiRequest('/settings/attendance/holiday', 'POST', {
            holiday_date: body.holiday_date || body.date,
            holiday_name: body.holiday_name || body.name,
          });
          showActionToast(root, 'Holiday saved successfully.');
          await refreshData('attendance');
          return;
        }

        const normalizedBody: Record<string, unknown> & { week_off_days: unknown[] } = {
          ...body,
          week_off_days: Array.isArray(body.week_off_days)
            ? body.week_off_days
            : body.week_off_days
              ? [String(body.week_off_days)]
              : [],
        };
        if (!validCoordinate(normalizedBody.latitude, -90, 90) || !validCoordinate(normalizedBody.longitude, -180, 180)) {
          showActionToast(root, 'Enter valid latitude and longitude before saving.', 'error');
          return;
        }
        await desktopApiRequest('/settings/attendance', 'PUT', normalizedBody);
        showActionToast(root, 'Attendance settings saved successfully.');
        await refreshData('attendance');
        return;
      }

      if (templatePath === 'exports/options.html') {
        if (form.id === 'importForm') {
          await importSelectedData(root);
          return;
        }
        if (form.id === 'exportForm') {
          await exportSelectedData(root);
          return;
        }
      }

      if (templatePath === 'fees/payment.html') {
        const studentId = pageQueryParam('id') || form.dataset.studentId || '';
        if (!studentId) {
          showActionToast(root, 'Student not found. Open this page from the student list or profile.', 'error');
          return;
        }
        const amount = Number(body.amount || 0);
        if (!amount || amount <= 0) {
          showActionToast(root, 'Payment amount must be greater than zero.', 'error');
          return;
        }
        await desktopApiRequest(`/students/${studentId}/payments`, 'POST', {
          amount,
          payment_date: body.payment_date,
          payment_method: body.payment_method || 'Cash',
          receipt_number: body.receipt_number,
          notes: body.notes,
        });
        showActionToast(root, 'Fee payment recorded successfully.');
        await refreshAfterMutation('student', templatePath);
        window.location.hash = `/students-view?id=${studentId}`;
        return;
      }

      showActionToast(root, 'This form is not connected for this page yet.', 'error');
    } catch (error) {
      showActionToast(root, extractApiErrorMessage(error, 'Save failed.'), 'error');
    }
  }, listenerOptions);

  return () => {
    controller.abort();
    window.clearTimeout(filterRefreshTimer);
  };
}

function currentUserName() {
  try {
    const raw = localStorage.getItem('lerzo_user');
    if (!raw) return 'Account';
    const user = JSON.parse(raw) as { name?: string; email?: string };
    return user.name || user.email || 'Account';
  } catch {
    return 'Account';
  }
}

function hydrateDashboard(root: HTMLElement, payload: unknown) {
  const stats = findRecord(payload, ['stats', 'dashboard', 'summary', 'overview']);
  debugPageState('dashboard/index.html', 'mapped data', { stats });
  const counts = root.querySelectorAll('.count-up');
  setCount(counts[0], valueFrom(stats, ['total_students', 'students_count', 'students'], 0));
  setCount(counts[1], valueFrom(stats, ['total_enquiries', 'active_enquiries', 'enquiries_count', 'enquiries'], 0));
  setCount(counts[2], valueFrom(stats, ['total_fees_collected', 'fees_collected', 'collected_fees', 'total_collected'], 0), formatCurrency);
  setCount(counts[3], valueFrom(stats, ['pending_fees', 'fees_pending', 'pending_balance', 'total_pending'], 0), formatCurrency);
  const feeBreakdown = (stats.fee_status_breakdown || {}) as Record<string, unknown>;
  setCount(counts[4], valueFrom({ ...stats, ...feeBreakdown }, ['fully_paid', 'paid_students'], 0));

  const welcome = Array.from(root.querySelectorAll<HTMLElement>('p'))
    .find((item) => item.textContent?.includes('Welcome back'));
  if (welcome) welcome.textContent = `Welcome back, ${currentUserName()}! Here's what's happening today.`;

  Array.from(root.querySelectorAll<HTMLElement>('span')).find((item) => item.textContent?.includes('Sample Plan'))
    ?.closest<HTMLElement>('div')?.remove();

  const courseStats = findArray(stats, ['course_stats', 'course_distribution', 'courses']);
  const courseCard = Array.from(root.querySelectorAll<HTMLElement>('h3')).find((node) => node.textContent?.trim() === 'Course Distribution')?.closest<HTMLElement>('.bg-white');
  const courseContent = courseCard?.querySelector<HTMLElement>('.space-y-4, .py-10');
  if (courseContent) {
    courseContent.className = courseStats.length ? 'space-y-4' : 'py-10 text-center';
    courseContent.innerHTML = courseStats.length ? courseStats.map((item) => {
      const name = valueText(item.course_name || item.name || item[0]);
      const count = Number(item.count || item.students || item[1] || 0);
      const total = Number(valueFrom(stats, ['total_students', 'students_count'], 0));
      const percent = total > 0 ? Math.min(100, (count / total) * 100) : 0;
      return `
        <div>
          <div class="flex justify-between items-center mb-1.5">
            <span class="text-sm font-bold text-gray-700">${name}</span>
            <span class="text-sm font-black text-accent">${count} Students</span>
          </div>
          <div class="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div class="bg-purple-500 h-full rounded-full" style="width:${percent}%"></div>
          </div>
        </div>
      `;
    }).join('') : '<p class="text-gray-400 font-medium">No course data available</p>';
  }

  const batchStats = findArray(stats, ['batch_stats', 'batch_distribution', 'batches']);
  const batchCard = Array.from(root.querySelectorAll<HTMLElement>('h3')).find((node) => node.textContent?.trim() === 'Active Batches')?.closest<HTMLElement>('.bg-white');
  const batchContent = batchCard?.querySelector<HTMLElement>('.grid, .py-10');
  if (batchContent) {
    batchContent.className = batchStats.length ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : 'py-10 text-center';
    batchContent.innerHTML = batchStats.length ? batchStats.map((item) => `
      <div class="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-center justify-between">
        <div>
          <p class="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Batch</p>
          <p class="font-bold text-gray-900">${valueText(item.batch_name || item.name || item[0])}</p>
        </div>
        <div class="text-right">
          <p class="text-xl font-black text-accent">${valueText(item.count || item.students || item[1] || 0)}</p>
          <p class="text-[10px] font-bold text-gray-400 uppercase">Students</p>
        </div>
      </div>
    `).join('') : '<p class="text-gray-400 font-medium">No batch data available</p>';
  }

  const recentStudents = findArray(stats, ['recent_students', 'students']);
  const recentBody = root.querySelector<HTMLTableSectionElement>('table tbody');
  if (recentBody) {
    recentBody.innerHTML = recentStudents.length
      ? recentStudents.map((student) => `
        <tr class="hover:bg-gray-50/80 transition-colors group">
          <td class="px-8 py-5 text-sm font-bold text-gray-900 group-hover:text-accent transition-colors">${valueText(student.name)}</td>
          <td class="px-8 py-5 text-sm font-semibold text-gray-700">${valueText(student.course || student.course_name)}</td>
          <td class="px-8 py-5 text-sm font-bold text-center"><span class="badge badge-success">${valueText(student.fee_status || student.status || 'Active')}</span></td>
          <td class="px-8 py-5 text-sm font-medium text-gray-600">${valueText(student.date_of_joining || student.created_at).slice(0, 12)}</td>
          <td class="px-8 py-5 text-sm text-center"></td>
        </tr>
      `).join('')
      : emptyRow(5, 'No students yet.');
  }
}

function renderRows(root: HTMLElement, rows: string, emptyMessage: string, colspan: number, addRoute = '#', addLabel = 'Add New') {
  removeGeneratedEmptyBlocks(root);
  const body = tbody(root);
  if (!body) return;
  body.innerHTML = rows || emptyRow(colspan, emptyMessage, addRoute, addLabel);
}

function hydrateEnquiries(root: HTMLElement, payload: unknown) {
  const enquiries = findArray(payload, ['enquiries']);
  cacheRows('enquiry', enquiries);
  debugPageState('enquiries/list.html', 'mapped data', { count: enquiries.length, enquiries });
  renderRows(root, enquiries.map((item) => `
    <tr>
      <td><div style="font-weight:600;color:var(--text-primary);">${valueText(item.name)}</div></td>
      <td>${valueText(item.course_interested || item.reason_for_interest)}</td>
      <td>${valueText(item.mobile1)}${item.mobile2 ? `<br><span class="label-meta">${valueText(item.mobile2)}</span>` : ''}</td>
      <td>${valueText(item.qualification)}</td>
      <td>${enquiryStatusBadge(item.status)}</td>
      <td style="text-align:right;">${actionButtons('enquiry', item.id, item)}</td>
    </tr>
  `).join(''), 'No enquiries found.', 6, '#/enquiries-add', 'Add Enquiry');
}

function hydrateStudents(root: HTMLElement, payload: unknown) {
  const students = findArray(payload, ['students']);
  cacheRows('student', students);
  debugPageState('students/list.html', 'mapped data', { count: students.length, students });
  updateFirstLabel(root, 'Total Records:', `Total Records: ${findNumber(payload, ['total', 'count'], students.length)}`);
  renderRows(root, students.map((item) => `
    <tr>
      <td style="font-weight:600;color:var(--text-primary);">${valueText(item.enrollment_number)}</td>
      <td><div style="font-weight:600;color:var(--text-primary);">${valueText(item.name)}</div><span class="label-meta">${valueText(item.mobile1)}</span></td>
      <td>${valueText(item.course)}<br><span class="label-meta">${valueText(item.batch)}</span></td>
      <td><span class="badge ${feeStatusBadgeClass(item.fee_status)}">${valueText(item.fee_status)}</span></td>
      <td>${formatCurrency(item.balance)}</td>
      <td style="text-align:right;">${actionButtons('student', item.id, item)}</td>
    </tr>
  `).join(''), 'No records found.', 6, '#/students-add', 'Add Student');
}

function hydrateBatches(root: HTMLElement, payload: unknown) {
  const batches = findArray(payload, ['batches']);
  cacheRows('batch', batches);
  debugPageState('batches/list.html', 'mapped data', { count: batches.length, batches });
  renderRows(root, batches.map((item) => `
    <tr>
      <td style="font-weight:600;color:var(--text-primary);">${valueText(item.name)}</td>
      <td>${formatScheduleTimeRange(item.start_time, item.end_time)}</td>
      <td><span class="badge ${item.is_active ? 'badge-success' : 'badge-neutral'}">${item.is_active ? 'Active' : 'Inactive'}</span></td>
      <td><span class="label-meta">${valueText(item.student_count ?? 0)} Students</span></td>
      <td style="text-align:right;">${actionButtons('batch', item.id)}</td>
    </tr>
  `).join(''), 'No records found.', 5, '#/batches-add', 'Add Batch');
}

function hydrateCourses(root: HTMLElement, payload: unknown) {
  const courses = findArray(payload, ['courses']);
  cacheRows('course', courses);
  debugPageState('courses/list.html', 'mapped data', { count: courses.length, courses });
  renderRows(root, courses.map((item) => `
    <tr>
      <td style="font-weight:600;color:var(--text-primary);">${valueText(item.name)}</td>
      <td class="label-meta">${valueText(item.description)}</td>
      <td>${valueText(item.duration_months)} Months</td>
      <td>${formatCurrency(item.fees)}</td>
      <td><span class="badge ${item.is_active ? 'badge-success' : 'badge-neutral'}">${item.is_active ? 'Active' : 'Inactive'}</span></td>
      <td style="text-align:right;">${actionButtons('course', item.id)}</td>
    </tr>
  `).join(''), 'No records found.', 6, '#/courses-add', 'Add Course');
}

function hydrateSchemes(root: HTMLElement, payload: unknown) {
  const schemes = findArray(payload, ['schemes']);
  cacheRows('scheme', schemes);
  debugPageState('schemes/list.html', 'mapped data', { count: schemes.length, schemes });
  renderRows(root, schemes.map((item) => `
    <tr>
      <td style="font-weight:600;color:var(--text-primary);">${valueText(item.name)}</td>
      <td class="label-meta">${valueText(item.description)}</td>
      <td><span class="badge badge-success">${valueText(item.discount_percentage)}% Off</span></td>
      <td><span class="badge ${item.is_active ? 'badge-success' : 'badge-neutral'}">${item.is_active ? 'Active' : 'Inactive'}</span></td>
      <td style="text-align:center;font-weight:600;">0</td>
      <td style="text-align:right;">${actionButtons('scheme', item.id)}</td>
    </tr>
  `).join(''), 'No records found.', 6, '#/schemes-add', 'Add Scheme');
}

function hydrateStaff(root: HTMLElement, payload: unknown) {
  const staff = findArray(payload, ['staff', 'staff_members']);
  cacheRows('staff', staff);
  debugPageState('staff/list.html', 'mapped data', { count: staff.length, staff });
  staffShell(root, 'Staff Management', `Total Records: ${staff.length}`, 'Staff List', `
    <div class="card" style="padding:0;overflow:hidden;">
      <table class="table">
        <thead>
          <tr>
            <th>Staff Details</th>
            <th>Role</th>
            <th>Batches Assigned</th>
            <th>Status</th>
            <th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${staff.length ? staff.map((item) => `
            <tr>
              <td><div style="font-weight:600;color:var(--text-primary);">${valueText(item.name)}</div><span class="label-meta">${valueText(item.email)}</span></td>
              <td>${valueText(item.role)}</td>
              <td>${Array.isArray(item.batches) ? item.batches.length : 0}</td>
              <td><span class="badge ${item.is_active ? 'badge-success' : 'badge-neutral'}">${item.is_active ? 'Active' : 'Inactive'}</span></td>
              <td style="text-align:right;">${actionButtons('staff', item.id)}</td>
            </tr>
          `).join('') : staffEmpty(5, 'No records found.')}
        </tbody>
      </table>
    </div>
  `, `
    <a href="#/staff-add" class="btn btn-primary"><i data-lucide="plus"></i><span>Add Staff</span></a>
  `);
}

const staffPageShellMeta: Record<string, { title: string; subtitle: string; active: string }> = {
  'staff/list.html': {
    title: 'Staff Management',
    subtitle: 'Manage staff profiles, roles, and batch assignments',
    active: 'Staff List',
  },
  'staff/dashboard.html': {
    title: 'Staff Dashboard',
    subtitle: 'Overview of staff attendance and activity for today',
    active: 'Dashboard',
  },
  'staff/attendance_list.html': {
    title: 'Staff Attendance',
    subtitle: 'Review staff check-ins and attendance approvals',
    active: 'Attendance',
  },
  'staff/leave_requests.html': {
    title: 'Staff Leave Requests',
    subtitle: 'Review and manage leave applications from staff',
    active: 'Leave Requests',
  },
  'staff/corrections.html': {
    title: 'Attendance Corrections',
    subtitle: 'Review and resolve attendance regularization requests from staff',
    active: 'Corrections',
  },
  'staff/reports.html': {
    title: 'Staff Reports',
    subtitle: 'Monthly staff attendance summary',
    active: 'Reports',
  },
};

function renderStaffPageShell(root: HTMLElement, templatePath: string) {
  const meta = staffPageShellMeta[templatePath];
  if (!meta) return;
  staffShell(root, meta.title, meta.subtitle, meta.active, `
    <div class="card" style="padding:48px;text-align:center;">
      <span class="template-spinner"></span>
      <p class="label-meta" style="margin-top:16px;">Loading staff data...</p>
    </div>
  `);
}

const staffTabs = [
  ['Dashboard', '#/staff-dashboard'],
  ['Staff List', '#/staff-list'],
  ['Attendance', '#/staff-attendance_list'],
  ['Leave Requests', '#/staff-leave_requests'],
  ['Corrections', '#/staff-corrections'],
  ['Reports', '#/staff-reports'],
] as const;

function staffTabsHtml(active: string) {
  return `
    <div class="staff-tabs">
      ${staffTabs.map(([label, href]) => `
        <a href="${href}" class="staff-tab ${label === active ? 'active' : ''}">${label}</a>
      `).join('')}
    </div>
  `;
}

function staffShell(root: HTMLElement, title: string, subtitle: string, active: string, body: string, actions = '') {
  root.innerHTML = `
    <div class="staff-page" data-live-content="true">
      <div class="flex justify-between items-center staff-page-header">
        <div>
          <h1 class="page-title">${title}</h1>
          <p class="label-meta">${subtitle}</p>
        </div>
        ${actions ? `<div class="flex gap-8">${actions}</div>` : ''}
      </div>
      <div class="p-32" style="padding-top:0;">
        ${staffTabsHtml(active)}
        ${body}
      </div>
    </div>
  `;
}

function staffBadge(status: unknown) {
  const text = valueText(status || 'Pending');
  const lower = text.toLowerCase();
  const cls = lower.includes('approved') || lower.includes('present') ? 'badge-success' : lower.includes('reject') || lower.includes('absent') ? 'badge-error' : 'badge-warning';
  return `<span class="badge ${cls}">${text}</span>`;
}

function staffEmpty(colspan: number, message = 'No records found.') {
  return `<tr><td colspan="${colspan}" style="text-align:center;padding:48px;color:var(--text-muted);">${message}</td></tr>`;
}

function hydrateStaffDashboard(root: HTMLElement, payload: unknown) {
  const data = findRecord(payload, ['data']) || asRecord(payload);
  const cards = [
    ['users', 'Total Staff', data.total_staff || 0, 'var(--accent-light)', 'var(--accent)'],
    ['user-check', 'Present Today', data.present_today || 0, '#ECFDF5', '#10B981'],
    ['user-x', 'Absent Today', data.absent_today || 0, '#FEF2F2', '#EF4444'],
    ['calendar-off', 'Leave Requests Pending', data.pending_leaves || 0, '#FFF7ED', '#F59E0B'],
    ['clock', 'Active Batches Assigned', data.active_batches || 0, '#F5F3FF', '#8B5CF6'],
  ];
  staffShell(root, 'Staff Dashboard', 'Overview of staff attendance and activity for today', 'Dashboard', `
    <div class="staff-stat-grid">
      ${cards.map(([icon, label, count, bg, color]) => `
        <div class="card staff-stat-card">
          <div class="staff-stat-icon" style="background:${bg};color:${color};"><i data-lucide="${icon}"></i></div>
          <h2 style="color:${color === 'var(--accent)' ? 'var(--text-primary)' : color};">${valueText(count)}</h2>
          <p class="label-meta">${label}</p>
        </div>
      `).join('')}
    </div>
    <div class="card staff-overview-card">
      <i data-lucide="layout-dashboard" style="width:48px;height:48px;color:var(--accent);opacity:.25;margin-bottom:16px;"></i>
      <h3 class="card-title">Staff Overview</h3>
      <p class="label-meta" style="margin-bottom:24px;">Use the tabs above to manage staff attendance, leave requests, and correction workflows.</p>
      <div class="flex justify-center gap-16">
        <a href="#/staff-attendance_list" class="btn btn-primary"><i data-lucide="calendar-check"></i><span>View Today's Attendance</span></a>
        <a href="#/staff-leave_requests" class="btn btn-secondary"><i data-lucide="calendar-off"></i><span>Review Leave Requests</span></a>
      </div>
    </div>
  `, `
    <a href="#/staff-list" class="btn btn-secondary"><i data-lucide="users"></i><span>Staff List</span></a>
    <a href="#/staff-add" class="btn btn-primary"><i data-lucide="plus"></i><span>Add Staff</span></a>
  `);
}

function hydrateStaffAttendance(root: HTMLElement, payload: unknown) {
  const rows = findArray(payload, ['attendances', 'attendance']);
  staffShell(root, 'Staff Attendance', 'Review staff check-ins and attendance approvals', 'Attendance', `
    <div class="card" style="padding:0;overflow:hidden;">
      <table class="table">
        <thead><tr><th>Staff Details</th><th>Date</th><th>Check-In</th><th>Check-Out</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((row) => `
            <tr>
              <td><div style="font-weight:700;color:var(--text-primary);">${valueText(row.staff_name)}</div><span class="label-meta">${valueText(row.staff_role)}</span></td>
              <td style="font-weight:600;color:var(--text-primary);">${valueText(row.date)}</td>
              <td>${formatAttendanceTime(row.check_in_time, { date: row.date })}</td>
              <td>${formatAttendanceTime(row.check_out_time, { date: row.date })}</td>
              <td>${staffBadge(row.status)}${row.rejection_reason ? `<div class="label-meta" style="font-size:10px;margin-top:4px;color:var(--danger);">Reason: ${valueText(row.rejection_reason)}</div>` : ''}</td>
              <td style="text-align:right;">
                ${String(row.status || '').toLowerCase().includes('pending') ? `
                  <div class="flex justify-end gap-8">
                    <button type="button" class="btn btn-primary btn-xs" data-crud-action="status" data-module="staff-attendance" data-status="Approved" data-id="${valueText(row.id)}"><i data-lucide="check"></i><span>Approve</span></button>
                    <button type="button" class="btn btn-secondary btn-xs" data-crud-action="status" data-module="staff-attendance" data-status="Rejected" data-id="${valueText(row.id)}"><i data-lucide="x"></i><span>Reject</span></button>
                  </div>
                ` : '<span class="label-meta">Reviewed</span>'}
              </td>
            </tr>
          `).join('') : staffEmpty(6)}
        </tbody>
      </table>
    </div>
  `);
}

function hydrateStaffLeaveRequests(root: HTMLElement, payload: unknown) {
  const rows = findArray(payload, ['leave_requests', 'leaves']);
  staffShell(root, 'Staff Leave Requests', 'Review and manage leave applications from staff', 'Leave Requests', `
    <div class="card" style="padding:0;overflow:hidden;">
      <table class="table">
        <thead><tr><th>Staff Details</th><th>Leave Period</th><th>Reason</th><th>Applied On</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((row) => `
            <tr>
              <td><div style="font-weight:700;color:var(--text-primary);">${valueText(row.staff_name)}</div><span class="label-meta">${valueText(row.staff_role)}</span></td>
              <td><div style="font-weight:600;color:var(--text-primary);">${valueText(row.start_date)} to ${valueText(row.end_date)}</div><span class="label-meta">${valueText(row.days || 0)} Day(s)</span></td>
              <td style="max-width:280px;color:var(--text-secondary);">${valueText(row.reason)}</td>
              <td class="label-meta">${valueText(row.created_at).replace('T', ' ')}</td>
              <td>${staffBadge(row.status)}</td>
              <td style="text-align:right;">
                ${String(row.status || '').toLowerCase() === 'pending' ? `
                  <div class="flex justify-end gap-8">
                    <button type="button" class="btn btn-primary btn-xs" data-crud-action="status" data-module="staff-leave" data-status="Approved" data-id="${valueText(row.id)}"><i data-lucide="check"></i><span>Approve</span></button>
                    <button type="button" class="btn btn-secondary btn-xs" data-crud-action="status" data-module="staff-leave" data-status="Rejected" data-id="${valueText(row.id)}"><i data-lucide="x"></i><span>Reject</span></button>
                  </div>
                ` : '<span class="label-meta">Reviewed</span>'}
              </td>
            </tr>
          `).join('') : staffEmpty(6)}
        </tbody>
      </table>
    </div>
  `);
}

function hydrateStaffCorrections(root: HTMLElement, payload: unknown) {
  const rows = findArray(payload, ['corrections', 'requests']);
  staffShell(root, 'Attendance Corrections', 'Review and resolve attendance regularization requests from staff', 'Corrections', `
    <div class="card" style="padding:0;overflow:hidden;">
      <table class="table">
        <thead><tr><th>Staff Details</th><th>Date & Type</th><th>Requested Check-In</th><th>Requested Check-Out</th><th>Reason</th><th>Status</th><th style="text-align:right;">Actions</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((row) => `
            <tr>
              <td><div style="font-weight:700;color:var(--text-primary);">${valueText(row.staff_name)}</div><span class="label-meta">${valueText(row.staff_role)}</span></td>
              <td><div style="font-weight:600;color:var(--text-primary);">${valueText(row.date)}</div><span class="label-meta" style="color:var(--accent);font-weight:700;">${valueText(row.correction_type)}</span></td>
              <td>${formatAttendanceDateTime(row.requested_check_in, { date: row.date })}</td>
              <td>${formatAttendanceDateTime(row.requested_check_out, { date: row.date })}</td>
              <td style="max-width:220px;color:var(--text-secondary);">${valueText(row.reason)}</td>
              <td>${staffBadge(row.status)}${row.reviewed_by_note ? `<div class="label-meta" style="font-size:10px;margin-top:4px;">Note: ${valueText(row.reviewed_by_note)}</div>` : ''}</td>
              <td style="text-align:right;">
                ${String(row.status || '').toLowerCase() === 'pending' ? `
                  <div class="flex justify-end gap-8">
                    <button type="button" class="btn btn-primary btn-xs" data-crud-action="status" data-module="staff-correction" data-status="Approved" data-id="${valueText(row.id)}"><i data-lucide="check"></i><span>Approve</span></button>
                    <button type="button" class="btn btn-secondary btn-xs" data-crud-action="status" data-module="staff-correction" data-status="Rejected" data-id="${valueText(row.id)}"><i data-lucide="x"></i><span>Reject</span></button>
                  </div>
                ` : '<span class="label-meta">Resolved</span>'}
              </td>
            </tr>
          `).join('') : staffEmpty(7)}
        </tbody>
      </table>
    </div>
  `);
}

function hydrateStaffReports(root: HTMLElement, payload: unknown) {
  const rows = findArray(payload, ['attendance_summary']);
  const monthLabel = valueText(asRecord(payload).month_label || findRecord(payload, ['data']).month_label);
  staffShell(root, 'Staff Reports', `Monthly staff attendance summary${monthLabel !== '-' ? ` for ${monthLabel}` : ''}`, 'Reports', `
    <div class="card" style="padding:0;overflow:hidden;">
      <table class="table">
        <thead><tr><th>Staff</th><th>Present</th><th>Half Day</th><th>Absent</th><th>Rejected</th><th>Total</th></tr></thead>
        <tbody>
          ${rows.length ? rows.map((row) => `
            <tr>
              <td><div style="font-weight:700;color:var(--text-primary);">${valueText(row.staff_name || asRecord(row.staff).name)}</div></td>
              <td><span class="badge badge-success">${valueText(row.present || 0)}</span></td>
              <td><span class="badge badge-warning">${valueText(row.half_day || 0)}</span></td>
              <td><span class="badge badge-error">${valueText(row.absent || 0)}</span></td>
              <td><span class="badge badge-error">${valueText(row.rejected || 0)}</span></td>
              <td style="font-weight:700;color:var(--text-primary);">${valueText(row.total || 0)}</td>
            </tr>
          `).join('') : staffEmpty(6)}
        </tbody>
      </table>
    </div>
  `);
}

function readHashQueryParam(name: string) {
  const query = window.location.hash.includes('?') ? window.location.hash.split('?')[1] : '';
  return new URLSearchParams(query).get(name);
}

function loadExternalScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

async function hydrateSubscriptionPayment(root: HTMLElement) {
  const planId = readHashQueryParam('plan_id');
  if (!planId) {
    showPageError(root, 'No plan selected.', () => {
      window.location.hash = '#/subscription-plans';
    });
    return;
  }

  const payload = await desktopApiRequest<Record<string, unknown>>('/subscription/payment-session', 'POST', {
    plan_id: Number(planId),
  });
  const plan = findRecord(payload, ['plan']);
  const order = findRecord(payload, ['order']);
  const user = findRecord(payload, ['user']);

  if (payload.activated) {
    showActionToast(root, valueText(payload.message || 'Plan activated successfully.'));
    window.location.hash = '#/subscription-plans';
    return;
  }

  root.setAttribute('data-live-content', 'true');
  const planNameNode = root.querySelector('[data-payment-plan-name]');
  const durationNode = root.querySelector('[data-payment-duration]');
  const totalNode = root.querySelector('[data-payment-total]');
  if (planNameNode) planNameNode.textContent = valueText(plan.name);
  if (durationNode) durationNode.textContent = formatPlanBillingPeriod(plan);
  if (totalNode) totalNode.textContent = formatCurrency(plan.price);

  const button = root.querySelector<HTMLButtonElement>('#rzp-button');
  if (!button) return;

  await loadExternalScript('https://checkout.razorpay.com/v1/checkout.js');
  button.onclick = () => {
    const terms = root.querySelector<HTMLInputElement>('#termsCheck');
    if (terms && !terms.checked) {
      showActionToast(root, 'Please agree to the terms and conditions.', 'error');
      return;
    }

    const originalHtml = button.innerHTML;
    button.innerHTML = '<span class="template-spinner"></span><span>Redirecting...</span>';
    button.disabled = true;

    const options = {
      key: valueText(payload.razorpay_key || order.key),
      amount: Number(order.amount || Math.round(Number(plan.price || 0) * 100)),
      currency: valueText(order.currency || 'INR'),
      name: 'Lerzo SaaS',
      description: `Subscription: ${valueText(plan.name)}`,
      order_id: valueText(order.id),
      handler: async (response: Record<string, unknown>) => {
        try {
          await desktopApiRequest<Record<string, unknown>>('/subscription/verify-payment', 'POST', {
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_signature: response.razorpay_signature,
            plan_id: Number(planId),
          });
          window.dispatchEvent(new CustomEvent('lerzo-subscription-updated'));
          window.location.hash = '#/subscription-success';
        } catch (error) {
          button.disabled = false;
          button.innerHTML = originalHtml;
          showActionToast(root, extractApiErrorMessage(error, 'Payment verification failed.'), 'error');
        }
      },
      prefill: {
        name: valueText(user.name),
        email: valueText(user.email),
      },
      theme: { color: '#2563EB' },
      modal: {
        ondismiss: () => {
          button.disabled = false;
          button.innerHTML = originalHtml;
        },
      },
    };

    const RazorpayCtor = (window as typeof window & { Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (event: string, cb: () => void) => void } }).Razorpay;
    if (!RazorpayCtor) {
      showActionToast(root, 'Payment gateway could not be loaded.', 'error');
      button.disabled = false;
      button.innerHTML = originalHtml;
      return;
    }

    const checkout = new RazorpayCtor(options);
    checkout.on('payment.failed', () => {
      showActionToast(root, 'Payment failed. Please try again.', 'error');
      button.disabled = false;
      button.innerHTML = originalHtml;
    });
    checkout.open();
  };
}

function hydrateSubscription(root: HTMLElement, payload: unknown) {
  const plans = findArray(payload, ['plans', 'subscription_plans']);
  const subscription = findRecord(payload, ['subscription', 'current_subscription']);
  const activePlanId = asRecord(payload).active_plan_id ?? subscription.active_plan_id;
  debugPageState('subscription/plans.html', 'mapped data', { count: plans.length, plans, subscription, activePlanId });
  removeGeneratedEmptyBlocks(root);
  const grid = root.querySelector<HTMLElement>('#plans-grid');
  if (!grid) return;

  const isCurrentPlan = (plan: Record<string, unknown>) => {
    if (activePlanId !== null && activePlanId !== undefined && activePlanId !== '') {
      return String(plan.id) === String(activePlanId);
    }
    const currentName = valueText(subscription.plan_name || subscription.current_plan || '').toLowerCase();
    const planName = valueText(plan.name).toLowerCase();
    return currentName !== '-' && currentName !== '' && currentName === planName;
  };

  grid.innerHTML = plans.length ? plans.map((plan) => {
    const isFree = Number(plan.price || 0) <= 0;
    const trialUsed = Boolean(subscription.trial_used);
    const isCurrent = isCurrentPlan(plan);
    const showPopularBadge = valueText(plan.name).toLowerCase().includes('monthly');
    const featureItems = resolvePlanFeatureItems(plan);
    const buttonLabel = isCurrent
      ? (isFree && trialUsed ? 'Free Plan Used' : 'Current Plan')
      : isFree
        ? (trialUsed ? 'Free Plan Used' : 'Start Free Trial')
        : 'Subscribe Now';
    return `
    <div class="card ${isCurrent ? 'current-plan' : ''} ${showPopularBadge ? 'featured-plan' : ''}" data-live-content="true" style="display:flex;flex-direction:column;padding:40px 32px;position:relative;min-height:540px;">
      ${showPopularBadge ? '<div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--accent);color:white;padding:4px 16px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.05em;white-space:nowrap;">MOST POPULAR</div>' : ''}
      ${isCurrent ? '<div style="position:absolute;top:16px;right:16px;"><span class="badge badge-success">Current Plan</span></div>' : ''}
      <div style="text-align:center;margin-bottom:32px;">
        <h3 style="font-size:18px;font-weight:700;color:var(--text-primary);margin-bottom:16px;">${valueText(plan.name)}</h3>
        <div style="font-size:40px;font-weight:800;color:var(--text-primary);">${formatCurrency(plan.price)}</div>
        <p class="label-meta">per ${formatPlanBillingPeriod(plan)}</p>
      </div>
      <div style="flex:1;margin-bottom:32px;">
        <ul class="plan-features">
          ${featureItems.map((feature) => `
            <li style="display:flex;align-items:center;gap:12px;">
              <i data-lucide="check-circle-2" style="width:18px;height:18px;color:var(--success);flex-shrink:0;"></i>
              <span style="font-size:14px;color:var(--text-secondary);">${valueText(feature)}</span>
            </li>
          `).join('')}
        </ul>
      </div>
      <button type="button" class="btn btn-primary w-full justify-center ${isCurrent ? '' : isFree && trialUsed ? 'opacity-50 cursor-not-allowed' : ''}" style="height:48px;margin-top:auto;${isCurrent ? 'opacity:0.85;cursor:default;' : ''}" data-plan-id="${valueText(plan.id)}" ${isCurrent || (isFree && trialUsed) ? 'disabled' : ''}>
        <span>${buttonLabel}</span>
      </button>
    </div>
  `; }).join('') : `
    <div style="grid-column:1 / -1;text-align:center;padding:64px;">
      <i data-lucide="info" style="width:48px;height:48px;color:var(--text-muted);opacity:0.3;margin-bottom:16px;"></i>
      <p class="text-secondary">No plans available at the moment. Please contact support.</p>
    </div>
  `;

  const overview = root.querySelector<HTMLElement>('#overview-grid');
  if (overview) {
    overview.innerHTML = `
      <div class="card">
        <p class="label-meta" style="margin-bottom:8px;">CURRENT PLAN</p>
        <h3 style="font-size:18px;font-weight:700;color:var(--accent);">${valueText(subscription.plan_name || subscription.current_plan || subscription.plan_type || 'Free Trial')}</h3>
      </div>
      <div class="card">
        <p class="label-meta" style="margin-bottom:8px;">EXPIRY DATE</p>
        <h3 style="font-size:18px;font-weight:700;color:var(--text-primary);">${valueText(subscription.expiry_date || 'No Expiry')}</h3>
      </div>
      <div class="card">
        <p class="label-meta" style="margin-bottom:8px;">STATUS</p>
        <div style="display:flex;align-items:center;">
          <span class="badge ${String(subscription.status || subscription.subscription_status || '').toLowerCase().includes('active') || String(subscription.status || '').toLowerCase().includes('trial') ? 'badge-success' : 'badge-error'}" style="padding:6px 16px;font-size:13px;">
            ${valueText(subscription.status || subscription.subscription_status || 'Inactive')}
          </span>
        </div>
      </div>
    `;
  }
}

function hydrateNotifications(root: HTMLElement, payload: unknown) {
  const notifications = findArray(payload, ['notifications']);
  debugPageState('notifications/index.html', 'mapped data', { count: notifications.length, notifications });
  const win = window as typeof window & { __lerzoNotificationIds?: Set<string> };
  const currentIds = new Set(notifications.map((notification) => String(notification.id)).filter(Boolean));
  const previousIds = win.__lerzoNotificationIds;
  const newUnread = notifications.find((notification) => !notification.is_read && previousIds && !previousIds.has(String(notification.id)));
  if (newUnread) {
    showActionToast(root, `${valueText(newUnread.title)}: ${valueText(newUnread.message)}`);
    playNotificationSound();
  }
  win.__lerzoNotificationIds = currentIds;
  const container = Array.from(root.querySelectorAll<HTMLElement>('.space-y-4, .text-center.py-24')).find((node) => (
    node.textContent?.includes('No notifications') || Boolean(node.querySelector('h2, .font-semibold'))
  ));
  if (!container) return;
  container.className = notifications.length ? 'space-y-4' : 'text-center py-24 text-gray-500';
  container.innerHTML = notifications.length ? notifications.map((notification) => `
    <div class="p-4 rounded-2xl border border-gray-200 ${notification.is_read ? '' : 'bg-slate-50'}">
      <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div class="min-w-0">
          <h2 class="font-semibold text-gray-900">${valueText(notification.title)}</h2>
          <p class="text-sm text-gray-600 mt-2">${valueText(notification.message)}</p>
          <p class="text-xs text-gray-500 mt-3">Staff: <span class="font-semibold text-gray-700">${valueText(notification.staff_name)}</span>${notification.staff_phone && notification.staff_phone !== 'N/A' ? ` • ${valueText(notification.staff_phone)}` : ''}</p>
        </div>
        <div class="text-right">
          <div class="text-xs text-gray-500">${valueText(notification.created_at).replace('T', ' ')}</div>
          <div class="mt-2 inline-flex items-center gap-2 text-xs font-semibold ${notification.is_read ? 'text-emerald-700' : 'text-amber-700'}">
            <span class="inline-flex h-2.5 w-2.5 rounded-full ${notification.is_read ? 'bg-emerald-500' : 'bg-amber-500'}"></span>
            ${notification.is_read ? 'Read' : 'Unread'}
          </div>
        </div>
      </div>
      ${notification.is_read ? '' : `
        <div class="mt-4 text-right">
          <button type="button" class="btn btn-secondary" data-crud-action="read" data-module="notification" data-id="${valueText(notification.id)}">Mark Read</button>
        </div>
      `}
    </div>
  `).join('') : `
    <i data-lucide="bell-off" class="w-14 h-14 mx-auto mb-4"></i>
    <p class="text-lg font-medium">No notifications yet.</p>
    <p class="mt-2 text-sm text-gray-500">All notifications for this centre will appear here.</p>
  `;
}

async function hydrateReports(root: HTMLElement) {
  const results = await Promise.allSettled([
    desktopApiGet('/reports/students'),
    desktopApiGet('/reports/fees'),
    desktopApiGet('/reports/enquiries'),
    desktopApiGet('/reports/batches'),
  ]);
  const [students, fees, enquiries, batches] = results.map((result) => (
    result.status === 'fulfilled' ? result.value : { success: false, error: result.reason }
  ));
  debugPageState('reports/index.html', 'mapped data', { students, fees, enquiries, batches });

  const routeByTitle: Record<string, string> = {
    'Student Reports': '#/reports-students',
    'Financial Reports': '#/reports-fees',
    'Enquiry Analytics': '#/reports-enquiries',
    'Batch Reports': '#/reports-batches',
    'Export Center': '#/exports-options',
    'Staff Management': '#/staff-list',
  };

  root.querySelectorAll<HTMLElement>('.card').forEach((card) => {
    const title = card.querySelector('h2')?.textContent?.trim();
    const href = title ? routeByTitle[title] : undefined;
    const link = href ? card.querySelector<HTMLAnchorElement>('a') : null;
    if (link) link.href = href;
  });

  root.querySelector('[data-report-export-image="true"]')?.remove();
}

function setCardNumbers(root: HTMLElement, values: unknown[]) {
  root.querySelectorAll<HTMLElement>('.card > h2, .card h2').forEach((node, index) => {
    if (index < values.length) node.textContent = valueText(values[index]);
  });
}

function hydrateStudentReport(root: HTMLElement, payload: unknown) {
  const summary = findRecord(payload, ['summary', 'stats', 'students']);
  const courseRows = findArray(payload, ['course_distribution', 'courses', 'course_stats']);
  setCardNumbers(root, [
    valueFrom(summary, ['total_students', 'total', 'count']),
    valueFrom(summary, ['fully_paid', 'paid_students', 'paid']),
    valueFrom(summary, ['partially_paid', 'partial_students', 'partial']),
    valueFrom(summary, ['unpaid', 'unpaid_students']),
  ]);

  const table = root.querySelector<HTMLTableSectionElement>('table tbody');
  if (table) {
    table.innerHTML = courseRows.length ? courseRows.map((row) => `
      <tr>
        <td style="font-weight: 500;">${valueText(row.course_name || row.name || row.course)}</td>
        <td style="text-align: right; font-weight: 600; color: var(--accent);">${valueText(row.students || row.student_count || row.count || 0)}</td>
      </tr>
    `).join('') : emptyRow(2, 'No course distribution data available');
  }
}

function hydrateFeesReport(root: HTMLElement, payload: unknown) {
  const summary = findRecord(payload, ['summary', 'fees', 'report']);
  const collections = findArray(payload, ['monthly_collections', 'collections', 'months', 'items']);
  setCardNumbers(root, [
    formatCurrency(valueFrom(summary, ['total_net_fees', 'net_fees', 'total_fees'])),
    formatCurrency(valueFrom(summary, ['collected_fees', 'total_collected', 'collected'])),
    formatCurrency(valueFrom(summary, ['pending_balances', 'pending_fees', 'pending'])),
  ]);

  const table = root.querySelector<HTMLTableSectionElement>('table tbody');
  if (table) {
    table.innerHTML = collections.length ? collections.map((row) => `
      <tr>
        <td style="font-weight: 500;">${valueText(row.month || row.label || row.period)}</td>
        <td style="text-align: right; font-weight: 600; color: var(--success);">${formatCurrency(row.collection_amount || row.amount || row.total || 0)}</td>
      </tr>
    `).join('') : emptyRow(2, 'No collection data available');
  }
}

function hydrateEnquiriesReport(root: HTMLElement, payload: unknown) {
  const summary = findRecord(payload, ['summary', 'stats', 'enquiries']);
  const total = Number(valueFrom(summary, ['total_enquiries', 'total', 'count'], 0));
  const converted = Number(valueFrom(summary, ['converted', 'converted_enquiries'], 0));
  const conversionRate = total > 0 ? Math.round((converted / total) * 100) : Number(valueFrom(summary, ['conversion_rate'], 0));
  setCardNumbers(root, [
    valueFrom(summary, ['total_enquiries', 'total', 'count']),
    valueFrom(summary, ['active_enquiries', 'active']),
    valueFrom(summary, ['converted', 'converted_enquiries']),
  ]);

  const rateNode = Array.from(root.querySelectorAll<HTMLElement>('span')).find((node) => node.textContent?.includes('%'));
  if (rateNode) rateNode.textContent = `${conversionRate}%`;
  const bar = Array.from(root.querySelectorAll<HTMLElement>('div')).find((node) => node.style.background === 'var(--success)' || node.getAttribute('style')?.includes('background: var(--success)'));
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, conversionRate))}%`;
}

function hydrateBatchesReport(root: HTMLElement, payload: unknown) {
  const batches = findArray(payload, ['batches', 'batch_reports', 'items']);
  const table = root.querySelector<HTMLTableSectionElement>('table tbody');
  if (!table) return;
  table.innerHTML = batches.length ? batches.map((batch) => `
    <tr>
      <td style="font-weight: 600; color: var(--text-primary);">${valueText(batch.name || batch.batch_name)}</td>
      <td class="label-meta">${formatBatchScheduleTiming(batch.timing, batch.start_time, batch.end_time)}</td>
      <td style="text-align: center;"><span class="badge ${batch.is_active === false ? 'badge-error' : 'badge-success'}">${batch.is_active === false ? 'Inactive' : 'Active'}</span></td>
      <td style="text-align: right; font-weight: 700; color: var(--accent);">${valueText(batch.students || batch.student_count || batch.enrolled_students || 0)}</td>
    </tr>
  `).join('') : emptyRow(4, 'No batch data available', '#/batches-add', 'Add First Batch');
}

function installExportsOptionsBridge(root: HTMLElement) {
  if (root.dataset.exportsBridgeInstalled === 'true') return;
  root.dataset.exportsBridgeInstalled = 'true';

  const updateExportFilters = (type: string) => {
    const studentFilters = root.querySelector<HTMLElement>('#studentFilters');
    const enquiryFilters = root.querySelector<HTMLElement>('#enquiryFilters');
    const otherFields = root.querySelector<HTMLElement>('#otherFields');
    if (studentFilters) studentFilters.style.display = type === 'students' ? 'block' : 'none';
    if (enquiryFilters) enquiryFilters.style.display = type === 'enquiries' ? 'block' : 'none';
    if (otherFields) otherFields.style.display = (type === 'students' || type === 'enquiries') ? 'none' : 'block';
  };

  root.querySelectorAll<HTMLImageElement>('img[alt="Export Data"], img[alt="Data Management"]').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!src || src === '#' || src.endsWith('#')) {
      img.src = EXPORT_ILLUSTRATION_SRC;
    }
  });

  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const tab = target.closest<HTMLElement>('.tab-item[data-tab]');
    if (tab) {
      event.preventDefault();
      const targetId = tab.dataset.tab;
      if (!targetId) return;
      root.querySelectorAll('.tab-item').forEach((node) => node.classList.remove('active'));
      root.querySelectorAll('.tab-content').forEach((node) => node.classList.remove('active'));
      tab.classList.add('active');
      root.querySelector(`#${targetId}`)?.classList.add('active');
      return;
    }

    const typeCard = target.closest<HTMLElement>('.type-card[data-type]');
    if (typeCard) {
      event.preventDefault();
      root.querySelectorAll('.type-card').forEach((node) => node.classList.remove('selected'));
      typeCard.classList.add('selected');
      const exportTypeInput = root.querySelector<HTMLInputElement>('#exportType');
      const type = typeCard.dataset.type || 'students';
      if (exportTypeInput) exportTypeInput.value = type;
      updateExportFilters(type);
      return;
    }

    const formatCard = target.closest<HTMLElement>('.format-card[data-format]');
    if (formatCard) {
      event.preventDefault();
      root.querySelectorAll('.format-card').forEach((node) => node.classList.remove('selected'));
      formatCard.classList.add('selected');
      const exportFormatInput = root.querySelector<HTMLInputElement>('#exportFormat');
      if (exportFormatInput) exportFormatInput.value = formatCard.dataset.format || 'excel';
      return;
    }

    const importCard = target.closest<HTMLElement>('.import-type-card[data-import]');
    if (importCard) {
      event.preventDefault();
      root.querySelectorAll('.import-type-card').forEach((node) => node.classList.remove('selected'));
      importCard.classList.add('selected');
      const importTypeInput = root.querySelector<HTMLInputElement>('#importType');
      if (importTypeInput) importTypeInput.value = importCard.dataset.import || 'students';
    }
  });

  const dropZone = root.querySelector<HTMLElement>('#dropZone');
  const fileInput = root.querySelector<HTMLInputElement>('#fileInput');
  const fileNameDisplay = root.querySelector<HTMLElement>('#fileNameDisplay');
  const showSelectedFile = () => {
    if (fileInput?.files?.length && fileNameDisplay) {
      fileNameDisplay.textContent = `Selected: ${fileInput.files[0].name}`;
      fileNameDisplay.style.display = 'block';
    }
  };

  if (dropZone && fileInput) {
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', showSelectedFile);
    dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropZone.classList.remove('dragover');
      const files = event.dataTransfer?.files;
      if (!files?.length) return;
      fileInput.files = files;
      showSelectedFile();
    });
  }

  updateExportFilters(root.querySelector<HTMLInputElement>('#exportType')?.value || 'students');
}

function hydrateExportsOptions(root: HTMLElement) {
  const grid = root.querySelector<HTMLElement>('.type-card[data-type="courses"]')?.parentElement;
  if (grid && !root.querySelector('.type-card[data-type="staff"]')) {
    grid.insertAdjacentHTML('beforeend', `
      <div class="type-card" data-type="staff">
        <i data-lucide="briefcase"></i>
        <span>Staff</span>
      </div>
    `);
  }
  const importGrid = root.querySelector<HTMLElement>('.import-type-card[data-import="enquiries"]')?.parentElement;
  if (importGrid && !root.querySelector('.import-type-card[data-import="courses"]')) {
    importGrid.insertAdjacentHTML('beforeend', `
      <div class="import-type-card" data-import="courses">
        <i data-lucide="book"></i>
        <span>Courses</span>
      </div>
      <div class="import-type-card" data-import="batches">
        <i data-lucide="clock"></i>
        <span>Batches</span>
      </div>
      <div class="import-type-card" data-import="schemes">
        <i data-lucide="tag"></i>
        <span>Schemes</span>
      </div>
      <div class="import-type-card" data-import="staff">
        <i data-lucide="briefcase"></i>
        <span>Staff</span>
      </div>
    `);
  }
  const fileInput = root.querySelector<HTMLInputElement>('#fileInput');
  if (fileInput) fileInput.accept = '.csv';
  const fileHint = Array.from(root.querySelectorAll<HTMLElement>('p.label-meta')).find((node) => node.textContent?.includes('Supports .xlsx'));
  if (fileHint) fileHint.textContent = 'Supports .csv templates downloaded from this page';
  const sample = root.querySelector<HTMLAnchorElement>('#downloadSampleBtn');
  if (sample) sample.href = '#';
  root.querySelectorAll<HTMLFormElement>('#exportForm, #importForm').forEach((form) => {
    form.action = '#';
  });
  installExportsOptionsBridge(root);
}

function resolvedSettingsTheme(): 'light' | 'dark' {
  const pref = getStoredThemePreference();
  if (pref === 'light' || pref === 'dark') return pref;
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function profileReadOnlyField(label: string, value: unknown, span2 = false) {
  const display = valueText(value);
  return `
    <div class="form-group ${span2 ? 'settings-span-2' : ''}">
      <span class="label">${label}</span>
      <div class="settings-value">${display === '-' ? '—' : display}</div>
    </div>
  `;
}

function profileField(label: string, name: string, value: unknown, span2 = false) {
  const record = { [name]: value } as Record<string, unknown>;
  const display = valueText(value);
  const fieldMarkup = name === 'address'
    ? `<textarea class="input settings-profile-field" name="${name}" style="height:80px;padding:12px;" readonly>${formValue(record, name)}</textarea>`
    : `<input class="input settings-profile-field" name="${name}" value="${formValue(record, name)}" readonly />`;
  return `
    <div class="form-group ${span2 ? 'settings-span-2' : ''}">
      <span class="label">${label}</span>
      <div class="settings-value">${display === '-' ? '' : display}</div>
      ${fieldMarkup}
    </div>
  `;
}

function hydrateSettings(root: HTMLElement, payload: unknown) {
  const user = findRecord(payload, ['user', 'account', 'profile']);
  const subscription = findRecord(user, ['subscription']) || findRecord(payload, ['subscription']);
  debugPageState('settings/profile.html', 'mapped data', { user, subscription });
  const theme = resolvedSettingsTheme();
  const planName = valueText(subscription.plan_name || subscription.current_plan || user.plan_type || 'Free Trial');
  const planStatus = valueText(subscription.status || subscription.subscription_status || 'Trial');
  const expiryDate = valueText(subscription.expiry_date || subscription.next_renewal || 'Not set');
  root.innerHTML = `
    <div class="p-32" style="padding-top:0;max-width:920px;margin:0 auto;">
      <div class="settings-panel">
        <div class="settings-panel-header">
          <div>
            <h1 class="page-title">Account Settings</h1>
            <p class="label-meta">Manage your centre profile and appearance preferences.</p>
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <div class="settings-avatar">${user.profile_pic ? `<img src="${valueText(user.profile_pic)}" alt="Profile image" />` : valueText(user.name || user.email || 'A').charAt(0)}</div>
            <button type="button" class="btn btn-secondary" data-settings-edit="true"><i data-lucide="pencil"></i><span>Edit</span></button>
          </div>
        </div>
        <form method="post" class="settings-form" data-editing="false">
          <div class="settings-grid">
            ${profileReadOnlyField('Center Code', user.center_code || user.unique_id)}
            ${profileReadOnlyField('Account ID', user.account_number)}
            ${profileField('Name', 'name', user.name)}
            ${profileField('Email', 'email', user.email)}
            ${profileField('Centre Name', 'center_name', user.center_name)}
            ${profileField('Phone', 'phone', user.phone)}
            ${profileField('Address', 'address', user.address, true)}
            ${profileField('City', 'city', user.city)}
            ${profileField('Pincode', 'pincode', user.pincode)}
          </div>
          <div class="flex justify-end gap-16 settings-edit-actions">
            <button type="button" class="btn btn-secondary" data-settings-cancel="true">Cancel</button>
            <button class="btn btn-primary" type="submit"><i data-lucide="save"></i><span>Save Profile</span></button>
          </div>
        </form>
      </div>

      <div class="settings-panel billing-panel" style="margin-top:24px;">
        <div class="settings-panel-header">
          <div>
            <h2 class="card-title">Billing & Subscription</h2>
            <p class="label-meta">Review your current plan, billing cycle, and payment history.</p>
          </div>
          <button type="button" class="btn btn-primary" data-billing-pay="true"><i data-lucide="credit-card"></i><span>Pay / Upgrade</span></button>
        </div>
        <div class="billing-grid">
          <div class="billing-stat">
            <span class="label">Current Plan</span>
            <strong>${planName}</strong>
          </div>
          <div class="billing-stat">
            <span class="label">Status</span>
            <strong>${planStatus}</strong>
          </div>
          <div class="billing-stat">
            <span class="label">Next Billing Cycle</span>
            <strong>${expiryDate}</strong>
          </div>
        </div>
        <div class="billing-actions">
          <button type="button" class="btn btn-secondary" data-billing-invoices="true"><i data-lucide="file-text"></i><span>View Invoices</span></button>
        </div>
      </div>

      <div class="settings-panel" style="margin-top:24px;">
        <h2 class="card-title">Theme</h2>
        <p class="label-meta">Choose Light Mode or Dark Mode for this desktop app.</p>
        <div class="settings-theme-options" data-theme-options>
          ${(['light', 'dark'] as const).map((option) => `
            <button type="button" class="theme-option ${theme === option ? 'selected' : ''}" data-theme-choice="${option}">
              <span>${option === 'light' ? 'Light Mode' : 'Dark Mode'}</span>
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `;

  const form = root.querySelector<HTMLFormElement>('.settings-form');
  const editButton = root.querySelector<HTMLButtonElement>('[data-settings-edit="true"]');
  const cancelButton = root.querySelector<HTMLButtonElement>('[data-settings-cancel="true"]');
  const editActions = root.querySelector<HTMLElement>('.settings-edit-actions');
  const editableFields = Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('.settings-profile-field'))
    .filter((field) => field.name !== 'email');
  const originalValues = new Map<string, string>();
  editableFields.forEach((field) => {
    originalValues.set(field.name, field.value);
  });

  const setEditing = (editing: boolean) => {
    if (!form || !editButton || !editActions) return;
    form.dataset.editing = editing ? 'true' : 'false';
    editButton.style.display = editing ? 'none' : 'inline-flex';
    editActions.classList.toggle('is-visible', editing);
    editableFields.forEach((field) => {
      field.readOnly = !editing;
      if (!editing) field.setAttribute('readonly', 'readonly');
      else field.removeAttribute('readonly');
      const valueNode = field.closest('.form-group')?.querySelector<HTMLElement>('.settings-value');
      if (valueNode && !editing) {
        valueNode.textContent = field.value || '';
      }
    });
  };

  editButton.addEventListener('click', () => setEditing(true));
  cancelButton?.addEventListener('click', () => {
    editableFields.forEach((field) => {
      const original = originalValues.get(field.name);
      if (original !== undefined) field.value = original;
    });
    setEditing(false);
  });

  root.querySelectorAll<HTMLButtonElement>('[data-theme-choice]').forEach((button) => {
    button.addEventListener('click', () => {
      const choice = button.dataset.themeChoice === 'dark' ? 'dark' : 'light';
      localStorage.setItem('lerzo_theme', choice);
      applyTheme(choice);
      root.querySelectorAll('[data-theme-choice]').forEach((node) => node.classList.remove('selected'));
      button.classList.add('selected');
      showActionToast(root, `${choice === 'dark' ? 'Dark Mode' : 'Light Mode'} applied.`);
    });
  });

  root.querySelector('[data-billing-pay="true"]')?.addEventListener('click', () => {
    window.location.hash = '#/subscription-plans';
  });
  root.querySelector('[data-billing-invoices="true"]')?.addEventListener('click', () => {
    window.location.hash = '#/settings-invoices';
  });
}

function hydrateInvoices(root: HTMLElement, payload: unknown) {
  const data = findRecord(payload, ['data']);
  const invoices = findArray(data, ['invoices']);
  const subscription = findRecord(data, ['subscription']);
  const totalPaid = valueText(data.total_paid || 0);
  root.innerHTML = `
    <div class="p-32" style="padding-top:0;max-width:1100px;margin:0 auto;">
      <div class="flex justify-between items-center" style="margin-bottom:24px;gap:16px;flex-wrap:wrap;">
        <div>
          <h1 class="page-title">Subscription Invoices</h1>
          <p class="label-meta">Download PDF invoices with payment date, tax, and next billing cycle details.</p>
        </div>
        <button type="button" class="btn btn-secondary" data-invoices-back="true"><i data-lucide="arrow-left"></i><span>Back to Settings</span></button>
      </div>

      <div class="settings-panel billing-panel" style="margin-bottom:24px;">
        <div class="billing-grid">
          <div class="billing-stat"><span class="label">Current Plan</span><strong>${valueText(subscription.plan_name || 'No Active Plan')}</strong></div>
          <div class="billing-stat"><span class="label">Status</span><strong>${valueText(subscription.status || 'Inactive')}</strong></div>
          <div class="billing-stat"><span class="label">Next Billing Cycle</span><strong>${valueText(subscription.expiry_date || 'Not set')}</strong></div>
          <div class="billing-stat"><span class="label">Total Paid</span><strong>₹${totalPaid}</strong></div>
        </div>
        <div class="billing-actions">
          <button type="button" class="btn btn-primary" data-invoices-pay="true"><i data-lucide="credit-card"></i><span>Pay / Upgrade</span></button>
        </div>
      </div>

      <div class="settings-panel">
        ${invoices.length ? `
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Paid Date</th>
                  <th>Plan</th>
                  <th>Amount</th>
                  <th>GST (18%)</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${invoices.map((invoice) => `
                  <tr>
                    <td><strong>${valueText(invoice.invoice_number || `INV-${invoice.id}`)}</strong></td>
                    <td>${valueText(invoice.payment_date).slice(0, 10)}</td>
                    <td>${valueText(invoice.plan_type)}</td>
                    <td>₹${Number(invoice.amount || 0).toFixed(2)}</td>
                    <td>₹${Number(invoice.tax_amount || 0).toFixed(2)}</td>
                    <td>₹${Number(invoice.total_amount || invoice.amount || 0).toFixed(2)}</td>
                    <td><span class="badge badge-success">${valueText(invoice.status)}</span></td>
                    <td><button type="button" class="btn btn-secondary" data-invoice-download="${valueText(invoice.id)}">Download PDF</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : `
          <div class="empty-state-card">
            <h2 class="card-title">No invoices yet</h2>
            <p class="label-meta">Your paid subscription invoices will appear here with downloadable PDF copies.</p>
            <button type="button" class="btn btn-primary" data-invoices-pay="true">Subscribe Now</button>
          </div>
        `}
      </div>
    </div>
  `;

  root.querySelector('[data-invoices-back="true"]')?.addEventListener('click', () => {
    window.location.hash = '#/settings-profile';
  });
  root.querySelectorAll('[data-invoices-pay="true"]').forEach((button) => {
    button.addEventListener('click', () => {
      window.location.hash = '#/subscription-plans';
    });
  });
  root.querySelectorAll<HTMLButtonElement>('[data-invoice-download]').forEach((button) => {
    button.addEventListener('click', () => {
      void desktopApiDownload(`/settings/invoices/${button.dataset.invoiceDownload}/pdf`, `invoice-${button.dataset.invoiceDownload}.pdf`);
    });
  });
}

function updateDetailRow(root: HTMLElement, label: string, value: string, allowHtml = false) {
  const labelNode = Array.from(root.querySelectorAll<HTMLElement>('.label-meta, span.label-meta')).find((node) => node.textContent?.trim() === label);
  const row = labelNode?.closest<HTMLElement>('.flex.justify-between') || labelNode?.parentElement;
  const valueNode = row?.querySelector<HTMLElement>('span:not(.label-meta), .mono');
  if (!valueNode) return;
  if (allowHtml) valueNode.innerHTML = value;
  else valueNode.textContent = value;
}

function formatDisplayDate(value: unknown) {
  if (!value || valueText(value) === '-') return '-';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return valueText(value);
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function hydrateStudentView(root: HTMLElement) {
  const studentId = pageQueryParam('id');
  if (!studentId) {
    showPageError(root, 'Student not found. Open this page from the student list.', () => {
      window.location.hash = '#/students-list';
    });
    return;
  }

  const payload = await desktopApiGet(`/students/${studentId}`) as { student?: Record<string, unknown> };
  const student = findRecord(payload, ['student']);
  const payments = findArray(student, ['fee_payments']);
  cacheRows('student', [student]);

  const title = root.querySelector<HTMLElement>('.page-title');
  if (title) title.textContent = valueText(student.name);
  const subtitle = root.querySelector<HTMLElement>('.label-meta');
  if (subtitle && subtitle.textContent?.includes('Student ID')) {
    subtitle.textContent = `Student ID: ${valueText(student.enrollment_number)}`;
  }

  updateDetailRow(root, 'Enrollment Number', valueText(student.enrollment_number));
  updateDetailRow(root, 'Full Name', valueText(student.name));
  updateDetailRow(root, "Father's Name", valueText(student.father_name));
  updateDetailRow(root, 'Gender / Age', `${valueText(student.sex)} / ${valueText(student.age)}`);
  updateDetailRow(root, 'Date of Birth', formatDisplayDate(student.date_of_birth));
  updateDetailRow(root, 'Date of Joining', formatDisplayDate(student.date_of_joining));
  updateDetailRow(root, 'Contact Details', valueText(student.mobile1));
  updateDetailRow(root, 'Course', valueText(student.course));
  updateDetailRow(
    root,
    'Batch',
    student.batch_timing && valueText(student.batch) !== '-'
      ? `${valueText(student.batch)}<div class="label-meta" style="font-size:11px;">${valueText(student.batch_timing)}</div>`
      : valueText(student.batch),
    true,
  );
  updateDetailRow(root, 'Qualification', valueText(student.qualification));
  updateDetailRow(
    root,
    'Address',
    [student.address_line1, student.address_line2, student.city].map((part) => valueText(part)).filter((part) => part !== '-').join('<br>') || '-',
    true,
  );

  updateDetailRow(root, 'Total Fees', formatCurrency(student.total_fees));
  if (Number(student.concession || 0) > 0) {
    updateDetailRow(root, 'Concession', formatCurrency(student.concession));
  }
  updateDetailRow(root, 'Net Fees', formatCurrency(student.net_fees));
  updateDetailRow(root, 'Paid Amount', formatCurrency(student.total_paid));
  updateDetailRow(root, 'Balance Due', formatCurrency(student.balance));

  const statusBadge = Array.from(root.querySelectorAll<HTMLElement>('.badge')).find((node) => {
    const text = node.textContent?.trim().toLowerCase() || '';
    return ['paid', 'partial', 'unpaid'].includes(text);
  });
  if (statusBadge) {
    statusBadge.textContent = valueText(student.fee_status);
    statusBadge.className = `badge ${feeStatusBadgeClass(student.fee_status)}`;
    statusBadge.style.padding = '8px 24px';
    statusBadge.style.fontSize = '14px';
  }

  const paymentCard = Array.from(root.querySelectorAll<HTMLElement>('h3.card-title')).find((node) => node.textContent?.trim() === 'Payment History')?.closest<HTMLElement>('.card');
  const paymentTable = paymentCard?.querySelector<HTMLTableSectionElement>('tbody');
  const paymentEmpty = paymentCard?.querySelector<HTMLElement>('div[style*="padding: 48px"]');
  if (payments.length && paymentTable) {
    if (paymentEmpty) paymentEmpty.remove();
    if (!paymentCard?.querySelector('table')) {
      paymentCard?.insertAdjacentHTML('beforeend', `
        <table class="table">
          <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Receipt No.</th><th>Notes</th></tr></thead>
          <tbody></tbody>
        </table>
      `);
    }
    const tbody = paymentCard?.querySelector<HTMLTableSectionElement>('tbody');
    if (tbody) {
      tbody.innerHTML = payments.map((payment) => `
        <tr>
          <td>${formatDisplayDate(payment.payment_date)}</td>
          <td style="font-weight:600;color:var(--text-primary);">${formatCurrency(payment.amount)}</td>
          <td><span class="badge badge-neutral">${valueText(payment.payment_method)}</span></td>
          <td class="mono">${valueText(payment.receipt_number)}</td>
          <td class="label-meta">${valueText(payment.notes)}</td>
        </tr>
      `).join('');
    }
  } else if (paymentTable) {
    paymentTable.innerHTML = '';
  }

  const balance = Number(student.balance || 0);
  root.querySelectorAll<HTMLElement>('a.btn, button.btn').forEach((node) => {
    const label = node.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
    if (label.includes('pay fees') || label.includes('record payment') || label.includes('add payment')) {
      node.style.display = balance > 0 ? '' : 'none';
      if (node instanceof HTMLAnchorElement) node.href = `#/fees-payment?id=${studentId}`;
    }
    if (label.includes('back to list')) {
      if (node instanceof HTMLAnchorElement) node.href = '#/students-list';
    }
    if (label.includes('edit profile') || (label === 'edit' && node.closest('.flex.gap-12'))) {
      if (node instanceof HTMLAnchorElement) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = node.className;
        button.innerHTML = node.innerHTML;
        button.dataset.crudAction = 'edit';
        button.dataset.module = 'student';
        button.dataset.id = studentId;
        node.replaceWith(button);
      } else if (node instanceof HTMLButtonElement) {
        node.dataset.crudAction = 'edit';
        node.dataset.module = 'student';
        node.dataset.id = studentId;
      }
    }
  });
}

async function hydrateFeePayment(root: HTMLElement) {
  const studentId = pageQueryParam('id');
  if (!studentId) {
    showPageError(root, 'Student not found. Open this page from the student profile.', () => {
      window.location.hash = '#/students-list';
    });
    return;
  }

  const payload = await desktopApiGet(`/students/${studentId}`) as { student?: Record<string, unknown> };
  const student = findRecord(payload, ['student']);
  const form = root.querySelector<HTMLFormElement>('form');
  if (form) {
    form.method = 'post';
    form.dataset.studentId = studentId;
  }

  const paymentMethodField = root.querySelector<HTMLInputElement | HTMLSelectElement>('[name="payment_method"]');
  if (paymentMethodField) {
    const options = ['Cash', 'Card', 'Online', 'Cheque'];
    if (paymentMethodField instanceof HTMLInputElement) {
      const select = document.createElement('select');
      select.name = 'payment_method';
      select.id = paymentMethodField.id || 'payment_method';
      select.className = paymentMethodField.className || 'input';
      select.required = true;
      select.innerHTML = options.map((method) => `<option value="${method}">${method}</option>`).join('');
      paymentMethodField.replaceWith(select);
    } else if (!paymentMethodField.options.length) {
      paymentMethodField.innerHTML = options.map((method) => `<option value="${method}">${method}</option>`).join('');
    }
  }

  const receiptField = root.querySelector<HTMLInputElement>('[name="receipt_number"]');
  if (receiptField) {
    receiptField.placeholder = 'Enter receipt / bill number';
    receiptField.closest('.form-group')?.querySelector('.label')?.replaceChildren('Receipt / Bill Number');
  }

  const subtitle = Array.from(root.querySelectorAll<HTMLElement>('.label-meta')).find((node) => node.textContent?.includes('Add a new fee payment'));
  if (subtitle) subtitle.textContent = `Add a new fee payment for ${valueText(student.name)}`;

  const profileCard = Array.from(root.querySelectorAll<HTMLElement>('h3.card-title')).find((node) => node.textContent?.trim() === 'Student Profile')?.closest<HTMLElement>('.card');
  if (profileCard) {
    const name = profileCard.querySelector<HTMLElement>('h4');
    const enrollment = profileCard.querySelector<HTMLElement>('.mono');
    if (name) name.textContent = valueText(student.name);
    if (enrollment) enrollment.textContent = valueText(student.enrollment_number);
    updateDetailRow(profileCard, 'Course', valueText(student.course));
    updateDetailRow(profileCard, 'Contact', valueText(student.mobile1));
  }

  const summaryCard = Array.from(root.querySelectorAll<HTMLElement>('h3.card-title')).find((node) => node.textContent?.trim() === 'Fee Summary')?.closest<HTMLElement>('.card');
  if (summaryCard) {
    updateDetailRow(summaryCard, 'Net Fees', formatCurrency(student.net_fees));
    updateDetailRow(summaryCard, 'Paid So Far', formatCurrency(student.total_paid));
    updateDetailRow(summaryCard, 'Balance Due', formatCurrency(student.balance));
  }

  setFormFieldValue(root, 'payment_date', new Date().toISOString().slice(0, 10));
  const amountHint = Array.from(root.querySelectorAll<HTMLElement>('p.label-meta')).find((node) => node.textContent?.includes('Max:'));
  if (amountHint) amountHint.textContent = `Max: ${formatCurrency(student.balance)}`;

  root.querySelectorAll<HTMLElement>('a.btn').forEach((node) => {
    const label = node.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
    if (label.includes('back to profile')) node.setAttribute('href', `#/students-view?id=${studentId}`);
    if (label.includes('cancel')) node.setAttribute('href', `#/students-view?id=${studentId}`);
  });
}

function hydrateAttendanceSettings(root: HTMLElement, payload: unknown) {
  const settings = findRecord(payload, ['data', 'settings']);
  const holidays = findArray(payload, ['holidays']).length
    ? findArray(payload, ['holidays'])
    : findArray(settings, ['holidays']);
  debugPageState('settings/attendance.html', 'mapped data', { settings, holidays });

  root.querySelectorAll<HTMLElement>('.card').forEach((card) => {
    const title = card.querySelector('h5')?.textContent?.trim();
    if (['Attendance Radius', 'Attendance Rules', 'Week Off Days'].includes(title || '')) card.remove();
  });
  root.querySelectorAll<HTMLElement>('p, div').forEach((node) => {
    if (node.textContent?.includes('How It Works')) node.closest<HTMLElement>('div[style*="margin-top"]')?.remove();
  });

  const setInput = (name: string, value: unknown) => {
    const field = root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`);
    if (!field || value === undefined || value === null) return;
    if (field instanceof HTMLInputElement && field.type === 'checkbox') {
      field.checked = Boolean(value);
      return;
    }
    field.value = String(value);
  };

  setInput('latitude', settings.latitude);
  setInput('longitude', settings.longitude);
  ['latitude', 'longitude'].forEach((name) => {
    const field = root.querySelector<HTMLInputElement>(`#${name}, [name="${name}"]`);
    if (!field) return;
    const min = name === 'latitude' ? -90 : -180;
    const max = name === 'latitude' ? 90 : 180;
    if (!validCoordinate(field.value, min, max)) {
      field.value = '';
    }
  });
  setInput('attendance_radius_meters', settings.attendance_radius_meters || 150);
  setInput('allow_check_in', settings.allow_check_in);
  setInput('allow_check_out', settings.allow_check_out);
  setInput('require_selfie', settings.require_selfie);
  setInput('require_gps_validation', settings.require_gps_validation);
  setInput('allow_corrections', settings.allow_corrections);

  if (settings.latitude != null && settings.longitude != null) {
    const status = root.querySelector<HTMLElement>('#locationStatus');
    setLocationStatus(
      status,
      `Saved centre location: ${Number(settings.latitude).toFixed(6)}, ${Number(settings.longitude).toFixed(6)}`,
      'success',
    );
  }

  root.querySelectorAll<HTMLElement>('p').forEach((node) => {
    if (node.textContent?.includes('Location saved:') && (!settings.latitude || !settings.longitude)) {
      node.closest<HTMLElement>('div')?.remove();
    }
  });

  const holidaysList = Array.from(root.querySelectorAll<HTMLElement>('h6')).find((node) => node.textContent?.includes('Saved Holidays'))?.parentElement;
  let list = holidaysList?.querySelector<HTMLElement>('div[style*="flex-direction: column"]') || null;
  if (holidaysList && !list) {
    holidaysList.querySelector('p')?.remove();
    list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '8px';
    holidaysList.appendChild(list);
  }
  if (list) {
    list.innerHTML = holidays.length ? holidays.map((holiday) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:12px;">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-family:monospace;font-size:13px;font-weight:600;color:var(--text-muted);">${valueText(holiday.holiday_date || holiday.date)}</span>
          <span style="font-size:14px;font-weight:700;color:var(--text-primary);">${valueText(holiday.holiday_name || holiday.name || holiday.title)}</span>
        </div>
        <button type="button" data-crud-action="delete-holiday" data-module="attendance" data-id="${valueText(holiday.id)}" style="background:none;border:none;color:#EF4444;cursor:pointer;padding:4px;">
          <i data-lucide="trash-2" style="width:16px;height:16px;"></i>
        </button>
      </div>
    `).join('') : '<p style="font-size:13px;color:var(--text-muted);font-style:italic;text-align:center;padding:12px;">No holidays added yet.</p>';
  }

  restructureAttendanceOfficeCard(root);
}

async function hydrateTemplateData(root: HTMLElement, templatePath: string) {
  const retry = () => void hydrateTemplateData(root, templatePath);
  delete root.dataset.hydrated;
  clearPageError(root);
  scrubGeneratedSampleText(root);
  debugPageState(templatePath, 'loading state', { loading: true, error: null });
  beginPageLoading();
  if (staffPageShellMeta[templatePath]) {
    renderStaffPageShell(root, templatePath);
  }
  try {
    if (templatePath === 'dashboard/index.html') hydrateDashboard(root, await desktopApiGet('/dashboard'));
    if (templatePath === 'enquiries/list.html') hydrateEnquiries(root, await desktopApiGet('/enquiries'));
    if (templatePath === 'students/list.html') hydrateStudents(root, await desktopApiGet('/students'));
    if (templatePath === 'students/view.html') await hydrateStudentView(root);
    if (templatePath === 'fees/payment.html') await hydrateFeePayment(root);
    if (templatePath === 'batches/list.html') hydrateBatches(root, await desktopApiGet('/batches'));
    if (templatePath === 'courses/list.html') hydrateCourses(root, await desktopApiGet('/courses'));
    if (templatePath === 'schemes/list.html') hydrateSchemes(root, await desktopApiGet('/schemes'));
    if (templatePath === 'staff/list.html') hydrateStaff(root, await desktopApiGet('/staff'));
    if (templatePath === 'staff/dashboard.html') hydrateStaffDashboard(root, await desktopApiGet('/staff/dashboard'));
    if (templatePath === 'staff/attendance_list.html') hydrateStaffAttendance(root, await desktopApiGet('/staff/attendance'));
    if (templatePath === 'staff/leave_requests.html') hydrateStaffLeaveRequests(root, await desktopApiGet('/staff/leave-requests'));
    if (templatePath === 'staff/corrections.html') hydrateStaffCorrections(root, await desktopApiGet('/staff/corrections'));
    if (templatePath === 'staff/reports.html') hydrateStaffReports(root, await desktopApiGet('/staff/reports'));
    if (templatePath === 'reports/index.html') await hydrateReports(root);
    if (templatePath === 'reports/students.html') hydrateStudentReport(root, await desktopApiGet('/reports/students'));
    if (templatePath === 'reports/fees.html') hydrateFeesReport(root, await desktopApiGet('/reports/fees'));
    if (templatePath === 'reports/enquiries.html') hydrateEnquiriesReport(root, await desktopApiGet('/reports/enquiries'));
    if (templatePath === 'reports/batches.html') hydrateBatchesReport(root, await desktopApiGet('/reports/batches'));
    if (templatePath === 'exports/options.html') hydrateExportsOptions(root);
    if (templatePath === 'subscription/plans.html') hydrateSubscription(root, await desktopApiGet('/subscription/plans'));
    if (templatePath === 'subscription/payment.html') await hydrateSubscriptionPayment(root);
    if (templatePath === 'settings/profile.html') hydrateSettings(root, await desktopApiGet('/auth/me'));
    if (templatePath === 'settings/invoices.html') hydrateInvoices(root, await desktopApiGet('/settings/invoices'));
    if (templatePath === 'settings/attendance.html') hydrateAttendanceSettings(root, await desktopApiGet('/settings/attendance'));
    if (templatePath === 'notifications/index.html') hydrateNotifications(root, await desktopApiGet('/notifications/list'));
    root.dataset.hydrated = 'true';
  } catch (error) {
    delete root.dataset.hydrated;
    debugPageState(templatePath, 'error state', { loading: false, error });
    showPageError(root, error instanceof Error ? error.message : 'Unable to load data.', retry);
  } finally {
    endPageLoading();
    scrubGeneratedSampleText(root);
    refreshLucideIcons(root);
    debugPageState(templatePath, 'loading state', { loading: false });
  }
}

export default function TemplateHtmlPage({ title, templatePath, html }: TemplateHtmlPageProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const safeHtml = useMemo(() => normalizeTemplateHtml(html || '', templatePath), [html, templatePath]);

  useEffect(() => {
    const unregisterCache = registerCacheInvalidator(invalidateDesktopApiCache);
    return unregisterCache;
  }, []);

  useEffect(() => {
    if (!ref.current) return undefined;
    const scope = TEMPLATE_SCOPE_MAP[templatePath];
    if (!scope) return undefined;
    const root = ref.current;
    return registerPageRefresh(scope, () => {
      const path = root.dataset.activeTemplate || templatePath;
      return hydrateTemplateData(root, path);
    });
  }, [templatePath]);

  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;
    const loadingSafetyTimer = window.setTimeout(() => {
      if (!cancelled) endPageLoading();
    }, TEMPLATE_LOADING_TIMEOUT_MS);

    const run = async () => {
      setRenderError(null);
      applyStoredTheme();
      installFlaskApiBridge();
      installFlaskDialogBridge();
      installNotificationPoller();
      const root = ref.current;
      if (!root) return;
      root.dataset.activeTemplate = templatePath;
      const disposeNavigation = installNavigationBridge(root);
      const disposeCrud = installCrudActionBridge(root, templatePath);
      if (templatePath === 'exports/options.html') {
        installExportsOptionsBridge(root);
      }
      hideTenantDeveloperControls(root);
      if (templatePath === 'auth/login.html') {
        installElectronLoginBridge(root);
      }
      if (templatePath === 'dashboard/index.html') {
        installDashboardClock(root);
      }
      await renderManagedAddForm(root, templatePath);
      await hydrateTemplateData(root, templatePath);
      if (templatePath === 'auth/register.html') {
        installElectronRegisterBridge(root);
      }
      if (templatePath === 'settings/attendance.html') {
        const refreshAttendancePage = async () => {
          if (!ref.current) return;
          try {
            hydrateAttendanceSettings(ref.current, await desktopApiGet('/settings/attendance', { silent: true }));
          } catch {
            // Keep current form values if background refresh fails.
          }
        };
        installAttendanceLocationBridge(root);
        installAttendanceQrBridge(root, refreshAttendancePage);
      }
      window.clearTimeout(loadingSafetyTimer);
      refreshLucideIcons(root);

      const scripts = Array.from(root.querySelectorAll('script') || []);
      for (const script of scripts) {
        const existing = script.getAttribute('data-executed');
        if (existing === 'true') continue;
        script.setAttribute('data-executed', 'true');
      }

      if (typeof window.markAllNotificationsAsRead === 'function' && typeof window.markAllNotificationsRead !== 'function') {
        window.markAllNotificationsRead = window.markAllNotificationsAsRead;
      }

      return () => {
        disposeNavigation();
        disposeCrud();
      };
    };

    let disposePageBridges: (() => void) | undefined;

    void run()
      .then((dispose) => {
        if (cancelled) {
          dispose?.();
          return;
        }
        disposePageBridges = dispose;
      })
      .catch((error) => {
        setRenderError(error instanceof Error ? error.message : 'This page could not finish loading.');
        endPageLoading();
        window.clearTimeout(loadingSafetyTimer);
      });

    return () => {
      cancelled = true;
      disposePageBridges?.();
      endPageLoading();
      window.clearTimeout(loadingSafetyTimer);
      if (ref.current) {
        delete ref.current.dataset.registerBridgeInstalled;
      }
    };
  }, [templatePath]);

  return (
    <section className="template-page" data-template={templatePath} aria-label={title}>
      <div ref={ref} dangerouslySetInnerHTML={{ __html: safeHtml }} />
      {renderError && (
        <div className="template-error card">
          <h2 className="card-title">This page needs a refresh</h2>
          <p className="label-meta">{renderError}</p>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              if (!ref.current) return;
              setRenderError(null);
              void hydrateTemplateData(ref.current, templatePath);
            }}
          >
            Retry
          </button>
        </div>
      )}
    </section>
  );
}
