/**
 * Entry point: mount the 3D Maze on the page's canvas and start the frame loop.
 * `createApp` shows a Win95-styled message box instead of throwing when WebGL is missing.
 * Anything else that throws during boot is almost certainly a corrupt saved setting, so
 * the saved settings are dropped and the app boots once more with defaults rather than
 * leaving a blank page that only clearing site data would fix.
 */
import { createApp } from './app.js';
import { clearStoredSettings, replaceUrl } from './app/settings.js';

const canvas = document.getElementById('maze-canvas');

try {
  createApp(canvas).start();
} catch (error) {
  console.error('[3D Maze] boot failed; retrying with default settings', error);
  clearStoredSettings();
  replaceUrl(location.pathname + location.search);
  for (const node of document.querySelectorAll('.w95-window, .w95-taskbar, #fade-overlay')) node.remove();
  createApp(canvas).start();
}
