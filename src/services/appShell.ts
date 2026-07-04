export type RefreshScope =
  | 'dashboard'
  | 'students'
  | 'enquiries'
  | 'batches'
  | 'courses'
  | 'schemes'
  | 'staff'
  | 'reports'
  | 'fees'
  | 'subscription'
  | 'notifications'
  | 'settings'
  | 'whatsapp'
  | 'exports';

export type ToastType = 'success' | 'error' | 'info';

type RefreshHandler = () => void | Promise<void>;
type CacheInvalidator = (scopes?: RefreshScope[]) => void;

const SCOPE_ENDPOINT_PREFIXES: Record<RefreshScope, string[]> = {
  dashboard: ['/dashboard'],
  students: ['/students'],
  enquiries: ['/enquiries'],
  batches: ['/batches'],
  courses: ['/courses'],
  schemes: ['/schemes'],
  staff: ['/staff'],
  reports: ['/reports'],
  fees: ['/students', '/reports/fees'],
  subscription: ['/subscription'],
  notifications: ['/notifications'],
  settings: ['/settings', '/auth/me'],
  whatsapp: ['/whatsapp'],
  exports: ['/exports'],
};

export const TEMPLATE_SCOPE_MAP: Record<string, RefreshScope> = {
  'dashboard/index.html': 'dashboard',
  'enquiries/list.html': 'enquiries',
  'enquiries/add.html': 'enquiries',
  'enquiries/edit.html': 'enquiries',
  'students/list.html': 'students',
  'students/add.html': 'students',
  'students/edit.html': 'students',
  'students/view.html': 'students',
  'fees/payment.html': 'fees',
  'batches/list.html': 'batches',
  'batches/add.html': 'batches',
  'batches/edit.html': 'batches',
  'courses/list.html': 'courses',
  'courses/add.html': 'courses',
  'courses/edit.html': 'courses',
  'schemes/list.html': 'schemes',
  'schemes/add.html': 'schemes',
  'schemes/edit.html': 'schemes',
  'staff/list.html': 'staff',
  'staff/add.html': 'staff',
  'staff/edit.html': 'staff',
  'staff/dashboard.html': 'staff',
  'staff/attendance_list.html': 'staff',
  'staff/leave_requests.html': 'staff',
  'staff/corrections.html': 'staff',
  'staff/reports.html': 'staff',
  'reports/index.html': 'reports',
  'reports/students.html': 'reports',
  'reports/fees.html': 'reports',
  'reports/batches.html': 'reports',
  'reports/enquiries.html': 'reports',
  'exports/options.html': 'exports',
  'subscription/plans.html': 'subscription',
  'subscription/payment.html': 'subscription',
  'settings/profile.html': 'settings',
  'settings/invoices.html': 'settings',
  'settings/attendance.html': 'settings',
  'notifications/index.html': 'notifications',
};

const MODULE_SCOPE_MAP: Record<string, RefreshScope[]> = {
  student: ['students', 'dashboard', 'reports', 'fees'],
  enquiry: ['enquiries', 'dashboard', 'reports'],
  batch: ['batches', 'dashboard', 'reports'],
  course: ['courses', 'batches'],
  scheme: ['schemes'],
  staff: ['staff'],
  'staff-leave': ['staff'],
  'staff-correction': ['staff'],
  'staff-attendance': ['staff'],
  notification: ['notifications'],
  report: ['reports'],
  subscription: ['subscription'],
  attendance: ['settings', 'staff'],
  whatsapp: ['whatsapp'],
  settings: ['settings'],
};

const refreshHandlers = new Map<string, RefreshHandler>();
let cacheInvalidator: CacheInvalidator | null = null;
let requestLoadingCount = 0;
let pageLoadingCount = 0;
let transitionActive = false;
let visibleSince = 0;
let hideTimer: number | undefined;
let maxLoaderTimer: number | undefined;

const MIN_LOADER_MS = 300;
const MAX_TRANSITION_MS = 800;
export const LOADER_MAX_MS = 3000;

type ShellListener = () => void;
const listeners = new Set<ShellListener>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function isLoaderVisible() {
  return requestLoadingCount > 0 || pageLoadingCount > 0 || transitionActive;
}

function scheduleHide() {
  window.clearTimeout(hideTimer);
  if (isLoaderVisible()) return;

  const elapsed = visibleSince ? Date.now() - visibleSince : MIN_LOADER_MS;
  const delay = Math.max(0, MIN_LOADER_MS - elapsed);

  hideTimer = window.setTimeout(() => {
    if (!isLoaderVisible()) {
      visibleSince = 0;
      notifyListeners();
    }
  }, delay);
}

