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
  "native-push.js"
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
