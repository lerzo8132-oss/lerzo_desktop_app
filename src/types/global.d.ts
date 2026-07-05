interface Window {
  gsap?: {
    from: (...args: unknown[]) => void;
    fromTo: (...args: unknown[]) => void;
    set: (...args: unknown[]) => void;
    to: (...args: unknown[]) => void;
  };
  lucide?: {
    createIcons: () => void;
  };
  showToast?: ((message: string, type?: string) => void) | ((title: string, message: string, type?: string) => void);
  markAllNotificationsAsRead?: () => Promise<void>;
  markAllNotificationsRead?: () => Promise<void>;
  isElectron?: boolean;
  electronAPI?: {
    auth?: {
      loginWithGoogle?: () => Promise<boolean>;
    };
    clearAuthSession?: () => Promise<boolean>;
    startGoogleLogin?: (url?: string) => Promise<boolean>;
    getApiConfig?: () => Promise<{
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
    }>;
    checkInternet?: () => Promise<boolean>;
    getConnectivityStatus?: () => Promise<{ reason: 'network' | 'server' | 'renderer'; internet: boolean; backend: boolean }>;
    pollDesktopAuthToken?: () => Promise<{ ready: boolean; error?: string }>;
    getSecureAuthToken?: () => Promise<string | null>;
    setSecureAuthToken?: (token: string) => Promise<boolean>;
    clearSecureAuthToken?: () => Promise<boolean>;
    getLoginState?: () => Promise<{
      loginState: string;
      pending: boolean;
      pendingExpiresAt: number | null;
      consumedCount: number;
    }>;
    onAuthTokenReceived?: (callback: () => void) => () => void;
    onLoginComplete?: (callback: () => void) => () => void;
    ackDesktopLogin?: () => void;
    onAuthLoginFailed?: (callback: (reason: string) => void) => () => void;
    recordApiEvent?: (payload: unknown) => Promise<boolean>;
    recordRuntimeError?: (payload: unknown) => Promise<boolean>;
    getApiMonitorSnapshot?: () => Promise<unknown>;
    rememberEmail?: (email: string) => Promise<boolean>;
    getEmailSuggestions?: (prefix?: string) => Promise<string[]>;
    setCurrentUserSnapshot?: (user: unknown) => Promise<boolean>;
    openLocationSettings?: () => Promise<boolean>;
    setPageMap?: (pages: unknown[]) => Promise<boolean>;
  };
}

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_APP_ENV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
