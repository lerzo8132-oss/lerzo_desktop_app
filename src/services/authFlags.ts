let authExpiredHandled = false;

export function isAuthExpiredHandled() {
  return authExpiredHandled;
}

/** Returns true only the first time auth expires in this session. */
export function markAuthExpiredHandled() {
  if (authExpiredHandled) return false;
  authExpiredHandled = true;
  return true;
}

export function resetAuthExpiredHandled() {
  authExpiredHandled = false;
}
