/**
 * Entry point: mount the 3D Maze on the page's canvas and start the frame loop.
 * `createApp` shows a Win95-styled message box instead of throwing when WebGL is missing.
 */
import { createApp } from './app.js';

createApp(document.getElementById('maze-canvas')).start();
