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

test('detectProject: a folder with nothing runnable or servable is not a project', () => {
  const dir = tmpProject({ 'notes.txt': 'just some files', 'photo.jpg': '' });
  assert.equal(srv.detectProject('stuff', dir), null);
});

test('detectProject: package.json without dev/start and no index.html is not a project', () => {
  const dir = tmpProject({ 'package.json': JSON.stringify({ scripts: { build: 'x' } }) });
  assert.equal(srv.detectProject('lib', dir), null);
});

test('findProjects: finds projects nested below the top level, named by relative path', () => {
  const root = tmpProject({
    'top-site/index.html': '<h1>top</h1>',
    'clients/acme/homepage/index.html': '<h1>acme</h1>',
    'clients/notes.txt': 'not a project',
    'docs/readme.txt': 'nothing here',
  });
  const found = srv.findProjects(root);
  const names = found.map(f => f.name).sort();
  assert.deepEqual(names, ['clients/acme/homepage', 'top-site']);
  const acme = found.find(f => f.name === 'clients/acme/homepage');
  assert.equal(acme.dir, path.join(root, 'clients', 'acme', 'homepage'));
  assert.equal(acme.det.mode, 'static');
});

test('findProjects: a folder that is itself a project is not descended into', () => {
  const root = tmpProject({
    'app/package.json': JSON.stringify({ scripts: { dev: 'vite' } }),
    'app/examples/demo/index.html': '<h1>demo</h1>',
  });
  const names = srv.findProjects(root).map(f => f.name);
  assert.deepEqual(names, ['app']);
});

test('findProjects: pointing at a single project lists just that project', () => {
  const root = tmpProject({ 'index.html': '<h1>hi</h1>' });
  const found = srv.findProjects(root);
  assert.equal(found.length, 1);
  assert.equal(found[0].dir, root);
  assert.equal(found[0].det.mode, 'static');
});

test('findProjects: node_modules and hidden folders are skipped', () => {
  const root = tmpProject({
    'node_modules/pkg/index.html': 'x',
    '.git/index.html': 'x',
    'real/index.html': 'x',
  });
  assert.deepEqual(srv.findProjects(root).map(f => f.name), ['real']);
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
