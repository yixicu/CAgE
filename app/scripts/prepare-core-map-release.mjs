import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {stableHash} from '../src/learning/research-hash.ts';

const root=fileURLToPath(new URL('../../',import.meta.url));
const path=new URL('../src/shared/core-map-release.json',import.meta.url);
const previous=JSON.parse(readFileSync(path,'utf8'));
const version=Number(process.argv[2]);
if(!Number.isSafeInteger(version)||version<=previous.version)throw Error('Supply a new integer Core map version greater than '+previous.version+'.');
const bytes=execFileSync('git',['show',':app/web/core-preview.json'],{cwd:root,maxBuffer:8*1024*1024});
const sha256=stableHash(JSON.parse(bytes.toString('utf8')));
if(sha256===previous.sha256)throw Error('The staged map contents are unchanged. Stage the revised app/web/core-preview.json first.');
const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
writeFileSync(path,JSON.stringify({version,blob,sha256},null,2)+'\n');
console.log('Prepared Core map v'+version+'. Commit the staged map and its manifest together.');
