/** Copy only the original three-shift distribution. Never copy the development Git history. */
import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'vite';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const REQUIRED_FILES = [
  'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts',
  'index.html', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'ASSET_SOURCES.md', 'MCP_INTEGRATION.md', 'CONTEST_DECLARATION.md',
  'mcp-config.example.json', 'docs/mcp-evidence.json', 'src/main.tsx', 'src/game/audio.ts',
  'scripts/make-original-assets.mjs', 'scripts/check-original-assets.mjs', 'scripts/make-audio.py', 'scripts/export-clean-release.mjs',
];
const DIRECTORIES = ['src/kitchen', 'src/experience', 'src/challenges', 'public/assets/original', 'public/audio', 'public/challenges', 'skills/mcrush-theme-challenge'];
const OPTIONAL_FILES = ['scripts/export-clean-release.test.mjs', 'docs/verification.json', 'docs/preview.png'];
const PRIVATE_MARKER = '<!-- PRIVATE_HISTORY:';
const CODE = /\.(?:ts|tsx|js|mjs|css|html|py)$/;
const JS = /\.(?:ts|tsx|js|mjs)$/;
const PRIVATE_PATH = /(?:public\/)?assets\/oc2(?:[\/'"`\s]|$)|Contents\/Resources\/Data|(?:^|[\s'"`])\/(?:Users|Volumes)\//m;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => child === parent || (!path.relative(parent, child).startsWith('..' + path.sep) && path.relative(parent, child) !== '..' && !path.isAbsolute(path.relative(parent, child)));
const ignored = name => name.startsWith('.') || ['node_modules', 'output', 'dist', 'test-results', 'playwright-report'].includes(name);

async function regularFile(root, relative) {
  const absolute = path.join(root, relative), info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Only regular source files may be exported: ' + relative);
  if (!inside(root, await realpath(absolute))) throw new Error('Source path leaves the project: ' + relative);
  return readFile(absolute);
}

async function collect(root) {
  const files = new Map();
  for (const file of REQUIRED_FILES) files.set(file, await regularFile(root, file));
  for (const file of OPTIONAL_FILES) {
    try { files.set(file, await regularFile(root, file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const walk = async relative => {
    const info = await lstat(path.join(root, relative));
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Only real source directories may be exported: ' + relative);
    for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (ignored(entry.name)) continue;
      const child = path.posix.join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Source symlinks are not distributable: ' + child);
      if (entry.isDirectory()) await walk(child);
      else files.set(child, await regularFile(root, child));
    }
  };
  for (const directory of DIRECTORIES) await walk(directory);
  for (const entry of await readdir(path.join(root, 'tests'), { withFileTypes: true })) {
    if (/^kitchen[^/]*\.ts$/.test(entry.name)) files.set('tests/' + entry.name, await regularFile(root, 'tests/' + entry.name));
  }
  if (![...files.keys()].some(file => /^tests\/kitchen.*\.spec\.ts$/.test(file))) throw new Error('No kitchen browser tests found.');
  const readme = files.get('README.md').toString('utf8'), marker = readme.indexOf(PRIVATE_MARKER);
  // An already-clean source export has no private marker and can itself be re-exported.
  files.set('README.md', Buffer.from((marker >= 0 ? readme.slice(0, marker) : readme).trimEnd() + '\n'));
  files.set('.gitignore', Buffer.from('node_modules/\ndist/\noutput/\n.env*\n*.pem\ntest-results/\nplaywright-report/\n.DS_Store\n._*\n'));
  return files;
}

function localReference(files, from, reference, { publicUrl = false, allowDirectory = false } = {}) {
  if (!reference || /^(?:https?:|data:|mailto:|#)/.test(reference)) return;
  const raw = reference.split(/[?#]/, 1)[0];
  if (raw.includes('\\') || raw.includes('\0')) throw new Error('Unsafe reference in ' + from);
  let target = publicUrl && raw.startsWith('/') ? (raw.startsWith('/src/') ? raw.slice(1) : 'public' + raw) : path.posix.normalize(path.posix.join(path.posix.dirname(from), raw));
  if (target === '..' || target.startsWith('../') || path.posix.isAbsolute(target)) throw new Error('Reference leaves the clean source: ' + from + ' -> ' + reference);
  const candidates = [target, ...['.ts', '.tsx', '.js', '.mjs', '.json', '.css'].map(ext => target + ext), ...['.ts', '.tsx', '.js'].map(ext => target + '/index' + ext)];
  if (target.endsWith('.js')) candidates.push(target.slice(0, -3) + '.ts', target.slice(0, -3) + '.tsx');
  if (!candidates.some(candidate => files.has(candidate)) && !(allowDirectory && [...files.keys()].some(file => file.startsWith(target.replace(/\/$/, '') + '/')))) throw new Error('Unexported local reference: ' + from + ' -> ' + reference);
}

function importsFrom(file, text) {
  const parsed = parseSync(file, text);
  if (parsed.errors.length) throw new Error('Cannot inspect imports in invalid source: ' + file);
  const pending = [parsed.program], imports = [];
  while (pending.length) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    let source;
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)) source = node.source;
    if (node.type === 'CallExpression' && node.callee?.name === 'require') source = node.arguments[0];
    if (source) {
      if (typeof source.value !== 'string') throw new Error('Computed imports need an explicit export rule: ' + file);
      imports.push(source.value);
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) pending.push(...value); else if (value && typeof value === 'object') pending.push(value);
  }
  return imports;
}

function validate(files) {
  const pkg = JSON.parse(files.get('package.json').toString('utf8'));
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(pkg.version)) throw new Error('A safe package version is required.');
  const lock = JSON.parse(files.get('package-lock.json').toString('utf8'));
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) throw new Error('package.json and package-lock.json versions disagree.');
  const packages = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));
  for (const [file, bytes] of files) {
    if (file.split('/').some(part => ignored(part) && part !== '.gitignore')) throw new Error('Excluded path entered the manifest: ' + file);
    if (CODE.test(file)) {
      const text = bytes.toString('utf8');
      if (PRIVATE_PATH.test(text)) throw new Error('Private resource or machine-local path in ' + file);
      if (JS.test(file)) {
        for (const name of importsFrom(file, text)) {
          if (name.startsWith('.')) localReference(files, file, name);
          else {
            const packageName = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
            if (!name.startsWith('node:') && !builtinModules.includes(name) && !packages.has(packageName)) throw new Error('Undeclared or absolute import in ' + file + ': ' + name);
          }
        }
      }
      // Check literal public paths, including the prefixes used by bounded icon/audio lookups.
      const publicPaths = file.startsWith('src/') || file === 'index.html' || file === 'scripts/make-original-assets.mjs' ? text.matchAll(/['"`](\/(?:assets|audio|challenges)\/[^'"`\s]*)['"`]/g) : [];
      for (const match of publicPaths) {
        const reference = match[1].split('${', 1)[0];
        if (reference.startsWith('/assets/') && !reference.startsWith('/assets/original/')) throw new Error('Public assets must use the original collection: ' + file);
        localReference(files, file, reference, { publicUrl: true, allowDirectory: true });
      }
      if (file.endsWith('.html')) for (const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) localReference(files, file, match[1], { publicUrl: true });
    }
    if (file.endsWith('.md')) for (const match of bytes.toString('utf8').matchAll(/\]\(([^\s)]+)\)/g)) localReference(files, file, match[1], { allowDirectory: true });
  }
  const manifestFile = 'public/assets/original/manifest.json', manifest = JSON.parse(files.get(manifestFile).toString('utf8'));
  if (!manifest.assets || !Object.keys(manifest.assets).length) throw new Error('Original asset manifest is empty.');
  for (const [name, asset] of Object.entries(manifest.assets)) {
    if (typeof asset.url !== 'string' || !asset.url.startsWith('/assets/original/models/') || asset.url.includes('..')) throw new Error('Asset URL leaves the original collection: ' + name);
    const bytes = files.get('public' + asset.url);
    if (!bytes || hash(bytes) !== asset.sha256 || bytes.length !== asset.bytes || !asset.source || !asset.license) throw new Error('Original asset provenance or hash mismatch: ' + name);
  }
  const config = JSON.parse(files.get('mcp-config.example.json').toString('utf8'));
  for (const server of Object.values(config.mcpServers ?? {})) for (const value of Object.values(server.headers ?? {})) {
    if (typeof value !== 'string' || !/^(?:Bearer )?\$\{[A-Z][A-Z0-9_]*\}$/.test(value)) throw new Error('MCP configuration must contain environment placeholders only.');
  }
  for (const name of ['assets:generate', 'assets:check', 'release:export']) {
    const script = pkg.scripts?.[name], match = /^node (scripts\/[\w.-]+\.mjs)$/.exec(script ?? '');
    if (!match || !files.has(match[1])) throw new Error('Required release command is missing: ' + name);
  }
  return pkg;
}

async function verifyWritten(destination, files) {
  const seen = new Set();
  const walk = async relative => {
    for (const entry of await readdir(path.join(destination, relative), { withFileTypes: true })) {
      const file = path.posix.join(relative, entry.name);
      // macOS may generate these sidecars on exFAT while creating files; they are never payload.
      if (entry.name.startsWith('._') || entry.name === '.DS_Store') { await rm(path.join(destination, file), { force: true }); continue; }
      if (entry.isSymbolicLink()) throw new Error('Symlink found in clean export: ' + file);
      if (entry.isDirectory()) await walk(file);
      else {
        const expected = files.get(file);
        if (!expected || !entry.isFile() || hash(await readFile(path.join(destination, file))) !== hash(expected)) throw new Error('Export differs from its manifest: ' + file);
        seen.add(file);
      }
    }
  };
  await walk('');
  if (seen.size !== files.size) throw new Error('Clean export is incomplete.');
}

async function resolveNewDestination(target) {
  let existing = path.dirname(target);
  const missing = [path.basename(target)];
  while (true) {
    try { return path.join(await realpath(existing), ...missing); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.unshift(path.basename(existing)); existing = path.dirname(existing);
    }
  }
}

export async function exportCleanRelease({ sourceRoot = repositoryRoot, destination, now = new Date() } = {}) {
  const root = await realpath(sourceRoot), files = await collect(root), pkg = validate(files);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const target = path.resolve(root, destination ?? `output/releases/mcrush-${pkg.version}-${stamp}-source`);
  if (inside(target, root) || (inside(root, target) && !inside(path.join(root, 'output', 'releases'), target))) throw new Error('Destination must be new and outside source folders.');
  try { await lstat(target); throw new Error('Refusing to overwrite existing destination: ' + target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const payload = [...files].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([file, bytes]) => ({ path: file, bytes: bytes.length, sha256: hash(bytes) }));
  const manifest = { format: 'mcrush-clean-source-1', version: pkg.version, exportedAt: now.toISOString(), gitHistory: 'not included; initialize a new repository only after review', payloadFiles: payload.length, payloadBytes: payload.reduce((n, file) => n + file.bytes, 0), hashScope: 'files lists the payload; SHA256SUMS also covers RELEASE_MANIFEST.json and excludes itself', files: payload };
  files.set('RELEASE_MANIFEST.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  files.set('SHA256SUMS', Buffer.from([...files].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([file, bytes]) => `${hash(bytes)}  ${file}`).join('\n') + '\n'));
  // Resolve the nearest existing ancestor before creating anything: a symlink must not
  // redirect even an empty intermediate directory into the source tree.
  const resolved = await resolveNewDestination(target);
  if (inside(resolved, root) || (inside(root, resolved) && !inside(path.join(root, 'output', 'releases'), resolved))) throw new Error('Resolved destination enters source folders.');
  await mkdir(path.dirname(resolved), { recursive: true });
  await mkdir(resolved); // exclusive: a concurrently-created destination is never replaced
  try {
    for (const [file, bytes] of files) { const output = path.join(resolved, file); await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, bytes, { flag: 'wx' }); }
    await verifyWritten(resolved, files);
  } catch (error) {
    // This directory was exclusively created by this invocation, so partial exports are safe to remove.
    await rm(resolved, { recursive: true, force: true }); throw error;
  }
  return { destination: resolved, version: pkg.version, payloadFiles: manifest.payloadFiles, payloadBytes: manifest.payloadBytes, gitHistoryIncluded: false, symlinksIncluded: false, verified: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--help')) console.log('Usage: npm run release:export -- [--dest NEW_DIRECTORY]\nExports a verified allowlisted source snapshot; refuses to overwrite; does not initialize Git.');
    else {
      if (args.length && (args.length !== 2 || args[0] !== '--dest' || !args[1])) throw new Error('Use --dest NEW_DIRECTORY, or omit it for output/releases/version-timestamp-source.');
      console.log(JSON.stringify(await exportCleanRelease({ destination: args[1] }), null, 2));
    }
  } catch (error) { console.error('Clean export failed: ' + error.message); process.exitCode = 1; }
}
