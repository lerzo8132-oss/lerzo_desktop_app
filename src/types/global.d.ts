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
      apiBaseUrl: string;
      webBaseUrl: string;
      desktopApiBaseUrl: string;
      healthUrl: string;
      googleLoginUrl: string;
      meUrl: string;
      logoutUrl: string;
    }>;
    getSecureAuthToken?: () => Promise<string | null>;
    setSecureAuthToken?: (token: string) => Promise<boolean>;
    clearSecureAuthToken?: () => Promise<boolean>;
    onAuthTokenReceived?: (callback: () => void) => () => void;
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
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
