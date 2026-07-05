import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AuthVerificationError, loadCurrentUser, logout as logoutRequest, refreshDesktopSession } from '../services/auth';
import { clearAuthTokens, getAuthToken, resetAuthTokenCache } from '../services/api';
import { forceHideAllLoading } from '../services/appShell';
import {
  AUTH_CHECK_TIMEOUT_MS,
  BOOT_MAX_LOADER_MS,
  markBootComplete,
  markBootRouteReady,
  withTimeout,
} from '../services/boot';
import { resetAuthExpiredHandled } from '../services/authFlags';
import { startNotificationPoller, stopNotificationPoller } from '../services/notificationsPoll';
import { applyTheme } from '../theme';
import type { CurrentUser } from '../types/auth';

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  bootReady: boolean;
  refreshing: boolean;
  loginCompleting: boolean;
  isAuthenticated: boolean;
  authError: string | null;
  refreshUser: () => Promise<boolean>;
  handleLoginCallback: () => Promise<boolean>;
  notifyDashboardMounted: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Survives a full renderer reload (e.g. main's force-refresh watchdog) so the
// ack still fires once the dashboard mounts after re-bootstrapping auth.
const DESKTOP_LOGIN_PENDING_KEY = 'lerzo_desktop_login_pending';

function markDesktopLoginPending() {
  try { sessionStorage.setItem(DESKTOP_LOGIN_PENDING_KEY, '1'); } catch { /* ignore */ }
}

function clearDesktopLoginPending() {
  try { sessionStorage.removeItem(DESKTOP_LOGIN_PENDING_KEY); } catch { /* ignore */ }
}

function isDesktopLoginPending(): boolean {
  try { return sessionStorage.getItem(DESKTOP_LOGIN_PENDING_KEY) === '1'; } catch { return false; }
}

function readCachedUser(): CurrentUser | null {
  try {
    const saved = localStorage.getItem('lerzo_user');
    return saved ? JSON.parse(saved) as CurrentUser : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const initialUserRef = useRef<CurrentUser | null>(readCachedUser());
  const [user, setUser] = useState<CurrentUser | null>(initialUserRef.current);
  const [loading, setLoading] = useState(true);
  const [bootReady, setBootReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loginCompleting, setLoginCompleting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const callbackInFlight = useRef(false);
  const loginNavigatePending = useRef(false);
  const refreshInFlight = useRef<Promise<boolean> | null>(null);
  const authChecked = useRef(false);
  // True while a desktop login is completing and we still owe main an ack once
  // the dashboard has actually mounted.
  const pendingDashboardAck = useRef(isDesktopLoginPending());
  // Stable handles so the once-registered IPC listeners always call the latest
  // logic without needing the listener effect to re-run (and re-subscribe).
  const handleLoginCallbackRef = useRef<() => Promise<boolean>>(async () => false);
  const refreshUserRef = useRef<(options?: { silent?: boolean; timeoutMs?: number; force?: boolean }) => Promise<boolean>>(async () => false);

  const finishBoot = useCallback((reason: string) => {
    setLoading(false);
    setBootReady(true);
    forceHideAllLoading();
    markBootComplete(reason);
  }, []);

  const refreshUser = useCallback(async (options?: { silent?: boolean; timeoutMs?: number; force?: boolean }) => {
    // `force` bypasses in-flight de-dup so a desktop-login callback always runs a
    // fresh verification even if a boot/idle refresh is still pending.
    if (options?.force) {
      refreshInFlight.current = null;
    }
    if (refreshInFlight.current) {
      return refreshInFlight.current;
    }

    const silent = Boolean(options?.silent);
    const timeoutMs = options?.timeoutMs ?? AUTH_CHECK_TIMEOUT_MS;
    const cachedUser = readCachedUser();
    const task = (async () => {
      if (silent) {
        setRefreshing(true);
      } else if (!bootReady) {
        setLoading(true);
      }
      setAuthError(null);

      try {
        const token = await getAuthToken();
        if (!token) {
          stopNotificationPoller();
          if (!callbackInFlight.current) {
            setUser(null);
            localStorage.removeItem('lerzo_user');
          }
          return false;
        }

        await withTimeout(refreshDesktopSession(), timeoutMs, 'auth refresh');
        const currentUser = await withTimeout(loadCurrentUser(), timeoutMs, 'auth me');

        if (!currentUser) {
          stopNotificationPoller();
          if (!callbackInFlight.current) {
            await clearAuthTokens();
            setUser(null);
            localStorage.removeItem('lerzo_user');
          }
          setAuthError('Login session could not be verified.');
          return false;
        }

        setUser(currentUser);
        localStorage.setItem('lerzo_user', JSON.stringify(currentUser));
        resetAuthExpiredHandled();
        applyTheme();
        void startNotificationPoller();
        return true;
      } catch (error) {
        if (error instanceof AuthVerificationError && error.code === 'unauthorized') {
          stopNotificationPoller();
          await clearAuthTokens();
          setUser(null);
          localStorage.removeItem('lerzo_user');
          setAuthError(error.message);
          return false;
        }

        if (cachedUser || initialUserRef.current) {
          setUser(cachedUser || initialUserRef.current);
          setAuthError(error instanceof Error ? error.message : 'Could not refresh session. Using saved login.');
          resetAuthExpiredHandled();
          applyTheme();
          void startNotificationPoller();
          return true;
        }

        console.error('[Renderer Auth] refresh failed =', error);
        stopNotificationPoller();
        setUser(null);
        setAuthError(error instanceof Error ? error.message : 'Login verification failed.');
        return false;
      } finally {
        if (silent) {
          setRefreshing(false);
        } else if (!bootReady) {
          setLoading(false);
        }
        refreshInFlight.current = null;
      }
    })();

    refreshInFlight.current = task;
    return task;
  }, [bootReady]);

  const handleLoginCallback = useCallback(async () => {
    if (callbackInFlight.current) {
      return false;
    }

    // Desktop login is an intermediate state: keep the loader up and defer any
    // routing decision (never bounce to /auth-login) until refreshUser resolves.
    callbackInFlight.current = true;
    pendingDashboardAck.current = true;
    markDesktopLoginPending();
    setLoginCompleting(true);
    resetAuthTokenCache();
    refreshInFlight.current = null;

    try {
      // Immediately verify the just-saved token and load the user. No polling.
      const ok = await refreshUser({ silent: true, force: true });
      if (ok) {
        console.log('[Renderer Auth] refreshUser success');
        // user/authenticated are now set; the effect below navigates to the
        // dashboard. The ack is sent only after the dashboard actually mounts.
        loginNavigatePending.current = true;
        return true;
      }

      // Genuine verification failure — leave the login screen usable so the user
      // (or main's auth-login-failed signal) can retry. Do NOT keep completing.
      callbackInFlight.current = false;
      pendingDashboardAck.current = false;
      clearDesktopLoginPending();
      setLoginCompleting(false);
      return false;
    } catch (error) {
      console.error('[Renderer Auth] desktop login callback failed =', error);
      callbackInFlight.current = false;
      pendingDashboardAck.current = false;
      clearDesktopLoginPending();
      setLoginCompleting(false);
      return false;
    }
  }, [refreshUser]);

  // Navigate to the dashboard the instant the user is loaded. We keep
  // loginCompleting true here so AppRoutes renders the dashboard (authenticated)
  // rather than redirecting; the ack is deferred until the dashboard mounts.
  useEffect(() => {
    if (!loginNavigatePending.current || !user) {
      return;
    }

    loginNavigatePending.current = false;
    callbackInFlight.current = false;
    console.log('[Renderer Auth] navigating dashboard');
    if (window.location.hash !== '#/dashboard') {
      window.location.hash = '#/dashboard';
    }
  }, [user]);

  // Called once the dashboard route has mounted. This is the ONLY place that
  // acknowledges the desktop login to the main process (never before), which
  // cancels main's force-refresh watchdog. Always runs when a login is pending.
  const notifyDashboardMounted = useCallback(() => {
    if (!pendingDashboardAck.current) {
      if (loginCompleting) setLoginCompleting(false);
      return;
    }
    pendingDashboardAck.current = false;
    clearDesktopLoginPending();
    setLoginCompleting(false);
    window.electronAPI?.ackDesktopLogin?.();
    console.log('[Renderer Auth] dashboard mounted, ack sent');
  }, [loginCompleting]);

  const logout = useCallback(async () => {
    stopNotificationPoller();
    await logoutRequest();
    setUser(null);
    setAuthError(null);
    resetAuthTokenCache();
    refreshInFlight.current = null;
    if (window.location.hash !== '#/auth-login') {
      window.location.hash = '#/auth-login';
    }
  }, []);

  // Keep the stable refs pointing at the latest callbacks every render so the
  // once-registered listeners never call stale logic.
  handleLoginCallbackRef.current = handleLoginCallback;
  refreshUserRef.current = refreshUser;

  // Boot bootstrap ONLY — no listeners here, so its dependency changes can never
  // tear down the auth IPC listeners.
  useEffect(() => {
    if (authChecked.current) return undefined;
    authChecked.current = true;

    let cancelled = false;
    // If a desktop login was in progress when main force-reloaded the renderer,
    // keep the "Signing you in..." loader up while we re-bootstrap auth so we
    // never flash the login screen mid-login.
    if (pendingDashboardAck.current) {
      setLoginCompleting(true);
    }
    const safetyTimer = window.setTimeout(() => {
      if (cancelled) return;
      finishBoot('timeout');
    }, BOOT_MAX_LOADER_MS);

    void (async () => {
      let bootOk = false;
      try {
        // Auth token already present -> bootstrap immediately (no extra polling).
        bootOk = await refreshUser({ silent: false, timeoutMs: AUTH_CHECK_TIMEOUT_MS });
      } catch (error) {
        console.warn('[BOOT] auth bootstrap failed =', error);
      } finally {
        if (!cancelled) {
          // A pending desktop login that could not be verified on boot must not
          // leave the loader stuck; release it so routing can proceed.
          if (pendingDashboardAck.current && !bootOk) {
            pendingDashboardAck.current = false;
            clearDesktopLoginPending();
            setLoginCompleting(false);
          }
          window.clearTimeout(safetyTimer);
          finishBoot('complete');
        }
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(safetyTimer);
    };
  }, [finishBoot, refreshUser]);

  // Desktop-login IPC + DOM listeners. Registered exactly ONCE on mount and torn
  // down ONLY on unmount (empty deps) so a callback can never arrive after the
  // listener was removed. On a full renderer/Vite reload the provider remounts,
  // so this re-registers automatically.
  useEffect(() => {
    const onDesktopLogin = () => {
      console.log('[Renderer Auth] IPC auth-token-received received');
      void handleLoginCallbackRef.current();
    };
    const onDomLoginComplete = () => {
      if (callbackInFlight.current) return;
      console.log('[Renderer Auth] DOM lerzo-login-complete received');
      void handleLoginCallbackRef.current();
    };
    const onAuthChanged = () => {
      if (callbackInFlight.current) return;
      void refreshUserRef.current({ silent: true });
    };

    const unsubscribeAuthToken = window.electronAPI?.onAuthTokenReceived?.(onDesktopLogin);
    const unsubscribeLoginComplete = window.electronAPI?.onLoginComplete?.(onDesktopLogin);
    window.addEventListener('lerzo-login-complete', onDomLoginComplete as EventListener);
    window.addEventListener('lerzo-auth-changed', onAuthChanged as EventListener);
    console.log('[Renderer Auth] desktop-login listeners registered');

    return () => {
      unsubscribeAuthToken?.();
      unsubscribeLoginComplete?.();
      window.removeEventListener('lerzo-login-complete', onDomLoginComplete as EventListener);
      window.removeEventListener('lerzo-auth-changed', onAuthChanged as EventListener);
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    bootReady,
    refreshing,
    loginCompleting,
    isAuthenticated: Boolean(user),
    authError,
    refreshUser: () => refreshUser({ silent: Boolean(user) }),
    handleLoginCallback,
    notifyDashboardMounted,
    logout,
  }), [authError, bootReady, handleLoginCallback, loading, loginCompleting, logout, notifyDashboardMounted, refreshUser, refreshing, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}

export function useBootRouteReady() {
  const { bootReady } = useAuth();
  useEffect(() => {
    if (bootReady) markBootRouteReady();
  }, [bootReady]);
}
