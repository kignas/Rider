import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const files = [
  "index.html",
  "login.html",
  "apply.html",
  "rider-logic.js",
  "firebase-messaging-sw.js",
  "theme.css",
  "native-push.js",
  "rider-extras.js",
  "icon.png"
];
for (const file of files) {
  const from = path.join(root, file);
  if (!fs.existsSync(from)) throw new Error(`Required app file is missing: ${file}`);
  fs.copyFileSync(from, path.join(out, file));
}
console.log(`Prepared ${files.length} app files in www/.`);


const indexPath = path.join(out, 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');
if (!indexHtml.includes('src="./native-push.js"')) {
  indexHtml = indexHtml.replace('</body>', '  <script src="./native-push.js"></script>\n</body>');
  fs.writeFileSync(indexPath, indexHtml);
}


// Bundle the native background-location plugin for this vanilla-JS Capacitor app.
// The app does not use a framework bundler, so prepare the plugin bridge explicitly.
import { spawnSync } from 'node:child_process';
const esbuild = process.platform === 'win32' ? 'node_modules/.bin/esbuild.cmd' : 'node_modules/.bin/esbuild';
const build = spawnSync(esbuild, [
  'rider-background-location.js', '--bundle', '--platform=browser', '--format=iife',
  '--target=es2020', '--outfile=www/rider-background-location.bundle.js'
], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) throw new Error('Failed to bundle background location bridge. Run npm install and retry.');
let finalHtml = fs.readFileSync(indexPath, 'utf8');
if (!finalHtml.includes('rider-background-location.bundle.js')) {
  finalHtml = finalHtml.replace('</body>', '  <script src="./rider-background-location.bundle.js"></script>\n</body>');
  fs.writeFileSync(indexPath, finalHtml);
}
console.log('Bundled native background location bridge into www/.');
