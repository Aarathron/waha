/**
 * Post-install patch for @adiwajshing/baileys.
 *
 * WhatsApp now requires Platform.MACOS (not WEB) for new multi-device
 * registrations, and rejects severely outdated version strings with 405.
 * Baileys hardcodes both values with no SocketConfig override for Platform.
 *
 * This script surgically:
 *   1. Replaces Platform.WEB → Platform.MACOS in validate-connection.js.
 *   2. Pins the WA web version [2, 3000, 1035920091] in Defaults/index.js.
 *      fork-master-2026-04-28 already ships this token, so the entry is a
 *      no-op assertion (find === replace). If WhatsApp later rejects it,
 *      set `find` to the token the fork ships and `replace` to the newly
 *      required one to perform a real substitution.
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
    // No-op assertion: fork-master-2026-04-28 already ships this token.
    // Change `find`/`replace` to substitute a newer version when WA demands it.
    file: path.join(BAILEYS_ROOT, 'Defaults', 'index.js'),
    find: '[2, 3000, 1035920091]',
    replace: '[2, 3000, 1035920091]',
  },

  // --- Surface real media-upload errors (observability) ---
  // getWAUploadToServer swallows the HTTP status on failed uploads and only
  // logs per-host errors to stdout (which we cannot read on this host).
  // These four patches make the uploader reject with the real HTTP status +
  // WA response body and carry the last per-host error into the thrown Boom's
  // `data`, so `POST /api/sendImage` returns the actual reason (403 auth /
  // 4xx / ENOTFOUND) instead of the opaque "Media upload failed on all hosts".
  //
  // 1. Make the Node http uploader reject (with statusCode + body) on >= 400
  //    instead of resolving an empty body.
  {
    file: path.join(BAILEYS_ROOT, 'Utils', 'messages-media.js'),
    find: 'resolve(JSON.parse(body));',
    replace:
      "if (res.statusCode >= 400) { const __e = new Error('HTTP ' + res.statusCode); __e.statusCode = res.statusCode; __e.body = String(body).slice(0, 300); return reject(__e); } resolve(JSON.parse(body));",
  },
  // 2. Declare an outer var to carry the last per-host error out of the catch.
  {
    file: path.join(BAILEYS_ROOT, 'Utils', 'messages-media.js'),
    find: 'let urls;',
    replace: 'let urls; let __diagErr;',
  },
  // 3. Capture the error inside the catch block.
  {
    file: path.join(BAILEYS_ROOT, 'Utils', 'messages-media.js'),
    find: 'const isLast = hostname === hosts[uploadInfo.hosts.length - 1]?.hostname;',
    replace:
      "const isLast = hostname === hosts[uploadInfo.hosts.length - 1]?.hostname; __diagErr = { name: error?.name, message: error?.message, code: error?.code, statusCode: error?.statusCode, body: error?.body, cause_code: error?.cause?.code, cause_errno: error?.cause?.errno, cause_message: error?.cause?.message };",
  },
  // 4. Surface it in the thrown Boom.
  {
    file: path.join(BAILEYS_ROOT, 'Utils', 'messages-media.js'),
    find: "throw new Boom('Media upload failed on all hosts', { statusCode: 500 });",
    replace:
      "throw new Boom('Media upload failed on all hosts', { statusCode: 500, data: __diagErr });",
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
