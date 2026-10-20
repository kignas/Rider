import fs from 'node:fs';

const manifestPath = 'android/app/src/main/AndroidManifest.xml';
if (!fs.existsSync(manifestPath)) {
  throw new Error(`Android manifest not found: ${manifestPath}. Run npx cap add android and npx cap sync android first.`);
}

let manifest = fs.readFileSync(manifestPath, 'utf8');
if (!/<manifest\b[^>]*[\s\S]*?>/.test(manifest)) {
  throw new Error('Could not find the opening <manifest> element in AndroidManifest.xml.');
}

const required = [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  'android.permission.POST_NOTIFICATIONS'
];
const missing = required.filter(permission =>
  !new RegExp(String.raw`<uses-permission\s+[^>]*android:name=["']${permission}["']`).test(manifest)
);

if (missing.length) {
  const declarations = missing.map(permission =>
    `    <uses-permission android:name="${permission}" />`
  ).join('\n');
  manifest = manifest.replace(/<manifest\b[^>]*>/, match => `${match}\n${declarations}`);
  fs.writeFileSync(manifestPath, manifest);
}

const verify = fs.readFileSync(manifestPath, 'utf8');
for (const permission of required) {
  if (!new RegExp(String.raw`<uses-permission\s+[^>]*android:name=["']${permission}["']`).test(verify)) {
    throw new Error(`Required location permission is missing after patch: ${permission}`);
  }
}
console.log('Verified location, foreground-service, and notification permissions for background tracking.');
