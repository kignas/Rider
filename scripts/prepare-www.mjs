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
  "android-icons/mipmap-xhdpi/ic_launcher.png",
  "native-push.js",
  "rider-extras.js"
];
for (const file of files) {
  const from = path.join(root, file);
  if (!fs.existsSync(from)) throw new Error(`Required app file is missing: ${file}`);
  const target = path.join(out, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(from, target);
}
console.log(`Prepared ${files.length} app files in www/.`);


const indexPath = path.join(out, 'index.html');
let indexHtml = fs.readFileSync(indexPath, 'utf8');
if (!indexHtml.includes('src="./native-push.js"')) {
  indexHtml = indexHtml.replace('</body>', '  <script src="./native-push.js"></script>\n</body>');
  fs.writeFileSync(indexPath, indexHtml);
}
