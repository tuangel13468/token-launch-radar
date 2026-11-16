// Token Launch Radar — entry program (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// scores every rankable pre-token protocol with the model in lib/model.ts, writes the ranked
// board to /output/board.json, and writes the dashboard's data beside the page. Then it restores
// the dashboard's three screenshots to /output/screenshots and writes /output/dossier.json, the
// summary the judge reads, with the vendored make.fun library.
//
// Why screenshots are restored, not copied: the repository ships the three renders as base64
// text files (screenshots/1-board.png.b64 and its two siblings) because the entry is pushed
// through a text-only channel; the program decodes each one back to the PNG the browser rendered,
// byte for byte, so /output holds the real renders and the gate reads whole PNGs. A file whose
// name does not end in .png.b64 is refused, and a decoded file that is not a whole PNG is refused.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read /output/data.js, which this program writes from
// the same board. The page recomputes every row from the snapshot figures, so its numbers and
// board.json's are the same arithmetic, and its sandbox re-ranks the board live.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
/** A PNG's first eight bytes: the signature a restored screenshot must carry. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(`token radar: dashboard/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
    const bytes = readFileSync(path);
    writeFileSync(join(to, name), bytes);
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));

/**
 * Restore the screenshots: each screenshots/<name>.png.b64 in the repository is the base64 of
 * the PNG the browser rendered of the dashboard. Decode it, refuse anything that is not a
 * whole PNG, and write it as screenshots/<name>.png.
 */
function restoreScreenshots(from: string, to: string): string[] {
  if (!existsSync(from)) {
    process.stderr.write(`token radar: no screenshots/ directory: hand in 3, the board, a detail view and a filtered view\n`);
    process.exit(1);
  }
  mkdirSync(to, { recursive: true });
  const restored: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    if (!name.endsWith('.png.b64')) {
      process.stderr.write(`token radar: screenshots/${name}: a screenshot ships as <name>.png.b64, the base64 of the rendered PNG\n`);
      process.exit(1);
    }
    const pngName = name.slice(0, -4);
    if (!IMAGE_NAME.test(pngName)) {
      process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
      process.exit(1);
    }
    const text = readFileSync(join(from, name), 'utf8').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
      process.stderr.write(`token radar: screenshots/${name}: not base64\n`);
      process.exit(1);
    }
    const bytes = Buffer.from(text, 'base64');
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_MAGIC)) {
      process.stderr.write(`token radar: screenshots/${name}: does not decode to a whole PNG\n`);
      process.exit(1);
    }
    if (bytes.length > SCREENSHOT_CAPS.max_bytes) {
      process.stderr.write(`token radar: screenshots/${name}: ${bytes.length} bytes, over the ${SCREENSHOT_CAPS.max_bytes} cap\n`);
      process.exit(1);
    }
    writeFileSync(join(to, pngName), bytes);
    restored.push(pngName);
  }
  if (restored.length < 3) {
    process.stderr.write(`token radar: screenshots/ holds ${restored.length} image${restored.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
    process.exit(1);
  }
  return restored;
}

const shots = restoreScreenshots(join(here, 'screenshots'), join(out, 'screenshots'));

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
