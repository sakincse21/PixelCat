// GJS-only modules can't be imported by Node, but they can be parsed.
// This catches typos and bad syntax before you ever log out and back in.
import {readdirSync, readFileSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const dir = new URL('../extension/pixelcat@sakin/', import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), 'pixelcat-'));
let failed = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const copy = join(tmp, f.replace(/\.js$/, '.mjs'));
    writeFileSync(copy, readFileSync(join(dir, f)));
    const r = spawnSync(process.execPath, ['--check', copy], {encoding: 'utf8'});
    if (r.status === 0) console.log(`ok   ${f}`);
    else { failed++; console.log(`FAIL ${f}\n${r.stderr}`); }
}
process.exit(failed ? 1 : 0);
