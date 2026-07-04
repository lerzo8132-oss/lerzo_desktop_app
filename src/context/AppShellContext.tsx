import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import LerzoLogoLoader from '../components/LerzoLogoLoader';
import { useAuth } from './AuthContext';
import {
  beginPageTransition,
  endPageTransition,
  forceHideAllLoading,
  getAppShellLoadingState,
  LOADER_MAX_MS,
  subscribeAppShell,
} from '../services/appShell';
import { markBootLoaderHidden } from '../services/boot';

type AppShellContextValue = {
  loading: boolean;
};

const AppShellContext = createContext<AppShellContextValue>({ loading: false });

export function useAppShell() {
  return useContext(AppShellContext);
}

export function AppShellProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { bootReady } = useAuth();
  const [loadingState, setLoadingState] = useState(getAppShellLoadingState);
  const bootLoaderHiddenLogged = useRef(false);

  useEffect(() => {
    return subscribeAppShell(() => {
      setLoadingState(getAppShellLoadingState());
    });
  }, []);

  useEffect(() => {
    if (!bootReady) return undefined;
    beginPageTransition();
    return () => {
      endPageTransition();
    };
  }, [bootReady, location.pathname]);

  useEffect(() => {
    if (!bootReady) return undefined;
    const timer = window.setTimeout(() => {
      forceHideAllLoading();
      if (!bootLoaderHiddenLogged.current) {
        bootLoaderHiddenLogged.current = true;
        markBootLoaderHidden('boot-timeout');
      }
    }, LOADER_MAX_MS);
    return () => window.clearTimeout(timer);
  }, [bootReady]);

  useEffect(() => {
    if (bootReady && !loadingState.active && !bootLoaderHiddenLogged.current) {
      bootLoaderHiddenLogged.current = true;
      markBootLoaderHidden('idle');
    }
  }, [bootReady, loadingState.active]);

  const showBootLoader = !bootReady;
  const showRuntimeLoader = bootReady && loadingState.active;
  const loaderVisible = showBootLoader || showRuntimeLoader;

  const value = useMemo(() => ({ loading: loaderVisible }), [loaderVisible]);

  return (
    <AppShellContext.Provider value={value}>
      <div id="toast-container" className="toast-container" />
      {children}
      <LerzoLogoLoader visible={loaderVisible} label="Loading..." />
    </AppShellContext.Provider>
  );
}
