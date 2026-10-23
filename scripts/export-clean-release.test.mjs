import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportCleanRelease } from './export-clean-release.mjs';

let temporary, baseline;
before(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'mcrush-export-test-'));
  baseline = path.join(temporary, 'baseline');
  await exportCleanRelease({ destination: baseline });
});
after(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); });
async function fixture(name) { const root = path.join(temporary, name); await cp(baseline, root, { recursive: true }); return root; }
async function exists(file) { try { await lstat(file); return true; } catch (error) { if (error.code !== 'ENOENT') throw error; return false; } }
async function inject(root, file, content) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), content); }

test('exports a complete reproducible payload, trims private history, and excludes private trees', async () => {
  const root = await fixture('private-source'), destination = path.join(temporary, 'clean');
  await inject(root, '.env', 'not-a-real-secret'); await inject(root, '.git/config', 'private history');
  await inject(root, 'src/core/old.ts', 'old two-dimensional implementation');
  await inject(root, 'public/assets/' + 'oc' + '2/private.glb', 'private source binary');
  await inject(root, 'src/kitchen/._types.ts', 'AppleDouble');
  await inject(root, 'README.md', (await readFile(path.join(root, 'README.md'), 'utf8')) + '\n<!-- PRIVATE_HISTORY: exclude -->\nPRIVATE HISTORY MUST NOT LEAVE\n');
  const result = await exportCleanRelease({ sourceRoot: root, destination });
  assert.equal(result.verified, true);
  for (const file of ['.env', '.git', 'src/core', 'public/assets/' + 'oc' + '2', 'src/kitchen/._types.ts', 'node_modules']) assert.equal(await exists(path.join(destination, file)), false, file);
  assert.ok(!(await readFile(path.join(destination, 'README.md'), 'utf8')).includes('PRIVATE HISTORY MUST NOT LEAVE'));
  assert.ok((await readFile(path.join(root, 'README.md'), 'utf8')).includes('PRIVATE HISTORY MUST NOT LEAVE'));
  const manifest = JSON.parse(await readFile(path.join(destination, 'RELEASE_MANIFEST.json'), 'utf8'));
  assert.equal(manifest.files.length, result.payloadFiles);
  const sums = (await readFile(path.join(destination, 'SHA256SUMS'), 'utf8')).trim().split('\n');
  assert.equal(sums.length, manifest.files.length + 1);
  for (const line of sums) { const [expected, file] = line.split('  '); assert.equal(createHash('sha256').update(await readFile(path.join(destination, file))).digest('hex'), expected, file); }
  assert.ok(manifest.files.some(file => file.path === 'scripts/export-clean-release.mjs'));
  assert.ok(manifest.files.some(file => file.path === 'tests/kitchen-helpers.ts'));
});

test('refuses existing or source-folder destinations without overwriting anything', async () => {
  const root = await fixture('overwrite-source'), destination = path.join(temporary, 'occupied');
  await mkdir(destination); await writeFile(path.join(destination, 'keep.txt'), 'keep');
  await assert.rejects(exportCleanRelease({ sourceRoot: root, destination }), /overwrite/);
  assert.equal(await readFile(path.join(destination, 'keep.txt'), 'utf8'), 'keep');
  await assert.rejects(exportCleanRelease({ sourceRoot: root, destination: path.join(root, 'src', 'release') }), /source folders/);
  assert.equal(await exists(path.join(root, 'src', 'release')), false);
  await mkdir(path.join(root, 'output/releases'), { recursive: true });
  await symlink(path.join(root, 'src'), path.join(root, 'output/releases/redirect'), 'dir');
  await assert.rejects(exportCleanRelease({ sourceRoot: root, destination: path.join(root, 'output/releases/redirect/child/package') }), /Resolved destination/);
  assert.equal(await exists(path.join(root, 'src/child')), false);
});

test('rejects static and dynamic imports that would leave the exported source', async () => {
  for (const [name, code] of [['static', "import type { Missing } from '../core/old';"], ['dynamic', "import('../../outside.js');"]]) {
    const root = await fixture(name), destination = path.join(temporary, name + '-result');
    await inject(root, 'src/experience/leak.ts', code);
    await assert.rejects(exportCleanRelease({ sourceRoot: root, destination }), /Unexported local reference/);
    assert.equal(await exists(destination), false);
  }
});

test('rejects private asset references and changed model contents before writing output', async () => {
  const root = await fixture('asset-path');
  await inject(root, 'src/experience/leak.ts', 'fetch(' + JSON.stringify('/assets/' + 'oc' + '2/private.glb') + ');');
  await assert.rejects(exportCleanRelease({ sourceRoot: root, destination: path.join(temporary, 'asset-path-result') }), /Private resource/);
  const changed = await fixture('changed-model'), manifest = JSON.parse(await readFile(path.join(changed, 'public/assets/original/manifest.json'), 'utf8'));
  await inject(changed, 'public' + Object.values(manifest.assets)[0].url, 'changed model');
  await assert.rejects(exportCleanRelease({ sourceRoot: changed, destination: path.join(temporary, 'changed-model-result') }), /hash mismatch/);
});

test('rejects symlinked source files rather than copying their targets', async () => {
  const root = await fixture('symlink-source'); await rm(path.join(root, 'src/game/audio.ts'));
  await symlink(path.join(baseline, 'src/game/audio.ts'), path.join(root, 'src/game/audio.ts'));
  await assert.rejects(exportCleanRelease({ sourceRoot: root, destination: path.join(temporary, 'symlink-result') }), /regular source files/);
});

test('rejects non-placeholder MCP headers', async () => {
  const root = await fixture('config-source');
  await inject(root, 'mcp-config.example.json', JSON.stringify({ mcpServers: { mcd: { headers: { Authorization: 'Bearer not-a-real-credential' } } } }));
  await assert.rejects(exportCleanRelease({ sourceRoot: root, destination: path.join(temporary, 'config-result') }), /environment placeholders only/);
});
