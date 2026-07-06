#!/usr/bin/env node
/**
 * Static + local verification for Electron auth lifecycle.
 * Run: node scripts/verify-auth-lifecycle.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const passes = [];

function pass(msg) {
  passes.push(msg);
}

function fail(msg) {
  failures.push(msg);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function assertNoMatch(rel, pattern, label) {
  const content = read(rel);
  if (pattern.test(content)) {
    fail(`${label} (${rel})`);
    return false;
  }
  pass(`${label} OK (${rel})`);
  return true;
}

function assertMatch(rel, pattern, label) {
  const content = read(rel);
  if (!pattern.test(content)) {
    fail(`${label} missing (${rel})`);
    return false;
  }
  pass(`${label} OK (${rel})`);
  return true;
}

// 1. Main process must NOT navigate before renderer auth is ready
assertNoMatch(
  'main.js',
  /notifyRendererLoginComplete[\s\S]*?window\.location\.hash\s*=\s*['"]#\/dashboard['"]/,
  'Main notifyRendererLoginComplete must not set #/dashboard hash',
);

// 2. TemplateHtmlPage must not set dashboard hash in completeElectronLoginFromToken
(function assertCompleteElectronLoginFromToken() {
  const content = read('src/components/TemplateHtmlPage.tsx');
  const match = content.match(/async function completeElectronLoginFromToken[\s\S]*?\n\}/);
  if (!match) {
    fail('completeElectronLoginFromToken function not found (src/components/TemplateHtmlPage.tsx)');
    return;
  }
  if (/window\.location\.hash\s*=\s*['"]#\/dashboard['"]/.test(match[0])) {
    fail('completeElectronLoginFromToken must not set #/dashboard hash (src/components/TemplateHtmlPage.tsx)');
  } else {
    pass('completeElectronLoginFromToken must not set #/dashboard hash OK (src/components/TemplateHtmlPage.tsx)');
  }
}());

// 3. AuthContext must navigate only after user is loaded (post-refreshUser)
assertMatch(
  'src/context/AuthContext.tsx',
  /loginNavigatePending[\s\S]*?if \(!loginNavigatePending\.current \|\| !user\)[\s\S]*?window\.location\.hash = '#\/dashboard'/,
  'AuthContext navigates dashboard only after user state is set',
);

// 4. loginCompleting gate in App
assertMatch(
  'src/App.tsx',
  /loginCompleting[\s\S]*?LoadingScreen/,
  'App shows loader while loginCompleting',
);

// 5. Boot must not wipe user during active login callback
assertMatch(
  'src/context/AuthContext.tsx',
  /if \(!token\)[\s\S]*?callbackInFlight\.current/,
  'refreshUser skips user wipe during login callback',
);

// 6. Logout redirects to login
assertMatch(
  'src/context/AuthContext.tsx',
  /logout[\s\S]*?#\/auth-login/,
  'logout redirects to auth-login',
);

// 7. desktop-success auto-close hint
assertMatch(
  '../lerzo_web-main/templates/auth/desktop_success.html',
  /window\.close|attemptClose|closeTab/,
  'desktop-success attempts browser tab close',
);

// 8. Login page centered layout
assertMatch(
  'src/index.css',
  /\.auth-only \.auth-form-side[\s\S]*?justify-content:\s*center[\s\S]*?align-items:\s*center/,
  'auth-only form side centered',
);

// 9. Duplicate event dedupe
assertMatch(
  'src/context/AuthContext.tsx',
  /if \(callbackInFlight\.current\) \{[\s\S]*?return false/,
  'handleLoginCallback dedupes concurrent callbacks',
);

// --- Login transaction / state machine invariants (main process) ---

// 10. State machine states are defined
assertMatch(
  'main.js',
  /LOGIN_STATE\s*=\s*Object\.freeze\(\{[\s\S]*?IDLE[\s\S]*?LOGIN_STARTED[\s\S]*?WAITING_CALLBACK[\s\S]*?VERIFYING[\s\S]*?AUTHENTICATED[\s\S]*?LOGGED_OUT/,
  'main defines full login state machine',
);

// 11. A single-use nonce is generated when login starts
assertMatch(
  'main.js',
  /function beginLoginTransaction\(\)[\s\S]*?crypto\.randomBytes[\s\S]*?WAITING_CALLBACK/,
  'beginLoginTransaction mints a nonce and enters WAITING_CALLBACK',
);

// 12. Callback is rejected unless a login is actively pending and WAITING_CALLBACK
assertMatch(
  'main.js',
  /if \(!isPendingLoginActive\(\) \|\| loginState !== LOGIN_STATE\.WAITING_CALLBACK\)[\s\S]*?CALLBACK_REJECTED[\s\S]*?no_active_login_request/,
  'handleAuthCallback rejects callbacks outside an active transaction',
);

// 13. State must match the pending nonce
assertMatch(
  'main.js',
  /if \(state !== pendingLogin\.nonce\)[\s\S]*?state_mismatch/,
  'handleAuthCallback enforces state === pending nonce',
);

// 14. Nonce is consumed exactly once (replay protection)
assertMatch(
  'main.js',
  /consumedNonces\.add\(state\)[\s\S]*?clearPendingLogin\(\)[\s\S]*?CALLBACK_ACCEPTED/,
  'handleAuthCallback consumes the nonce before verifying (one-time use)',
);
assertMatch(
  'main.js',
  /if \(consumedNonces\.has\(state\)\)[\s\S]*?replay_consumed/,
  'handleAuthCallback rejects already-consumed nonces',
);

// 15. Login IPC attaches desktop=1 and the state nonce to the OAuth URL
assertMatch(
  'main.js',
  /function buildDesktopLoginUrl\(baseUrl, nonce\)[\s\S]*?appendQueryParam\(baseUrl, 'desktop', '1'\)[\s\S]*?appendQueryParam\(target, 'state', nonce\)/,
  'buildDesktopLoginUrl attaches desktop=1 and state nonce',
);
assertMatch(
  'main.js',
  /beginLoginTransaction\(\);\s*\n\s*const targetUrl = buildDesktopLoginUrl\(/,
  'login IPC builds desktop login URL with state nonce',
);

// 16. Startup processes queued deep links after boot when a login is pending
assertMatch(
  'main.js',
  /function flushQueuedDeepLink\(\)[\s\S]*?if \(!isPendingLoginActive\(\)\)[\s\S]*?no_active_login_request[\s\S]*?handleAuthCallback\(url, 'queued'\)/,
  'startup flushes queued deep links gated on active login',
);

// 17. Logout wipes everything and resets the machine
assertMatch(
  'main.js',
  /LOGOUT_STARTED[\s\S]*?clearSecureAuthToken\(\)[\s\S]*?clearPendingLogin\(\)[\s\S]*?consumedNonces\.clear\(\)[\s\S]*?LOGGED_OUT[\s\S]*?indexdb[\s\S]*?LOGOUT_FINISHED/,
  'logout clears token, pending login, nonces, storage and resets state',
);

// 18. Structured lifecycle logging present
['LOGIN_STARTED', 'OAUTH_OPENED', 'CALLBACK_RECEIVED', 'CALLBACK_ACCEPTED', 'CALLBACK_REJECTED', 'JWT_SAVED', 'ME_RESPONSE', 'AUTHENTICATED', 'LOGOUT_FINISHED'].forEach((evt) => {
  assertMatch('main.js', new RegExp(`authLog\\('${evt}'`), `structured log: ${evt}`);
});

// --- Web side transaction threading ---

// 19. google_login_start captures the state nonce into the session
assertMatch(
  '../lerzo_web-main/routes/auth.py',
  /state = request\.args\.get\('state'\)[\s\S]*?session\['electron_state'\] = state/,
  'web google_login_start stores login state nonce',
);

// 20. desktop success echoes state back in the deep link and is one-time
assertMatch(
  '../lerzo_web-main/routes/auth.py',
  /callback_url \+= f"&state=\{quote\(str\(state\)[\s\S]*?session\.pop\('electron_state', None\)[\s\S]*?session\.pop\('desktop_bridge_token', None\)/,
  'web desktop success echoes state and consumes it (one-time)',
);

// 21. desktop_success.html has a one-time execution guard
assertMatch(
  '../lerzo_web-main/templates/auth/desktop_success.html',
  /lerzo_desktop_link_fired[\s\S]*?sessionStorage[\s\S]*?history\.replaceState/,
  'desktop-success page guards against reload/back replay',
);

// --- Immediate renderer notification + ack watchdog ---

// 22. Main arms a 2s renderer-ack watchdog after notifying
assertMatch(
  'main.js',
  /const RENDERER_ACK_TIMEOUT_MS = 2000/,
  'renderer ack watchdog uses a 2s timeout',
);
assertMatch(
  'main.js',
  /async function notifyRendererLoginComplete\(\)[\s\S]*?send\('auth-token-received'\)[\s\S]*?armRendererAckWatchdog\(\)/,
  'notifyRendererLoginComplete pushes IPC then arms the ack watchdog',
);

// 23. On ack timeout, force a renderer session refresh (not app restart)
assertMatch(
  'main.js',
  /forceRendererSessionRefresh[\s\S]*?navigateMainWindow\('#\/dashboard'\)/,
  'ack timeout forces a renderer session refresh to the dashboard',
);
assertMatch(
  'main.js',
  /ipcMain\.on\('auth-renderer-ack'[\s\S]*?authLog\('DASHBOARD_ACK'/,
  'renderer ack logs DASHBOARD_ACK',
);

// 24. Renderer acknowledges after navigating to the dashboard
assertMatch(
  'src/context/AuthContext.tsx',
  /window\.location\.hash = '#\/dashboard'[\s\S]*?electronAPI\?\.ackDesktopLogin\?\.\(\)/,
  'renderer acks main after dashboard navigation',
);
assertMatch(
  'preload.js',
  /ackDesktopLogin:\s*\(\)\s*=>[\s\S]*?ipcRenderer\.send\('auth-renderer-ack'\)/,
  'preload exposes ackDesktopLogin',
);

// --- Exact reject reasons + verify-before-save + no auto-logout ---

// 25. Exact reject reason vocabulary is present
['no_active_login_request', 'missing_state', 'state_mismatch', 'token_missing', 'token_verify_failed'].forEach((reason) => {
  assertMatch('main.js', new RegExp(`reason:\\s*'${reason}'`), `reject reason logged: ${reason}`);
});

// 26. Token is verified BEFORE it is persisted (no accidental session overwrite)
assertMatch(
  'main.js',
  /await verifyDesktopAuthToken\(token\);[\s\S]*?const tokenSaved = saveSecureAuthToken\(token\)/,
  'handleAuthCallback verifies token before saving it',
);

// 27. No auto-logout: an existing valid session is preserved on a failed login
assertMatch(
  'main.js',
  /const hadExistingSession = Boolean\(loadSecureAuthToken\(\)\)[\s\S]*?if \(!hadExistingSession\)[\s\S]*?clearSecureAuthToken\(\)/,
  'failed login does not clear a pre-existing session',
);

// 28. Main pushes an immediate failure signal to the renderer
assertMatch(
  'main.js',
  /function notifyRendererLoginFailed\(reason\)[\s\S]*?send\('auth-login-failed', reason\)/,
  'main notifies renderer of login failure via IPC',
);
assertMatch(
  'main.js',
  /notifyRendererLoginFailed\('token_verify_failed'\)/,
  'token verify failure notifies the renderer',
);

// 29. Renderer reacts to the failure signal (retry + button reset), bounded wait
assertMatch(
  'preload.js',
  /onAuthLoginFailed:\s*\(callback\)[\s\S]*?ipcRenderer\.on\('auth-login-failed'/,
  'preload exposes onAuthLoginFailed',
);
assertMatch(
  'src/components/TemplateHtmlPage.tsx',
  /onAuthLoginFailed\?\.\(\(reason\) => failWithRetry\(reason\)\)/,
  'login watch resets on main-process failure signal',
);
assertMatch(
  'src/components/TemplateHtmlPage.tsx',
  /const maxAttempts = 30/,
  'login watch has a 60s fallback poll window',
);

// --- Web side: desktop=1 recognition + robust state capture ---

// 30. Backend recognizes desktop=1 and captures state via helper
assertMatch(
  '../lerzo_web-main/routes/auth.py',
  /request\.args\.get\('desktop'\) == '1'/,
  'backend recognizes desktop=1 electron requests',
);
assertMatch(
  '../lerzo_web-main/routes/auth.py',
  /def _capture_electron_state\(\)[\s\S]*?session\['electron_state'\] = state/,
  'backend has a reusable state-capture helper',
);

// --- Renderer IPC listener reliability (desktop login notification) ---

// 31. preload exposes both named subscriptions + ack
assertMatch('preload.js', /onAuthTokenReceived:\s*\(callback\)/, 'preload exposes onAuthTokenReceived');
assertMatch('preload.js', /onLoginComplete:\s*\(callback\)/, 'preload exposes onLoginComplete');

// 32. Listeners are registered in a mount-only effect (empty deps) so they are
//     never torn down by unrelated state/dependency changes before a callback.
assertMatch(
  'src/context/AuthContext.tsx',
  /desktop-login listeners registered[\s\S]*?\n\s*\}, \[\]\);/,
  'auth IPC listeners registered once (mount-only effect)',
);
assertMatch(
  'src/context/AuthContext.tsx',
  /onAuthTokenReceived\?\.\(onDesktopLogin\)[\s\S]*?onLoginComplete\?\.\(onDesktopLogin\)/,
  'renderer subscribes to both onAuthTokenReceived and onLoginComplete',
);

// 33. refreshUser supports force (bypasses in-flight de-dup for login callback)
assertMatch(
  'src/context/AuthContext.tsx',
  /if \(options\?\.force\)\s*\{[\s\S]*?refreshInFlight\.current = null/,
  'refreshUser supports force option',
);
assertMatch(
  'src/context/AuthContext.tsx',
  /refreshUser\(\{ silent: true, force: true \}\)/,
  'login callback forces a fresh refreshUser',
);

// 34. Required structured renderer logs are present
[
  '\\[Renderer Auth\\] IPC auth-token-received received',
  '\\[Renderer Auth\\] refreshUser success',
  '\\[Renderer Auth\\] navigating dashboard',
  '\\[Renderer Auth\\] dashboard mounted, ack sent',
].forEach((log) => {
  const inCtx = new RegExp(log).test(read('src/context/AuthContext.tsx'));
  const inPreload = new RegExp(log).test(read('preload.js'));
  if (inCtx || inPreload) pass(`renderer log present: ${log}`);
  else fail(`renderer log missing: ${log}`);
});

// 35. AppRoutes never redirects to /auth-login while a desktop login completes
assertMatch(
  'src/App.tsx',
  /if \(!isAuthenticated && !isPublicPath && !loginCompleting\)/,
  'AppRoutes suppresses /auth-login redirect while loginCompleting',
);

// 36. Windows deep-link delivery instrumentation
['PROTOCOL_REGISTERED', 'INITIAL_ARGV', 'SECOND_INSTANCE_ARGV', 'DASHBOARD_ACK'].forEach((evt) => {
  assertMatch('main.js', new RegExp(`authLog\\('${evt}'`), `structured log: ${evt}`);
});
assertMatch(
  'main.js',
  /function extractDeepLinkFromArgs\([\s\S]*?lerzo:\/\//,
  'main extracts lerzo:// URLs from argv robustly',
);
assertMatch(
  'main.js',
  /registerLerzoProtocolClient\(\)[\s\S]*?process\.platform === 'win32'[\s\S]*?setAsDefaultProtocolClient\('lerzo', process\.execPath, \[\]\)/,
  'Windows packaged protocol binds to process.execPath',
);
assertMatch(
  'main.js',
  /if \(gotSingleInstanceLock\) \{[\s\S]*?registerLerzoProtocolClient\(\)/,
  'protocol registered before app ready on Windows',
);

console.log('\n=== Electron Auth Lifecycle Verification ===\n');
passes.forEach((p) => console.log('✓', p));
failures.forEach((f) => console.log('✗', f));
console.log(`\n${passes.length} passed, ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
