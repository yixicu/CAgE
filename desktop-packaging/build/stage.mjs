import { cpSync, existsSync, mkdirSync, renameSync, mkdtempSync, rmSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = join(root, 'desktop-packaging/out');
const destination = join(output, 'payload');
if (existsSync(destination) && (lstatSync(destination).isSymbolicLink() || !existsSync(join(destination,'app/package.json')))) throw Error('Unexpected contents in out/payload. Move the directory aside before building.');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major !== 24 || minor < 19 || process.arch !== 'x64' || process.platform !== 'win32') throw Error('Use Windows x64 Node ^24.19.0.');
mkdirSync(output, {recursive:true});
const stage = mkdtempSync(join(output, 'stage-'));
const app = join(stage, 'app');
const copy = (file) => cpSync(join(root,file), join(app,file), {recursive:true});
for (const file of ['package.json','LICENSE','scripts/launch.mjs','scripts/project-map.mjs','docs/MAINTENANCE.md','docs/THIRD_PARTY_NOTICES.md','plugins']) copy(file);
const run = (file,args) => execFileSync(process.execPath,[join(root,file),...args],{cwd:root,stdio:'inherit'});
run('node_modules/typescript/bin/tsc',['-p','tsconfig.json','--outDir',join(app,'dist'),'--declaration','false']);
run('node_modules/vite/bin/vite.js',['build','--config','desktop-packaging/build/vite.config.ts','--configLoader','runner','--outDir',join(app,'dist/web')]);
const previous = stage + '-previous';
if (existsSync(destination)) renameSync(destination,previous);
try {
  renameSync(stage,destination);
} catch (error) {
  if (existsSync(previous)) renameSync(previous,destination);
  throw error;
}
if (existsSync(previous)) rmSync(previous,{recursive:true,force:true});
console.log(destination);