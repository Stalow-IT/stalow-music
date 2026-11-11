'use strict';
// Makes the files to upload for a Windows update (run after `npm run dist:win`, or use `npm run release`):
//   release/desktop/StalowMusic-<version>.part1..N   (the installer in 40 MB parts)
//   release/desktop/stalow-music-desktop.json        (the update file the app checks)
// Upload everything in release/desktop/ to the website's downloads/desktop/ folder.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const notes = process.argv.slice(2).join(' ');
const exe = path.join(root, 'dist', `Stalow-Music-Setup-${version}.exe`);
if (!fs.existsSync(exe)) { console.error(`Not found: ${exe}. Run npm run dist:win first.`); process.exit(1); }

const out = path.join(root, 'release', 'desktop');
fs.mkdirSync(out, { recursive: true });
const data = fs.readFileSync(exe);
const PART = 40 * 1024 * 1024;
const parts = [];
for (let i = 0, n = 1; i < data.length; i += PART, n++) {
  const name = `StalowMusic-${version}.part${n}`;
  fs.writeFileSync(path.join(out, name), data.subarray(i, i + PART));
  parts.push(name);
}
const feed = { version, parts, sha256: crypto.createHash('sha256').update(data).digest('hex'), size: data.length, notes };
fs.writeFileSync(path.join(out, 'stalow-music-desktop.json'), JSON.stringify(feed, null, 1));
console.log(`Ready in release/desktop/: ${parts.length} parts + stalow-music-desktop.json (version ${version})`);
