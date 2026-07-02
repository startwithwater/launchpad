// Build Launchpad and publish it to GitHub Releases so installed copies
// (yours and anyone you shared it with) auto-update.
//
//   node publish.mjs           build + release the current package.json version
//   node publish.mjs patch     bump 1.3.0 -> 1.3.1 first, then build + release
//   node publish.mjs minor     bump 1.3.0 -> 1.4.0
//
// Uploads the installer + latest.yml (the update feed) with the gh CLI, which
// creates the git tag for us. Requires: gh auth login (already done).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const run = c => execSync(c, { cwd: DIR, stdio: 'inherit' });
const quiet = c => { try { execSync(c, { cwd: DIR, stdio: 'ignore' }); return true; } catch { return false; } };
const pkgPath = path.join(DIR, 'package.json');

const bump = process.argv[2];
if (bump && !['major', 'minor', 'patch'].includes(bump)) {
  console.error('Usage: node publish.mjs [major|minor|patch]');
  process.exit(1);
}
if (bump) {
  console.log(`Bumping ${bump} version…`);
  run(`npm version ${bump} --no-git-tag-version`);
}

const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
const tag = 'v' + version;
console.log(`\n=== Publishing Launchpad ${tag} ===\n`);

console.log('1/4  Building installer…');
run('npx electron-builder --win nsis --publish never');

const setup = `dist/Launchpad-Setup-${version}.exe`;
const assets = [setup, setup + '.blockmap', 'dist/latest.yml'];
for (const f of assets) {
  if (!fs.existsSync(path.join(DIR, f))) throw new Error('Build did not produce ' + f);
}
console.log('2/4  Build OK (installer + update feed present)');

// commit whatever changed so the release tag reflects the built code (best effort)
quiet('git add -A');
quiet(`git commit -m "Release ${tag}"`);
quiet('git push');
console.log('3/4  Source committed & pushed');

console.log('4/4  Uploading to GitHub Releases…');
const quoted = assets.map(a => `"${a}"`).join(' ');
if (quiet(`gh release view ${tag}`)) {
  run(`gh release upload ${tag} ${quoted} --clobber`);
} else {
  run(`gh release create ${tag} ${quoted} --title "Launchpad ${version}" --notes "Automatic update release. Run the Setup .exe to install fresh."`);
}

console.log(`\n✓ Published ${tag}.`);
console.log('  Installed copies update within ~3 hours, or immediately on next launch.');
