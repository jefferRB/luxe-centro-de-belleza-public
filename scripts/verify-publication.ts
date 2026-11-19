/** Publication gate for the repository itself (not the website): run before every push.
 *
 *   npm run verify:publication
 *
 * The README presents the real site with screenshots and recordings of production
 * (showcase/production/). They show the business's photographs, logo and client work, so they
 * may be published only with written authorization recorded in showcase/production.json.
 *
 * Checks:
 *  - every local image or video referenced from the README and docs exists;
 *  - every referenced production file is listed in showcase/production.json with a matching hash;
 *  - while authorization is pending, showcase/production/ stays git-ignored and the gate fails;
 *  - once approved (grantor, evidence and date required), the folder must no longer be ignored,
 *    so the README images are actually committed. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

interface ProductionRecord {
  readonly authorization: { readonly status: 'pending' | 'approved'; readonly grantedBy: string; readonly evidence: string; readonly reviewedAt: string };
  readonly files: Readonly<Record<string, { readonly sha256: string }>>;
}

const PRODUCTION_DIR = 'showcase/production/';
const record = JSON.parse(readFileSync('showcase/production.json', 'utf8')) as ProductionRecord;
const docs = ['README.md', 'NOTICE.md', ...readdirSync('docs', { recursive: true }).map(String).filter((file) => file.endsWith('.md')).map((file) => join('docs', file))];
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

const referenced = new Set<string>();
for (const doc of docs) {
  const text = readFileSync(doc, 'utf8').replace(/```[\s\S]*?```/g, '');
  const targets = [...text.matchAll(/(?:src|href)="([^"]+)"|\]\(([^)\s]+)\)/g)].map((match) => match[1] ?? match[2]!);
  for (const target of targets) {
    if (/^(https?:|mailto:|#)/.test(target) || !/\.(webp|png|jpe?g|gif|avif|webm|mp4)$/i.test(target.split('#')[0]!)) continue;
    const path = relative('.', normalize(join(dirname(doc), target))).replaceAll('\\', '/');
    assert.ok(existsSync(path), `${doc}: missing media ${target}`);
    referenced.add(path);
  }
}

const production = [...referenced].filter((path) => path.startsWith(PRODUCTION_DIR));
for (const path of production) {
  const entry = record.files[path.slice(PRODUCTION_DIR.length)];
  assert.ok(entry, `${path} is not listed in showcase/production.json`);
  assert.equal(sha(path), entry.sha256, `${path} does not match its recorded hash`);
}

const ignored = readFileSync('.gitignore', 'utf8').split(/\r?\n/).map((line) => line.trim());
const folderIgnored = ignored.includes(PRODUCTION_DIR) || ignored.includes(`/${PRODUCTION_DIR}`);
const { status, grantedBy, evidence, reviewedAt } = record.authorization;
const approved = status === 'approved' && Boolean(grantedBy.trim() && evidence.trim() && reviewedAt.trim());

if (production.length && !approved) {
  assert.ok(folderIgnored, `${PRODUCTION_DIR} must stay in .gitignore while authorization is pending`);
  console.error(`Not ready to publish: ${production.length} production screenshots or recordings are referenced, but showcase/production.json has no recorded authorization (status: ${status}).`);
  process.exit(1);
}
if (approved) assert.ok(!folderIgnored, `Authorization is recorded: remove ${PRODUCTION_DIR} from .gitignore so the README images are committed`);
console.log(`Publication check passed: ${referenced.size} media references resolve; ${production.length} production files ${approved ? 'authorized' : 'in use'}.`);
