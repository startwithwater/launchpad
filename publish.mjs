// Build Launchpad and publish it to GitHub Releases so installed copies
// (yours and anyone you shared it with) auto-update — with a changelog.
//
//   node publish.mjs                      release the current version
//   node publish.mjs patch                bump 1.3.1 -> 1.3.2, then release
//   node publish.mjs minor                bump 1.3.x -> 1.4.0
//   node publish.mjs patch "Fixed X" "Added Y"     bump + explicit changelog
//
// The changelog is what your brother sees in the update popup. If you don't
// pass notes, it's built automatically from your git commit messages since the
// last release — so commit with a short, human message (or pass notes above).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const run = c => execSync(c, { cwd: DIR, stdio: 'inherit' });
const cap = c => execSync(c, { cwd: DIR, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
const quiet = c => { try { execSync(c, { cwd: DIR, stdio: 'ignore' }); return true; } catch { return false; } };
const pkgPath = path.join(DIR, 'package.json');

const argv = process.argv.slice(2);
let bump = null;
if (['major', 'minor', 'patch'].includes(argv[0])) bump = argv.shift();
const explicitNotes = argv;   // anything remaining = manual changelog lines

const startingStatus = cap('git status --short').trim();
if (startingStatus) {
  console.error('Refusing to publish with uncommitted changes. Commit or discard these first:\n');
  console.error(startingStatus);
  process.exit(1);
}

// changelog from commit subjects since the previous tag (best effort)
function autoNotes() {
  let prev = '';
  try { prev = cap('git describe --tags --abbrev=0').trim(); } catch {}
  let raw = '';
  try { raw = cap(`git log ${prev ? prev + '..HEAD' : ''} --no-merges --pretty=%s`); } catch {}
  const skip = /^(release |merge |bump|version |docs?:|wip\b)/i;
  return [...new Set(raw.split(/\r?\n/).map(s => s.trim())
    .filter(s => s && !skip.test(s) && !/Co-Authored-By/i.test(s)))].slice(0, 12);
}

if (bump) {
  console.log(`Bumping ${bump} version…`);
  run(`npm version ${bump} --no-git-tag-version`);
}

const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
const tag = 'v' + version;
const notes = explicitNotes.length ? explicitNotes : autoNotes();
const notesMd = notes.length ? notes.map(n => '- ' + n).join('\n') : 'Improvements and fixes.';

console.log(`\n=== Publishing Launchpad ${tag} ===`);
console.log('Changelog:\n' + notesMd + '\n');

console.log('1/5  Building installer…');
run('npx electron-builder --win nsis --publish never');

const setup = `dist/Launchpad-Setup-${version}.exe`;
const feed = path.join(DIR, 'dist', 'latest.yml');
for (const f of [setup, setup + '.blockmap', 'dist/latest.yml']) {
  if (!fs.existsSync(path.join(DIR, f))) throw new Error('Build did not produce ' + f);
}

// bake the changelog into the update feed so the app shows it with no extra
// network call (JSON.stringify → a valid one-line YAML double-quoted scalar)
console.log('2/5  Adding changelog to the update feed…');
let yml = fs.readFileSync(feed, 'utf8').replace(/\r?\nreleaseNotes:.*$/s, '').trimEnd();
yml += `\nreleaseNotes: ${JSON.stringify(notesMd)}\n`;
fs.writeFileSync(feed, yml);

// Commit only the version bump. Build artifacts stay ignored and are uploaded
// as release assets below.
console.log('3/5  Committing & pushing…');
quiet('git add package.json package-lock.json');
quiet(`git commit -m "Release ${tag}"`);
quiet('git push');

console.log('4/5  Writing changelog file for the release notes…');
const notesFile = path.join(DIR, 'dist', 'RELEASE_NOTES.md');
fs.writeFileSync(notesFile, notesMd + '\n');

console.log('5/5  Uploading to GitHub Releases…');
const assets = [setup, setup + '.blockmap', 'dist/latest.yml'].map(a => `"${a}"`).join(' ');
if (quiet(`gh release view ${tag}`)) {
  run(`gh release upload ${tag} ${assets} --clobber`);
  run(`gh release edit ${tag} --notes-file "dist/RELEASE_NOTES.md"`);
} else {
  run(`gh release create ${tag} ${assets} --title "Launchpad ${version}" --notes-file "dist/RELEASE_NOTES.md"`);
}

console.log(`\n✓ Published ${tag}.`);
console.log('  Installed copies show the changelog + update within ~3 hours, or on next launch.');
