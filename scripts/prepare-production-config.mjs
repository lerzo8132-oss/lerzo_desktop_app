import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const expectedOrigin = 'https://app.lerzo.com';
const sourcePath = resolve('config/api-config.production.json');
const targetPath = resolve('config/api-config.json');

function resolveProductionOrigin(raw, fallback = expectedOrigin) {
  const source = String(raw || fallback).trim();
  if (!source) {
    return fallback;
  }

  try {
    const parsed = new URL(source.includes('://') ? source : `https://${source}`);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return fallback;
  }
}

const apiBaseUrl = resolveProductionOrigin(
  process.env.VITE_API_BASE_URL || process.env.LERZO_API_BASE_URL,
  expectedOrigin,
);
const appEnv = String(process.env.VITE_APP_ENV || 'production').trim() || 'production';

const productionConfig = {
  apiBaseUrl,
  webBaseUrl: apiBaseUrl,
  appEnv,
};

writeFileSync(targetPath, `${JSON.stringify(productionConfig, null, 2)}\n`);

const config = JSON.parse(readFileSync(targetPath, 'utf8'));
if (config.apiBaseUrl !== expectedOrigin || config.webBaseUrl !== expectedOrigin) {
  throw new Error(`Production API config must resolve to ${expectedOrigin}, got ${config.apiBaseUrl}`);
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

console.log(`[API CONFIG] production config prepared: ${config.apiBaseUrl}`);
console.log(`[API CONFIG] appEnv=${config.appEnv}`);
console.log(`[BUILD] Windows icon ready: ${winIconTarget}`);
console.log(`[BUILD] Renderer logo ready: ${logoTarget}`);
