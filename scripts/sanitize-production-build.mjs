import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const buildDir = 'dist';
const productionUrl = 'https://app.lerzo.com';
const replacements = [
  [/http:\/\/localhost/g, productionUrl],
  [/https:\/\/localhost/g, productionUrl],
];
const forbidden = [
  /localhost/i,
  /127\.0\.0\.1/,
  /192\.168/,
  /api\.lerzo\.com/i,
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const filePath = join(dir, name);
    const stats = statSync(filePath);
    return stats.isDirectory() ? walk(filePath) : [filePath];
  });
}

const textExtensions = new Set(['.html', '.js', '.css', '.json', '.map', '.txt', '.svg']);
const files = walk(buildDir).filter((filePath) => {
  const dotIndex = filePath.lastIndexOf('.');
  return dotIndex !== -1 && textExtensions.has(filePath.slice(dotIndex));
});

for (const filePath of files) {
  let contents = readFileSync(filePath, 'utf8');
  const original = contents;
  for (const [pattern, replacement] of replacements) {
    contents = contents.replace(pattern, replacement);
  }
  if (filePath.endsWith('.html')) {
    // Module scripts with crossorigin fail under Electron file:// loads.
    contents = contents.replace(/\s+crossorigin(?:="[^"]*")?/g, '');
  }
  if (contents !== original) {
    writeFileSync(filePath, contents);
  }
}

const failures = [];
for (const filePath of files) {
  const contents = readFileSync(filePath, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(contents)) {
      failures.push(`${filePath}: ${pattern}`);
    }
  }
}

if (failures.length) {
  throw new Error(`Forbidden production URL strings found:\n${failures.join('\n')}`);
}

console.log('[API CONFIG] production build URL scan passed');
