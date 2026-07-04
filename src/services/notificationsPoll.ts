import { getDesktopApiBaseUrl } from '../config/api';
import { getAuthToken } from './api';
import { resetAuthExpiredHandled } from './authFlags';

const POLL_INTERVAL_MS = 30000;

let pollerId: number | null = null;
let pollInFlight = false;

async function pollNotifications() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const token = await getAuthToken();
    if (!token) return;

    const response = await fetch(`${getDesktopApiBaseUrl()}/notifications/list`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 401) {
      // Do not clear desktop login from background notification polling.
      return;
    }

    if (!response.ok) return;
    await response.json();
  } catch {
    // Ignore transient network errors; do not stop polling.
  } finally {
    pollInFlight = false;
  }
}

export function stopNotificationPoller() {
  if (pollerId !== null) {
    window.clearInterval(pollerId);
    pollerId = null;
  }
}

export async function startNotificationPoller() {
  stopNotificationPoller();
  resetAuthExpiredHandled();

  const token = await getAuthToken();
  if (!token) return;

  await pollNotifications();
  pollerId = window.setInterval(() => {
    void pollNotifications();
  }, POLL_INTERVAL_MS);
}
