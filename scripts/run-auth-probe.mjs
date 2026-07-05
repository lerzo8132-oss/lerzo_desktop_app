#!/usr/bin/env node
/**
 * Runtime auth lifecycle probe for Electron renderer.
 * Validates token persistence + callback ordering without Google OAuth UI.
 *
 * Usage:
 *   LERZO_AUTH_PROBE=1 npm run start
 *   node scripts/run-auth-probe.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const probeLog = path.join(os.tmpdir(), 'lerzo-auth-probe.log');
const timeoutMs = 45000;

function readAuthTokenFile() {
  const candidates = [
    path.join(os.homedir(), 'Library', 'Application Support', 'Lerzo', 'auth-token.bin'),
    path.join(os.homedir(), 'Library', 'Application Support', 'lerzo', 'auth-token.bin'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function main() {
  const tokenPath = readAuthTokenFile();
  if (!tokenPath) {
    console.warn('No persisted auth token found; probe will validate unauthenticated boot only.');
  } else {
    console.log('Found persisted token at', tokenPath);
  }

  fs.writeFileSync(probeLog, '');

  const electronBin = process.platform === 'darwin'
    ? path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron')
    : path.join(root, 'node_modules', '.bin', 'electron');

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const electron = spawn(electronBin, ['.'], {
    cwd: root,
    env: {
      ...env,
      LERZO_AUTH_PROBE: '1',
      LERZO_AUTH_PROBE_LOG: probeLog,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  electron.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  electron.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      electron.kill('SIGTERM');
      resolve({ timedOut: true });
    }, timeoutMs);

    electron.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut: false });
    });
  });

  const probeOutput = fs.existsSync(probeLog) ? fs.readFileSync(probeLog, 'utf8') : '';
  const checks = [
    ['PROBE_BOOT', /PROBE_BOOT/],
    ['PROBE_AUTH_PROVIDER', /PROBE_AUTH_PROVIDER/],
    // Watch recursion regression guard — always runs (no token needed).
    ['PROBE_LOGIN_WATCH_STARTED', /PROBE_LOGIN_WATCH_STARTED clicked=yes/],
    ['PROBE_WATCH_NO_OVERFLOW', /PROBE_WATCH_NO_OVERFLOW/],
    // Transaction / replay guard tests — always run (no valid token needed).
    ['GUARD: reject callback with no active login', /PROBE_GUARD_NO_ACTIVE pass/],
    ['GUARD: reject state mismatch (pending survives)', /PROBE_GUARD_STATE_MISMATCH pass/],
    ['GUARD: reject callback with missing state', /PROBE_GUARD_MISSING_STATE pass/],
  ];

  if (tokenPath) {
    checks.push(['PROBE_CALLBACK', /PROBE_CALLBACK/]);
    checks.push(['PROBE_NO_OVERFLOW', /PROBE_NO_OVERFLOW/]);
    checks.push(['REPLAY: same callback rejected after accept', /PROBE_REPLAY_REJECTED pass/]);
    checks.push(['PROBE_DASHBOARD', /PROBE_DASHBOARD/]);
    checks.push(['PROBE_LOGOUT (full wipe + state reset)', /PROBE_LOGOUT\b/]);
    checks.push(['RELOGIN: new transaction works after logout', /PROBE_RELOGIN_READY pass/]);
  }

  console.log('\n=== Auth Probe Results ===\n');
  checks.forEach(([label, pattern]) => {
    const ok = pattern.test(probeOutput);
    console.log(`${ok ? '✓' : '✗'} ${label}`);
  });

  if (probeOutput.trim()) {
    console.log('\n--- probe log ---\n' + probeOutput.trim());
  }

  if (stdout.includes('[Electron Auth] callback error')) {
    console.error('\nElectron auth callback error detected in stdout.');
    process.exitCode = 1;
  }

  if (result.timedOut) {
    console.error(`Probe timed out after ${timeoutMs}ms`);
    process.exitCode = 1;
  }

  const failed = checks.some(([, pattern]) => !pattern.test(probeOutput));
  if (failed) process.exitCode = 1;

  if (stderr.trim()) {
    console.log('\n--- stderr (tail) ---\n' + stderr.trim().slice(-1200));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
