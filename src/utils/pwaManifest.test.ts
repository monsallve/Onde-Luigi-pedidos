import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { resolvePwaTargetForPathname } from './pwaManifest.ts';

test('resolves non-overlapping PWA manifest and SW targets on root and GitHub Pages subpaths', () => {
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
  assert.equal(pos.manifestHref, './manifest-pos.webmanifest');
  assert.equal(pos.swScript, './sw-pos.js');

  assert.equal(auto.app, 'autoservicio');
  assert.equal(auto.id, '/autoservicio/');
  assert.equal(auto.scope, '/autoservicio/');
  assert.equal(auto.startUrl, '/autoservicio/');
  assert.equal(auto.manifestHref, './manifest-autoservicio.webmanifest');
  assert.equal(auto.swScript, './sw.js');

  assert.notEqual(pos.id, auto.id);
  assert.notEqual(pos.scope, auto.scope);
  assert.notEqual(pos.startUrl, auto.startUrl);
  assert.notEqual(pos.manifestHref, auto.manifestHref);

  // GitHub Pages subpath deployment (/Onde-Luigi-pedidos/...)
  const ghPos = resolvePwaTargetForPathname('/Onde-Luigi-pedidos/pos/');
  const ghAuto = resolvePwaTargetForPathname('/Onde-Luigi-pedidos/autoservicio/');
  const ghRoot = resolvePwaTargetForPathname('/Onde-Luigi-pedidos/');

  assert.ok(ghPos);
  assert.ok(ghAuto);
  assert.equal(ghRoot, null);

  assert.equal(ghPos.id, '/Onde-Luigi-pedidos/pos/');
  assert.equal(ghPos.scope, '/Onde-Luigi-pedidos/pos/');
  assert.equal(ghPos.startUrl, '/Onde-Luigi-pedidos/pos/');
  assert.equal(ghPos.manifestHref, './manifest-pos.webmanifest');

  assert.equal(ghAuto.id, '/Onde-Luigi-pedidos/autoservicio/');
  assert.equal(ghAuto.scope, '/Onde-Luigi-pedidos/autoservicio/');
  assert.equal(ghAuto.startUrl, '/Onde-Luigi-pedidos/autoservicio/');
  assert.equal(ghAuto.manifestHref, './manifest-autoservicio.webmanifest');
});

test('public subpath-portable manifest files resolve cleanly under both root and GitHub Pages', () => {
  const posManifestPath = path.resolve(process.cwd(), 'public/pos/manifest-pos.webmanifest');
  const autoManifestPath = path.resolve(
    process.cwd(),
    'public/autoservicio/manifest-autoservicio.webmanifest'
  );

  const posManifest = JSON.parse(fs.readFileSync(posManifestPath, 'utf8'));
  const autoManifest = JSON.parse(fs.readFileSync(autoManifestPath, 'utf8'));

  assert.equal(posManifest.id, './');
  assert.equal(posManifest.start_url, './');
  assert.equal(posManifest.scope, './');
  assert.equal(posManifest.display, 'standalone');
  assert.ok(posManifest.short_name.length <= 12);

  assert.equal(autoManifest.id, './');
  assert.equal(autoManifest.start_url, './');
  assert.equal(autoManifest.scope, './');
  assert.equal(autoManifest.display, 'standalone');
  assert.ok(autoManifest.short_name.length <= 12);

  assert.notEqual(posManifest.name, autoManifest.name);
  assert.notEqual(posManifest.short_name, autoManifest.short_name);

  for (const baseOrigin of [
    'https://pos.ondeluigi.com',
    'https://monsallve.github.io/Onde-Luigi-pedidos',
  ]) {
    const posManifestUrl = `${baseOrigin}/pos/manifest-pos.webmanifest`;
    const autoManifestUrl = `${baseOrigin}/autoservicio/manifest-autoservicio.webmanifest`;

    const resolvedPosId = new URL(posManifest.id, posManifestUrl).toString();
    const resolvedPosStart = new URL(posManifest.start_url, posManifestUrl).toString();
    const resolvedPosScope = new URL(posManifest.scope, posManifestUrl).toString();

    const resolvedAutoId = new URL(autoManifest.id, autoManifestUrl).toString();
    const resolvedAutoStart = new URL(autoManifest.start_url, autoManifestUrl).toString();
    const resolvedAutoScope = new URL(autoManifest.scope, autoManifestUrl).toString();

    assert.equal(resolvedPosId, `${baseOrigin}/pos/`);
    assert.equal(resolvedPosStart, `${baseOrigin}/pos/`);
    assert.equal(resolvedPosScope, `${baseOrigin}/pos/`);

    assert.equal(resolvedAutoId, `${baseOrigin}/autoservicio/`);
    assert.equal(resolvedAutoStart, `${baseOrigin}/autoservicio/`);
    assert.equal(resolvedAutoScope, `${baseOrigin}/autoservicio/`);

    assert.notEqual(resolvedPosId, resolvedAutoId);
    assert.notEqual(resolvedPosScope, resolvedAutoScope);
    assert.notEqual(resolvedPosStart, resolvedAutoStart);

    const posIconUrls = new Set(
      (posManifest.icons as Array<{ src: string }>).map((icon) => {
        const resolved = new URL(icon.src, posManifestUrl);
        const relFile = path.resolve(
          process.cwd(),
          'public',
          resolved.pathname.replace(/^\/Onde-Luigi-pedidos\//, '').replace(/^\//, '')
        );
        assert.ok(fs.existsSync(relFile), `Missing POS icon asset: ${relFile}`);
        return resolved.toString();
      })
    );

    const autoIconUrls = new Set(
      (autoManifest.icons as Array<{ src: string }>).map((icon) => {
        const resolved = new URL(icon.src, autoManifestUrl);
        const relFile = path.resolve(
          process.cwd(),
          'public',
          resolved.pathname.replace(/^\/Onde-Luigi-pedidos\//, '').replace(/^\//, '')
        );
        assert.ok(fs.existsSync(relFile), `Missing Autoservicio icon asset: ${relFile}`);
        return resolved.toString();
      })
    );

    for (const url of posIconUrls) {
      assert.equal(autoIconUrls.has(url), false, `Icon ${url} must not overlap across PWAs`);
    }
  }
});
