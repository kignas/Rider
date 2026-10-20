import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../rider-background-location.js', import.meta.url), 'utf8');
test('background tracker uses native foreground notification and avoids incompatible native POST', () => {
  assert.match(source, /backgroundTitle:/);
  assert.match(source, /backgroundMessage:/);
  assert.match(source, /minIntervalMs:\s*15000/);
  assert.match(source, /networkFallback:\s*true/);
  assert.match(source, /Deliberately no native `url`/);
});
test('background tracker requests location and notification permission explicitly', () => {
  assert.match(source, /requestPermissions\(\{ permissions: \['location', 'notification'\] \}\)/);
});
