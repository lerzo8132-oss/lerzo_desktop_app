#!/usr/bin/env node
/**
 * Wipe all Lerzo Electron auth/session data for clean OAuth testing.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const userDataDirs = [
  path.join(home, 'Library', 'Application Support', 'Lerzo'),
  path.join(home, 'Library', 'Application Support', 'lerzo'),
];

function rm(target) {
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

function clearDirContents(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir)) {
    rm(path.join(dir, entry));
    count += 1;
  }
  return count;
}

let removed = [];

for (const userData of userDataDirs) {
  if (!fs.existsSync(userData)) continue;

  for (const file of ['auth-token.bin', 'auth-suggestions.json', 'Cookies', 'Cookies-journal']) {
    const target = path.join(userData, file);
    if (rm(target)) removed.push(target);
  }

  for (const dir of ['Local Storage', 'Session Storage', 'Cache', 'Code Cache', 'GPUCache', 'blob_storage']) {
    const target = path.join(userData, dir);
    if (rm(target)) removed.push(target);
  }

  const partitionDir = path.join(userData, 'Partitions', 'lerzo');
  if (fs.existsSync(partitionDir)) {
    clearDirContents(partitionDir);
    removed.push(`${partitionDir}/*`);
  }
}

console.log('Cleared Electron auth/session data:');
if (!removed.length) {
  console.log('  (nothing found — already clean)');
} else {
  removed.forEach((item) => console.log(`  - ${item}`));
}
