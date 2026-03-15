#!/usr/bin/env node
/**
 * Watch frontend dist directory and copy to backend static on changes.
 * Run this after starting `npm run watch` in another terminal.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const distDir = path.join(__dirname, 'dist');
const backendStaticDir = path.join(__dirname, '..',', 'backend', 'static');

let lastCopyTime = 0;
const DEBOUNCE_MS = 1000;

function copyToBackend() {
  const now = Date.now();
  if (now - lastCopyTime < DEBOUNCE_MS) {
    return; // Debounce
  }

  try {
    // Ensure backend static directory exists
    if (!fs.existsSync(backendStaticDir)) {
      fs.mkdirSync(backendStaticDir, { recursive: true });
    }

    // Copy all files from dist to backend static
    const files = fs.readdirSync(distDir);
    for (const file of files) {
      const srcPath = path.join(distDir, file);
      const destPath = path.join(backendStaticDir, file);

      const stat = fs.statSync(srcPath);
      if (stat.isDirectory()) {
        // Remove existing directory first
        if (fs.existsSync(destPath)) {
          fs.rmSync(destPath, { recursive: true });
        }
        fs.cpSync(srcPath, destPath, { recursive: true });
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }

    lastCopyTime = now;
    console.log(`[${new Date().toLocaleTimeString()}] Copied frontend to backend/static/`);
  } catch (err) {
    console.error('Error copying files:', err.message);
  }
}

// Simple file watcher using recursive timeout
let lastMtime = {};

function checkForChanges() {
  try {
    const checkDir = (dir) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          checkDir(fullPath);
        } else {
          const key = fullPath.replace(distDir, '');
          if (lastMtime[key] !== stat.mtimeMs) {
            lastMtime[key] = stat.mtimeMs;
            copyToBackend();
            return; // Copy once per batch
          }
        }
      }
    };

    if (fs.existsSync(distDir)) {
      checkDir(distDir);
    }
  } catch (err) {
    // Directory might not exist yet during first build
  }

  setTimeout(checkForChanges, 500);
}

console.log('Watching frontend/dist for changes...');
console.log('Start frontend build with: npm run watch');
copyToBackend(); // Initial copy
checkForChanges();
