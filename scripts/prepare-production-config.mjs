import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const expectedUrl = 'https://app.lerzo.com';
const sourcePath = resolve('config/api-config.production.json');
const targetPath = resolve('config/api-config.json');

copyFileSync(sourcePath, targetPath);

const config = JSON.parse(readFileSync(targetPath, 'utf8'));
if (config.apiBaseUrl !== expectedUrl || config.webBaseUrl !== expectedUrl) {
  throw new Error('Production API config must point to https://app.lerzo.com');
}

const winIconSource = resolve('assets/LOGO.ico');
const winIconTarget = resolve('build/icon.ico');
if (!existsSync(winIconSource)) {
  throw new Error('Missing Windows icon at assets/LOGO.ico (required for NSIS/MSI builds).');
}
copyFileSync(winIconSource, winIconTarget);

const logoSource = resolve('assets/LOGO.png');
const logoTarget = resolve('public/static/images/lezo-logo.png');
if (!existsSync(logoSource)) {
  throw new Error('Missing assets/LOGO.png (required for renderer boot logo).');
}
mkdirSync(dirname(logoTarget), { recursive: true });
copyFileSync(logoSource, logoTarget);

console.log(`[API CONFIG] production config prepared: ${expectedUrl}`);
console.log(`[BUILD] Windows icon ready: ${winIconTarget}`);
console.log(`[BUILD] Renderer logo ready: ${logoTarget}`);
