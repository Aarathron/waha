/**
 * Post-install patch for @adiwajshing/baileys.
 *
 * WhatsApp now requires Platform.MACOS (not WEB) for new multi-device
 * registrations, and rejects severely outdated version strings with 405.
 * Baileys hardcodes both values with no SocketConfig override for Platform.
 *
 * This script surgically replaces:
 *   1. Platform.WEB  → Platform.MACOS  in validate-connection.js
 *   2. Version [2, 3000, 1027934701] → [2, 3000, 1034386130] in Defaults/index.js
 */
const fs = require('fs');
const path = require('path');

const BAILEYS_ROOT = path.join(
  __dirname,
  '..',
  'node_modules',
  '@adiwajshing',
  'baileys',
  'lib',
);

const patches = [
  {
    file: path.join(BAILEYS_ROOT, 'Utils', 'validate-connection.js'),
    find: 'Platform.WEB',
    replace: 'Platform.MACOS',
  },
  {
    file: path.join(BAILEYS_ROOT, 'Defaults', 'index.js'),
    find: '[2, 3000, 1027934701]',
    replace: '[2, 3000, 1034386130]',
  },
];

let applied = 0;
for (const { file, find, replace } of patches) {
  if (!fs.existsSync(file)) {
    console.log(`  skip: ${path.relative(BAILEYS_ROOT, file)} (not found)`);
    continue;
  }
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes(replace)) {
    console.log(`  ok:   ${path.relative(BAILEYS_ROOT, file)} (already patched)`);
    applied++;
    continue;
  }
  if (!content.includes(find)) {
    console.warn(`  WARN: ${path.relative(BAILEYS_ROOT, file)} — expected string not found: "${find}"`);
    continue;
  }
  fs.writeFileSync(file, content.replace(find, replace), 'utf8');
  console.log(`  done: ${path.relative(BAILEYS_ROOT, file)}`);
  applied++;
}

if (applied === patches.length) {
  console.log('patch-baileys: all patches applied successfully');
} else {
  console.warn(`patch-baileys: ${applied}/${patches.length} patches applied`);
}
