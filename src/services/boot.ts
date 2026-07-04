export const BOOT_MAX_LOADER_MS = 3000;
export const AUTH_CHECK_TIMEOUT_MS = 8000;

let bootComplete = false;
const bootListeners = new Set<() => void>();

export function isBootComplete() {
  return bootComplete;
}

export function onBootComplete(listener: () => void) {
  bootListeners.add(listener);
  if (bootComplete) listener();
  return () => {
    bootListeners.delete(listener);
  };
}

export function markBootComplete(reason: string) {
  if (bootComplete) return;
  bootComplete = true;
  console.info('[BOOT] auth checked', reason);
  bootListeners.forEach((listener) => listener());
}

export function markBootRouteReady() {
  console.info('[BOOT] route ready');
}

export function markBootLoaderHidden(reason = 'complete') {
  console.info('[BOOT] loader hidden', reason);
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}
