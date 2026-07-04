import { copyFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const expectedUrl = 'https://app.lerzo.com';
const sourcePath = resolve('config/api-config.production.json');
const targetPath = resolve('config/api-config.json');

copyFileSync(sourcePath, targetPath);

const config = JSON.parse(readFileSync(targetPath, 'utf8'));
if (config.apiBaseUrl !== expectedUrl || config.webBaseUrl !== expectedUrl) {
  throw new Error('Production API config must point to https://app.lerzo.com');
}

console.log(`[API CONFIG] production config prepared: ${expectedUrl}`);
