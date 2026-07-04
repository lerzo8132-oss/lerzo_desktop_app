export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'lerzo_theme';

export function getStoredThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark' || stored === 'system') {
    return stored;
  }
  return 'system';
}

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return preference;
}

export function applyTheme(preference?: ThemePreference): 'light' | 'dark' {
  const pref = preference ?? getStoredThemePreference();
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.themePreference = pref;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

let systemListenerAttached = false;

export function initTheme(): void {
  applyTheme();

  if (systemListenerAttached) return;
  systemListenerAttached = true;

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStoredThemePreference() === 'system') {
      applyTheme('system');
    }
  });
}
