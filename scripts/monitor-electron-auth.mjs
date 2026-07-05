#!/usr/bin/env node
/**
 * Poll Electron auth state during live OAuth testing.
 * Usage: node scripts/monitor-electron-auth.mjs [seconds]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const durationSec = Number(process.argv[2] || 120);
const tokenPath = [
  path.join(os.homedir(), 'Library', 'Application Support', 'Lerzo', 'auth-token.bin'),
  path.join(os.homedir(), 'Library', 'Application Support', 'lerzo', 'auth-token.bin'),
].find((candidate) => fs.existsSync(candidate));

const logPath = path.join(os.homedir(), 'Library', 'Application Support', 'Lerzo', 'logs', 'main.log');
let lastLogSize = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
let tokenSeen = false;
let me200Seen = false;
let callbackSeen = false;
let dashboardSeen = false;

function readNewLogs() {
  if (!fs.existsSync(logPath)) return [];
  const size = fs.statSync(logPath).size;
  if (size <= lastLogSize) return [];
  const chunk = fs.readFileSync(logPath).slice(lastLogSize).toString('utf8');
  lastLogSize = size;
  return chunk.split('\n').filter(Boolean);
}

console.log(`Monitoring auth for ${durationSec}s`);
console.log(`Token file: ${tokenPath || '(not found yet)'}`);
console.log(`Log file: ${logPath}`);

const started = Date.now();
const timer = setInterval(() => {
  const lines = readNewLogs();
  for (const line of lines) {
    if (/deep link received|token saved|auth-token-received|Desktop login completed/i.test(line)) {
      callbackSeen = true;
      console.log(`[CALLBACK] ${line.trim()}`);
    }
    if (/\/me status = 200/i.test(line)) {
      me200Seen = true;
      console.log(`[/ME 200] ${line.trim()}`);
    }
    if (/Renderer did-finish-load.*dashboard/i.test(line)) {
      dashboardSeen = true;
      console.log(`[DASHBOARD] ${line.trim()}`);
    }
    if (/\[Renderer Auth\]|login callback received|lerzo-login-complete/i.test(line)) {
      console.log(`[RENDERER] ${line.trim()}`);
    }
  }

  const tokenExists = tokenPath && fs.existsSync(tokenPath);
  if (tokenExists && !tokenSeen) {
    tokenSeen = true;
    console.log('[JWT STORED] auth-token.bin created/updated');
  }

  if (Date.now() - started >= durationSec * 1000) {
    clearInterval(timer);
    console.log('\n=== Monitor summary ===');
    console.log(`JWT stored: ${tokenSeen ? 'yes' : 'no'}`);
    console.log(`Callback received: ${callbackSeen ? 'yes' : 'no'}`);
    console.log(`/me HTTP 200: ${me200Seen ? 'yes' : 'no'}`);
    console.log(`Dashboard load logged: ${dashboardSeen ? 'yes' : 'no'}`);
    process.exit(tokenSeen && callbackSeen && me200Seen ? 0 : 1);
  }
}, 1000);
