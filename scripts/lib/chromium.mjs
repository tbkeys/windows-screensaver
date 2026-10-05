// Shared headless-Chromium launcher for the smoke test and the dev scripts.
//
// Browser resolution order: the CHROMIUM_PATH environment variable, then the browser that
// the cloud sandbox pre-installs, then Playwright's own bundled Chromium (installed with
// `npx playwright install chromium`). SwiftShader flags make WebGL 2 work without a GPU.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

export const CHROMIUM_ARGS = Object.freeze([
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
]);

const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';

/** Path of the Chromium binary to use, or undefined to let Playwright pick its bundled one. */
export function chromiumExecutable() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  return existsSync(SANDBOX_CHROMIUM) ? SANDBOX_CHROMIUM : undefined;
}

/**
 * Launch headless Chromium with software WebGL. Extra `args` are appended; any other
 * Playwright launch option can be passed through.
 */
export function launchChromium({ args = [], ...options } = {}) {
  return chromium.launch({
    headless: true,
    executablePath: chromiumExecutable(),
    args: [...CHROMIUM_ARGS, ...args],
    ...options,
  });
}
