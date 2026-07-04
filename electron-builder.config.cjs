/**
 * Electron Builder configuration for Lerzo Desktop (Windows/macOS/Linux).
 *
 * ── Release identity (edit these for branding) ─────────────────────────────
 * VERSION:      package.json -> "version"  (single source of truth)
 * APP NAME:     package.json -> "productName"
 * APP ID:       appId below (Windows/macOS installer identity)
 * EXECUTABLE:   executableName below (Windows .exe file name)
 *
 * ── Windows icon (required for NSIS + MSI — do not remove) ───────────────
 * WIN_ICON must point to a committed .ico file. MSI WiX shortcuts reference
 * this icon; if missing, Light.exe fails with LGHT0094 (Icon:LerzoIcon.exe).
 *
 * ── Windows installer outputs (GitHub Actions / npm run dist:win) ─────────
 *   release/Lerzo-Setup-<version>.exe   (NSIS, Windows 10/11 x64)
 *   release/Lerzo-Setup-<version>.msi   (MSI, Windows 10/11 x64)
 *
 * ── Code signing (optional, disabled for now) ──────────────────────────────
 * To enable later, set CSC_LINK / CSC_KEY_PASSWORD in CI or locally and
 * uncomment certificateFile / certificatePassword in the win block below.
 */
const path = require('path');
const pkg = require('./package.json');

// Committed Windows icon — used by NSIS, MSI (WiX), and the packaged .exe metadata.
const WIN_ICON = path.resolve(__dirname, 'assets', 'LOGO.ico');

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.lerzo.desktop',
  productName: pkg.productName,
  executableName: 'Lerzo',
  copyright: 'Copyright © 2026 Lerzo',
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  files: [
    'main.js',
    'preload.js',
    'package.json',
    'dist/**',
    'offline/**',
    'splash/**',
    'assets/**',
    'build/**',
    'config/loadApiConfig.js',
    'config/api-config*.json',
  ],
  extraResources: [
    {
      from: 'config',
      to: 'config',
      filter: ['api-config*.json'],
    },
  ],
  protocols: {
    name: 'Lerzo',
    schemes: ['lerzo'],
  },
  asar: true,
  compression: 'maximum',
  removePackageScripts: true,
  mac: {
    target: [
      {
        target: 'dmg',
        arch: ['arm64', 'x64'],
      },
    ],
    category: 'public.app-category.productivity',
    icon: path.resolve(__dirname, 'build', 'icon.icns'),
    artifactName: 'Lerzo-mac-${arch}.${ext}',
    darkModeSupport: true,
    hardenedRuntime: false,
    gatekeeperAssess: false,
    extendInfo: {
      NSLocationWhenInUseUsageDescription:
        'Lerzo uses your location to set your coaching centre office coordinates for staff attendance.',
      NSLocationUsageDescription:
        'Lerzo uses your location to set your coaching centre office coordinates for staff attendance.',
    },
  },
  dmg: {
    title: 'Lerzo Installer',
    icon: path.resolve(__dirname, 'build', 'icon.icns'),
  },
  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      { target: 'msi', arch: ['x64'] },
    ],
    icon: WIN_ICON,
    requestedExecutionLevel: 'asInvoker',
    publisherName: 'Lerzo',
    // Code signing disabled until certificates are configured.
    signAndEditExecutable: false,
    // sign: './path/to/certificate.pfx',
    // certificateFile: './path/to/certificate.pfx',
    // certificatePassword: process.env.WIN_CSC_KEY_PASSWORD,
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    allowElevation: true,
    perMachine: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: pkg.productName,
    installerIcon: WIN_ICON,
    uninstallerIcon: WIN_ICON,
    installerHeaderIcon: WIN_ICON,
    artifactName: 'Lerzo-Setup-${version}.${ext}',
  },
  msi: {
    oneClick: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: pkg.productName,
    artifactName: 'Lerzo-Setup-${version}.${ext}',
    warningsAsErrors: false,
  },
  linux: {
    target: ['AppImage'],
    icon: path.resolve(__dirname, 'build', 'icon.png'),
    category: 'Utility',
    artifactName: 'Lerzo-linux-${arch}.${ext}',
  },
};