function startMaxLoaderWatchdog() {
  window.clearTimeout(maxLoaderTimer);
  maxLoaderTimer = window.setTimeout(() => {
    if (!isLoaderVisible()) return;
    console.warn('[BOOT] loader hidden (watchdog)');
    forceHideAllLoading();
  }, LOADER_MAX_MS);
}

function markVisible() {
  if (!visibleSince) visibleSince = Date.now();
  window.clearTimeout(hideTimer);
  startMaxLoaderWatchdog();
  notifyListeners();
}

export function forceHideAllLoading() {
  requestLoadingCount = 0;
  pageLoadingCount = 0;
  transitionActive = false;
  visibleSince = 0;
  window.clearTimeout(hideTimer);
  window.clearTimeout(maxLoaderTimer);
  notifyListeners();
}

export function subscribeAppShell(listener: ShellListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAppShellLoadingState() {
  const active = isLoaderVisible();
  return {
    active,
    requestLoadingCount,
    pageLoadingCount,
    transitionActive,
  };
}

export function beginRequestLoading() {
  requestLoadingCount += 1;
  markVisible();
}

export function endRequestLoading() {
  requestLoadingCount = Math.max(0, requestLoadingCount - 1);
  scheduleHide();
}

export function beginPageLoading() {
  pageLoadingCount += 1;
  markVisible();
}

export function endPageLoading() {
  pageLoadingCount = Math.max(0, pageLoadingCount - 1);
  scheduleHide();
}

export function beginPageTransition() {
  transitionActive = true;
  markVisible();
  window.setTimeout(() => {
    transitionActive = false;
    scheduleHide();
  }, MAX_TRANSITION_MS);
}

export function endPageTransition() {
  transitionActive = false;
  scheduleHide();
}

export function registerCacheInvalidator(invalidator: CacheInvalidator) {
  cacheInvalidator = invalidator;
  return () => {
    if (cacheInvalidator === invalidator) cacheInvalidator = null;
  };
}

export function registerPageRefresh(scope: RefreshScope, handler: RefreshHandler) {
  refreshHandlers.set(scope, handler);
  return () => {
    if (refreshHandlers.get(scope) === handler) refreshHandlers.delete(scope);
  };
}

export function scopesForModule(module: string, templatePath?: string) {
  const scopes = new Set<RefreshScope>(MODULE_SCOPE_MAP[module] || []);
  if (templatePath) {
    const pageScope = TEMPLATE_SCOPE_MAP[templatePath];
    if (pageScope) scopes.add(pageScope);
  }
  return Array.from(scopes);
}

export function scopesForTemplate(templatePath: string) {
  const scope = TEMPLATE_SCOPE_MAP[templatePath];
  return scope ? [scope] : [];
}

export function invalidateScopes(scopes?: RefreshScope[]) {
  cacheInvalidator?.(scopes);
}

export async function refreshScopes(scopes: RefreshScope[]) {
  const uniqueScopes = Array.from(new Set(scopes.filter(Boolean)));
  if (!uniqueScopes.length) return;

  invalidateScopes(uniqueScopes);

  await Promise.all(uniqueScopes.map(async (scope) => {
    const handler = refreshHandlers.get(scope);
    if (!handler) return;
    await handler();
  }));
}

export async function refreshAfterMutation(module: string, templatePath?: string) {
  await refreshScopes(scopesForModule(module, templatePath));
}

export function showAppToast(message: string, type: ToastType = 'success') {
  if (typeof window.showToast === 'function') {
    window.showToast(message, type === 'error' ? 'error' : 'success');
    return;
  }

  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'error' : 'success'}`;
  const icon = type === 'error' ? 'fa-exclamation-circle' : 'fa-check-circle';
  toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
  container.appendChild(toast);

  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    toast.style.transition = 'all 300ms ease';
    window.setTimeout(() => toast.remove(), 300);
  }, 4000);
}

export function trackLoading<T>(task: () => Promise<T>) {
  beginRequestLoading();
  return task().finally(() => endRequestLoading());
}

export function endpointMatchesScope(endpoint: string, scope: RefreshScope) {
  const prefixes = SCOPE_ENDPOINT_PREFIXES[scope] || [];
  return prefixes.some((prefix) => endpoint.startsWith(prefix));
}
