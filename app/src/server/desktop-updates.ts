import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const api = 'https://api.github.com/repos/yixicu/CAgE/releases';
const versionPattern = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
const maxInstaller = 512 * 1024 * 1024;
export class UpdateError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
function invalid() { return new UpdateError(502, 'UPDATE_INVALID', 'GitHub did not provide a complete, verifiable Windows release.'); }
function newer(latest: string, current: string) {
  const a = latest.split('.').map(Number), b = current.split('.').map(Number);
  const diff = a.map((value, i) => value - b[i]).find(value => value !== 0);
  return diff !== undefined && diff > 0;
}
const receipt = 'cage-update.json';
async function isPlainDirectory(path: string) {
  const entry = await lstat(path);
  return entry.isDirectory() && !entry.isSymbolicLink();
}
async function removePackage(folder: string, filename: string) {
  if (!await isPlainDirectory(folder)) return;
  const entries = await readdir(folder, { withFileTypes: true });
  if (entries.some(entry => !entry.isFile() || entry.isSymbolicLink() || (entry.name !== filename && entry.name !== receipt))) return;
  // Windows may still hold the executable open. Keep its receipt until removal succeeds.
  for (const name of [filename, receipt]) {
    if (entries.some(entry => entry.name === name)) await unlink(join(folder, name));
  }
  await rmdir(folder);
}
interface Asset { id: number; name: string; size: number; digest: string }
interface Release { tag_name: string; draft: boolean; prerelease: boolean; assets: Asset[] }

export async function readLimited(response: Response, limit: number, consume: (chunk: Uint8Array) => Promise<void>, invalidResponse = invalid) {
  if (!response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw invalidResponse();
  }
  const reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return size;
      size += value.byteLength;
      if (size > limit) throw invalidResponse();
      await consume(value);
    }
  } finally { await reader.cancel(); }
}

export class DesktopUpdates {
  constructor(readonly currentVersion: string, private directory: string, private request = fetch) {
    if (!versionPattern.test(currentVersion)) throw Error('Invalid desktop package version.');
  }
  private async get(url: string, accept: string, token?: string) {
    const response = await this.request(url, {
      redirect: 'manual', signal: AbortSignal.timeout(accept === 'application/json' ? 30_000 : 300_000),
      headers: { Accept: accept, 'User-Agent': 'CAgE-desktop-updater', ...(token ? { Authorization: 'Bearer ' + token } : {}) }
    }).catch(() => { throw new UpdateError(502, 'UPDATE_CONNECTION', 'Could not connect to GitHub. Check your network and try again.'); });
    if (!response.ok && !(response.status >= 300 && response.status < 400)) {
      await response.body?.cancel();
      if ([401, 403, 404].includes(response.status)) throw new UpdateError(response.status, 'UPDATE_ACCESS', 'GitHub release access is unavailable. Check release availability, rate limits, or use a token with read access to this repository.');
      throw new UpdateError(502, 'UPDATE_CONNECTION', 'GitHub could not complete the update request.');
    }
    return response;
  }
  private async release(token?: string) {
    const res = await this.get(api + '/latest', 'application/json', token);
    if (!res.ok) { await res.body?.cancel(); throw invalid(); }
    const chunks: Buffer[] = [];
    await readLimited(res, 1024 * 1024, async chunk => { chunks.push(Buffer.from(chunk)); });
    let release: Release;
    try { release = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw invalid(); }
    const version = typeof release?.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : '';
    if (!versionPattern.test(version) || release.draft !== false || release.prerelease !== false) throw invalid();
    return { version, assets: release.assets };
  }
  private async cleanInstalled() {
    if (!await isPlainDirectory(this.directory).catch(() => false)) return;
    for (const entry of await readdir(this.directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^release-[a-zA-Z0-9]{6}$/.test(entry.name)) continue;
      const folder = join(this.directory, entry.name);
      try {
        const marker = join(folder, receipt);
        const stat = await lstat(marker);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 200) continue;
        const data = JSON.parse(await readFile(marker, 'utf8'));
        if (data.owner !== 'cage-desktop-update-v1' || typeof data.version !== 'string' || !versionPattern.test(data.version) || newer(data.version, this.currentVersion)) continue;
        await removePackage(folder, 'Carnot-' + data.version + '-windows-x64-setup.exe');
      } catch { /* A running installer can still have the file open. Retry on the next check. */ }
    }
  }
  async check(token?: string) {
    await this.cleanInstalled().catch(() => {});
    const { version } = await this.release(token);
    return { currentVersion: this.currentVersion, latestVersion: version, available: newer(version, this.currentVersion) };
  }
  async download(expected: string, token?: string) {
    const { version, assets } = await this.release(token);
    if (version !== expected || !newer(version, this.currentVersion)) throw new UpdateError(409, 'UPDATE_CHANGED', 'Check for updates again before installing.');
    const name = 'Carnot-' + version + '-windows-x64-setup.exe';
    const asset = Array.isArray(assets) && assets.find(item => item?.name === name);
    if (!asset || !Number.isSafeInteger(asset.id) || asset.id <= 0 || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > maxInstaller || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) throw invalid();
    let res = await this.get(api + '/assets/' + asset.id, 'application/octet-stream', token);
    if (res.status === 302 || res.status === 307) {
      const location = URL.parse(res.headers.get('location') ?? '');
      await res.body?.cancel();
      if (!location || location.protocol !== 'https:' || location.hostname !== 'release-assets.githubusercontent.com' || location.port || location.username || location.password) throw invalid();
      res = await this.get(location.href, 'application/octet-stream');
    }
    if (res.status !== 200) { await res.body?.cancel(); throw invalid(); }
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if (!await isPlainDirectory(this.directory)) throw new UpdateError(409, 'UPDATE_STORAGE', 'The desktop update folder must be a local directory.');
    const folder = await mkdtemp(join(this.directory, 'release-'));
    const path = join(folder, name);
    const discard = () => removePackage(folder, name);
    try {
      const file = await open(path, 'wx', 0o600);
      const hash = createHash('sha256');
      try {
        const size = await readLimited(res, asset.size, async chunk => { await file.writeFile(chunk); hash.update(chunk); });
        if (size !== asset.size || 'sha256:' + hash.digest('hex') !== asset.digest) throw invalid();
      } finally { await file.close(); }
      await writeFile(join(folder, receipt), JSON.stringify({ owner: 'cage-desktop-update-v1', version }), { flag: 'wx', mode: 0o600 });
      return { path, discard };
    } catch (error) { await discard(); throw error; }
  }
}
export async function launchUpdate(path: string) {
  const child = spawn(path, ['--update'], { cwd: dirname(path), detached: true, stdio: 'ignore', windowsHide: false });
  await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
}
