import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const lock = (await readJson('package-lock.json')).packages;
const plan = await readJson('sources.json');
const target = join(process.cwd(), 'private', 'packages', 'node_modules');
const tar = join(process.env.SystemRoot, 'System32', 'tar.exe');

async function stagePackage([slot, source], index) {
  const name = slot.split('/node_modules/').at(-1);
  const pkg = lock['node_modules/' + slot];
  const dest = join(target, slot);
  await mkdir(dest, { recursive: true });
  if (source) {
    // Nested slots have independent selections in the lockfile.
    const root = await realpath(source);
    await cp(root, dest, {
      recursive: true,
      filter: async path => {
        if (path === root) return true;
        if (basename(path) === 'node_modules') return false;
        if ((await lstat(path)).isSymbolicLink())
          throw new Error('Linked content in ' + name + '. Select "Install this fresh" for this package.');
        return true;
      },
    });
  } else {
    const url = new URL(pkg.resolved);
    if (url.origin !== 'https://registry.npmjs.org') throw new Error('Unexpected package registry');
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error('Download failed for ' + name + ' (' + response.status + ')');
    const data = Buffer.from(await response.arrayBuffer());
    if ('sha512-' + createHash('sha512').update(data).digest('base64') !== pkg.integrity)
      throw new Error('Checksum verification failed for ' + name);
    const archive = join(process.cwd(), index + '.tgz');
    await writeFile(archive, data);
    try {
      await exec(tar, ['-xzf', archive, '--strip-components', '1', '-C', dest], { windowsHide: true });
    } finally {
      await rm(archive, { force: true });
    }
  }
  const manifest = await readJson(join(dest, 'package.json'));
  if (manifest.name !== name || manifest.version !== pkg.version)
    throw new Error('Package validation failed for ' + slot);
}

const entries = Object.entries(plan);
let next = 0;
async function worker() {
  while (next < entries.length) {
    const index = next++;
    await stagePackage(entries[index], index);
  }
}
const results = await Promise.allSettled(Array.from({ length: 5 }, worker));
const failure = results.find(result => result.status === 'rejected');
if (failure) throw failure.reason;

// Recreate package command launchers in the same resolution scope as npm.
for (const [slot] of entries) {
  const pkg = lock['node_modules/' + slot];
  const name = slot.split('/node_modules/').at(-1);
  const dest = join(target, slot);
  const binDir = join(dest, ...name.split('/').map(() => '..'), '.bin');
  const bins = typeof pkg.bin === 'string' ? { [basename(name)]: pkg.bin } : pkg.bin;
  for (const [command, file] of Object.entries(bins ?? {})) {
    await mkdir(binDir, { recursive: true });
    const script = relative(binDir, join(dest, file));
    await writeFile(join(binDir, command + '.cmd'), '@echo off\r\nnode "%~dp0\\' + script + '" %*\r\n');
  }
}

