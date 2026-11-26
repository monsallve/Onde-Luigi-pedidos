import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { resolvePwaTargetForPathname } from './pwaManifest.ts';

test('resolves non-overlapping PWA manifest and SW targets for /pos/ vs /autoservicio/', () => {
  const pos = resolvePwaTargetForPathname('/pos/');
  const auto = resolvePwaTargetForPathname('/autoservicio/');
  const root = resolvePwaTargetForPathname('/');

  assert.ok(pos);
  assert.ok(auto);
  assert.equal(root, null);

  assert.equal(pos.app, 'pos');
  assert.equal(pos.id, '/pos/');
  assert.equal(pos.scope, '/pos/');
  assert.equal(pos.startUrl, '/pos/');
  assert.equal(pos.manifestHref, '/manifest-pos.webmanifest');
  assert.equal(pos.swScript, './sw-pos.js');

  assert.equal(auto.app, 'autoservicio');
  assert.equal(auto.id, '/autoservicio/');
  assert.equal(auto.scope, '/autoservicio/');
  assert.equal(auto.startUrl, '/autoservicio/');
  assert.equal(auto.manifestHref, '/manifest-autoservicio.webmanifest');
  assert.equal(auto.swScript, './sw.js');

  assert.notEqual(pos.id, auto.id);
  assert.notEqual(pos.scope, auto.scope);
  assert.notEqual(pos.startUrl, auto.startUrl);
  assert.notEqual(pos.manifestHref, auto.manifestHref);
});

test('public manifest files define strictly isolated ids, scopes, short names, and icons', () => {
  const posManifestPath = path.resolve(process.cwd(), 'public/manifest-pos.webmanifest');
  const autoManifestPath = path.resolve(process.cwd(), 'public/manifest-autoservicio.webmanifest');

  const posManifest = JSON.parse(fs.readFileSync(posManifestPath, 'utf8'));
  const autoManifest = JSON.parse(fs.readFileSync(autoManifestPath, 'utf8'));

  assert.equal(posManifest.id, '/pos/');
  assert.equal(posManifest.start_url, '/pos/');
  assert.equal(posManifest.scope, '/pos/');
  assert.equal(posManifest.display, 'standalone');
  assert.ok(posManifest.short_name.length <= 12);

  assert.equal(autoManifest.id, '/autoservicio/');
  assert.equal(autoManifest.start_url, '/autoservicio/');
  assert.equal(autoManifest.scope, '/autoservicio/');
  assert.equal(autoManifest.display, 'standalone');
  assert.ok(autoManifest.short_name.length <= 12);

  assert.notEqual(posManifest.id, autoManifest.id);
  assert.notEqual(posManifest.scope, autoManifest.scope);
  assert.notEqual(posManifest.start_url, autoManifest.start_url);
  assert.notEqual(posManifest.name, autoManifest.name);
  assert.notEqual(posManifest.short_name, autoManifest.short_name);

  const posIconSrcs = new Set((posManifest.icons as Array<{ src: string }>).map((i) => i.src));
  const autoIconSrcs = new Set((autoManifest.icons as Array<{ src: string }>).map((i) => i.src));
  for (const src of posIconSrcs) {
    assert.equal(autoIconSrcs.has(src), false, `Icon ${src} must not be shared across PWAs`);
  }
});
