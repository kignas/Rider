import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/add-fullscreen-alert.mjs');

test('full-screen alert script patches an Android project once', () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'fsa-'));
  fs.mkdirSync(path.join(t, 'android/app/src/main'), { recursive: true });
  fs.writeFileSync(path.join(t, 'capacitor.config.json'), JSON.stringify({ appId: 'com.example.app' }));
  fs.writeFileSync(path.join(t, 'android/app/src/main/AndroidManifest.xml'), '<manifest>\n<application>\n</application>\n</manifest>');
  fs.writeFileSync(path.join(t, 'android/app/build.gradle'), 'plugins {}\n\ndependencies {\n}\n');
  const env = { ...process.env, ALERT_TYPES: 'new_order,x' };
  for (let i = 0; i < 2; i++) execFileSync('node', [script], { cwd: t, env });
  const mf = fs.readFileSync(path.join(t, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.equal(mf.split('AlertActivity').length - 1, 1);
  assert.match(mf, /USE_FULL_SCREEN_INTENT/);
  const svc = fs.readFileSync(path.join(t, 'android/app/src/main/java/com/example/app/AlertMessagingService.java'), 'utf8');
  assert.match(svc, /package com\.example\.app;/);
  assert.match(svc, /"new_order,x"/);
  assert.equal(fs.readFileSync(path.join(t, 'android/app/build.gradle'), 'utf8').split('firebase-messaging').length - 1, 1);
});
