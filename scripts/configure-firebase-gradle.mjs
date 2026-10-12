import fs from 'node:fs';

const rootFile = 'android/build.gradle';
const appFile = 'android/app/build.gradle';
if (!fs.existsSync(rootFile) || !fs.existsSync(appFile)) {
  throw new Error('Android Gradle files are missing; run npx cap add android first.');
}
let root = fs.readFileSync(rootFile, 'utf8');
let app = fs.readFileSync(appFile, 'utf8');

if (!root.includes('com.google.gms:google-services')) {
  const dependenciesStart = root.indexOf('dependencies {');
  if (dependenciesStart < 0) throw new Error('Could not find dependencies block in android/build.gradle.');
  root = root.slice(0, dependenciesStart) +
    root.slice(dependenciesStart).replace('dependencies {',
      "dependencies {\n        classpath 'com.google.gms:google-services:4.4.2'");
}
if (!app.includes("com.google.gms.google-services") && !app.includes("com.google.gms.google-services'")) {
  if (app.includes('plugins {')) app = app.replace('plugins {', "plugins {\n    id 'com.google.gms.google-services'");
  else if (app.includes("apply plugin: 'com.android.application'"))
    app = app.replace("apply plugin: 'com.android.application'", "apply plugin: 'com.android.application'\napply plugin: 'com.google.gms.google-services'");
  else throw new Error('Could not add Google Services plugin to android/app/build.gradle.');
}
fs.writeFileSync(rootFile, root);
fs.writeFileSync(appFile, app);
console.log('Configured Google Services Gradle plugin.');
