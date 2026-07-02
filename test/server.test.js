'use strict';
// Unit tests for the pure logic in server.js — project detection and the
// static-server path-containment guard. Run with `npm test` (Node's built-in
// test runner, no dependencies). Requiring server.js does NOT start it: the
// auto-start guard only fires when the file is the main module or a SEA binary.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const srv = require('../server.js');

// Build a throwaway project folder from a { relativePath: contents } map.
function tmpProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-test-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

test('detectProject: a plain index.html is a static site rooted at the folder', () => {
  const dir = tmpProject({ 'index.html': '<h1>hi</h1>' });
  const det = srv.detectProject('site', dir);
  assert.equal(det.mode, 'static');
  assert.equal(det.docroot, dir);
});

test('detectProject: a static site nested in public/ sets docroot to public/', () => {
  const dir = tmpProject({ 'public/index.html': '<h1>hi</h1>' });
  const det = srv.detectProject('site', dir);
  assert.equal(det.mode, 'static');
  assert.equal(det.docroot, path.join(dir, 'public'));
  assert.equal(det.detail, 'public');
});

test('detectProject: package.json with a dev script runs npm run dev', () => {
  const dir = tmpProject({ 'package.json': JSON.stringify({ scripts: { dev: 'vite' } }) });
  const det = srv.detectProject('app', dir);
  assert.equal(det.mode, 'npm');
  assert.equal(det.detail, 'dev');
});

test('detectProject: package.json with only a start script runs npm run start', () => {
  const dir = tmpProject({ 'package.json': JSON.stringify({ scripts: { start: 'node x' } }) });
  const det = srv.detectProject('app', dir);
  assert.equal(det.mode, 'npm');
  assert.equal(det.detail, 'start');
});

test('detectProject: package.json without dev/start falls back to static', () => {
  const dir = tmpProject({ 'package.json': JSON.stringify({ scripts: { build: 'x' } }), 'index.html': 'x' });
  assert.equal(srv.detectProject('app', dir).mode, 'static');
});

test('detectProject: wrangler.toml is a wrangler project using its build output dir', () => {
  const dir = tmpProject({ 'wrangler.toml': 'name = "x"\npages_build_output_dir = "dist"\n' });
  const det = srv.detectProject('pages', dir);
  assert.equal(det.mode, 'wrangler');
  assert.equal(det.detail, 'dist');
});

test('isInsideRoot: an ordinary nested file is inside the root', () => {
  const root = path.normalize('/srv/site');
  assert.equal(srv.isInsideRoot(root, path.join(root, 'a', 'b.txt')), true);
});

test('isInsideRoot: the root directory itself counts as inside', () => {
  const root = path.normalize('/srv/site');
  assert.equal(srv.isInsideRoot(root, root), true);
});

test('isInsideRoot: a parent-directory traversal is rejected', () => {
  const root = path.normalize('/srv/site');
  assert.equal(srv.isInsideRoot(root, path.normalize('/srv/site/../secret.txt')), false);
});

test('isInsideRoot: a sibling folder sharing the root name prefix is rejected', () => {
  const root = path.normalize('/srv/site');
  assert.equal(srv.isInsideRoot(root, path.normalize('/srv/site-secret/x.txt')), false);
});
