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
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

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

  const finishBoot = useCallback((reason: string) => {
    setLoading(false);
    setBootReady(true);
    forceHideAllLoading();
    markBootComplete(reason);
  }, []);

  const refreshUser = useCallback(async (options?: { silent?: boolean; timeoutMs?: number }) => {
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

    callbackInFlight.current = true;
    setLoginCompleting(true);
    resetAuthTokenCache();
    refreshInFlight.current = null;

    try {
      const ok = await refreshUser({ silent: true });
      if (ok) {
        loginNavigatePending.current = true;
        return true;
      }

      window.location.hash = '#/auth-error?message=Login%20verification%20failed.%20Please%20try%20again.';
      return false;
    } finally {
      if (!loginNavigatePending.current) {
        callbackInFlight.current = false;
        setLoginCompleting(false);
      }
    }
  }, [refreshUser]);

  useEffect(() => {
    if (!loginNavigatePending.current || !user) {
      return;
    }

    loginNavigatePending.current = false;
    callbackInFlight.current = false;
    if (window.location.hash !== '#/dashboard') {
      window.location.hash = '#/dashboard';
    }
    setLoginCompleting(false);
    // Tell the main process we successfully refreshed auth + navigated so it can
    // cancel the force-refresh watchdog. Never leave main waiting for a restart.
    window.electronAPI?.ackDesktopLogin?.();
  }, [user]);

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

  useEffect(() => {
    if (authChecked.current) return undefined;
    authChecked.current = true;

    let cancelled = false;
    const safetyTimer = window.setTimeout(() => {
      if (cancelled) return;
      finishBoot('timeout');
    }, BOOT_MAX_LOADER_MS);

    void (async () => {
      try {
        await refreshUser({ silent: false, timeoutMs: AUTH_CHECK_TIMEOUT_MS });
      } catch (error) {
        console.warn('[BOOT] auth bootstrap failed =', error);
      } finally {
        if (cancelled) return;
        window.clearTimeout(safetyTimer);
        finishBoot('complete');
      }
    })();

    const handleAuthChanged = () => {
      if (callbackInFlight.current) return;
      void refreshUser({ silent: true });
    };

    const unsubscribeAuthToken = window.electronAPI?.onAuthTokenReceived?.(() => {
      void handleLoginCallback();
    });

    const handleLoginComplete = () => {
      if (callbackInFlight.current) return;
      void handleLoginCallback();
    };

    window.addEventListener('lerzo-auth-changed', handleAuthChanged as EventListener);
    window.addEventListener('lerzo-login-complete', handleLoginComplete as EventListener);
    return () => {
      cancelled = true;
      window.clearTimeout(safetyTimer);
      window.removeEventListener('lerzo-auth-changed', handleAuthChanged as EventListener);
      window.removeEventListener('lerzo-login-complete', handleLoginComplete as EventListener);
      unsubscribeAuthToken?.();
    };
  }, [finishBoot, handleLoginCallback, refreshUser]);

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
    logout,
  }), [authError, bootReady, handleLoginCallback, loading, loginCompleting, logout, refreshUser, refreshing, user]);

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
