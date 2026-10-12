import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const files = [
  "index.html",
  "login.html",
  "firebase-messaging-sw.js",
  "theme.css"
];
for (const file of files) {
  const from = path.join(root, file);
  if (!fs.existsSync(from)) throw new Error(`Required app file is missing: ${file}`);
  fs.copyFileSync(from, path.join(out, file));
}
console.log(`Prepared ${files.length} app files in www/.`);
