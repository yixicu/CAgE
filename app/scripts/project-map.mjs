import {createHash} from 'node:crypto';
import {mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const format = 'carnot-project-map-v1';
const endpoint = '/api/research/knowledge-map';
const digest = text => createHash('sha256').update(text).digest('hex');
const refKey = ref => JSON.stringify([ref.store, ref.id, ref.version, ref.bodyHash]);
const family = ref => JSON.stringify([ref.store, ref.id]);
const pretty = data => JSON.stringify(data, null, 2);

export async function exportMap(view, directory) {
  const {projectId, ownerId} = view.profile;
  const local = source => source.projectId === projectId && source.ownerId === ownerId;
  const entries = view.entries.filter(entry => entry.ownerId === ownerId &&
    (entry.createdFrom.length ? entry.createdFrom.every(local) : entry.maintenanceDraft?.projectId === projectId));
  const refs = new Set(entries.map(entry => refKey(entry.ref)));
  const relations = view.relations.filter(edge => refs.has(refKey(edge.from)) &&
    refs.has(refKey(edge.to)) && (edge.sources ?? []).every(local));
  const snapshot = {format, projectId, ownerId, recipe:view.recipe, revision:view.revision,
    mapVersion:view.version, profileVersion:view.profile.version, relations, entries:[]};
  await mkdir(directory);
  await mkdir(path.join(directory, 'proofs'));
  await mkdir(path.join(directory, 'statements'));
  async function saveText(file, text) {
    await writeFile(path.join(directory, file), text, {flag:'wx', encoding:'utf8'});
    return {file, sha256:digest(text)};
  }
  for (const [i, entry] of entries.entries()) {
    const {body, supports, suppliedProof, ...record} = entry;
    if (body !== undefined) record.body = await saveText(`statements/${i+1}.md`, body);
    record.supports = [];
    for (const [j, support] of supports.entries()) {
      if (!support.sources.every(local)) continue;
      const {argument, ...metadata} = support;
      record.supports.push({...metadata, argument:await saveText(`proofs/${i+1}-support-${j+1}.md`, argument)});
    }
    if (suppliedProof && local(suppliedProof.source)) {
      record.suppliedProof = {source:suppliedProof.source,
        argument:await saveText(`proofs/${i+1}-supplied.md`, suppliedProof.argument)};
    }
    snapshot.entries.push(record);
  }
  // Writing the manifest last keeps a partial export from being used as a complete package.
  await writeFile(path.join(directory, 'map.json'), pretty(snapshot) + '\n', {flag:'wx'});
  return {projectId, entries:entries.length, relations:relations.length, revision:view.revision};
}

export async function loadSeeds(directory) {
  const root = await realpath(directory);
  async function readMember(member) {
    const filename = path.join(root, member);
    if (path.relative(root, await realpath(filename)) !== path.normalize(member)) {
      throw Error('Expected a regular package member: ' + member);
    }
    return readFile(filename, 'utf8');
  }
  const snapshot = JSON.parse(await readMember('map.json'));
  if (snapshot.format !== format || !Array.isArray(snapshot.entries) || !Array.isArray(snapshot.relations)) {
    throw Error('Unsupported project map package.');
  }
  async function readText(record, pattern) {
    if (!pattern.test(record.file)) throw Error('Invalid package filename.');
    const text = await readMember(record.file);
    if (digest(text) !== record.sha256) throw Error('Package checksum mismatch: ' + record.file);
    return text;
  }
  const versions = new Map();
  for (const entry of snapshot.entries) {
    const key = family(entry.ref);
    versions.set(key, Math.max(versions.get(key) ?? 0, entry.ref.version));
  }
  const seeds = new Map();
  for (const entry of snapshot.entries) {
    if (entry.ref.version !== versions.get(family(entry.ref)) || entry.status !== 'active' ||
        entry.qualification === 'disputed' || entry.qualification === 'withdrawn' ||
        !['theorem','concept','observation'].includes(entry.kind) || !entry.body) continue;
    const body = await readText(entry.body, /^statements\/[1-9]\d*\.md$/);
    const proofPath = /^proofs\/[1-9]\d*-(?:support-[1-9]\d*|supplied)\.md$/;
    const proofs = [];
    if (entry.suppliedProof) proofs.push(await readText(entry.suppliedProof.argument, proofPath));
    for (const support of entry.supports) {
      if (!['proved','pending'].includes(support.status)) continue;
      const argument = await readText(support.argument, proofPath);
      if (!argument.trim()) continue;
      const {argument:_file, ...provenance} = support;
      proofs.push('Original argument record\n\n' + pretty(provenance) + '\n\n' + argument);
    }
    // The seed store retains the original key in its source metadata. The target owns the new identity.
    const key = JSON.stringify([snapshot.ownerId, snapshot.projectId, ...JSON.parse(refKey(entry.ref))]);
    const {kind, nodeType, title, summary, aliases, domain, assumptions, observation} = entry;
    const seed = {key, kind, nodeType, title, summary, aliases, domain, body, assumptions, observation, relations:[]};
    if (kind !== 'observation' && proofs.length) seed.proof = proofs.join('\n\n---\n\n');
    seeds.set(refKey(entry.ref), seed);
  }
  let importedRelations = 0;
  for (const {status, from, to, kind, direction, basis} of snapshot.relations) {
    const source = seeds.get(refKey(from)), target = seeds.get(refKey(to));
    if (status !== 'active' || !source || !target || source === target || kind === 'member-of' && direction !== 'forward') continue;
    const seedKind = kind === 'member-of' ? 'upper-structure' : kind;
    if (source.relations.some(edge=>edge.target === target.key && edge.kind === seedKind && edge.direction === direction)) continue;
    source.relations.push({target:target.key, kind:seedKind, direction, basis});
    importedRelations++;
  }
  return {entries:[...seeds.values()], skippedEntries:snapshot.entries.length-seeds.size,
    skippedRelations:snapshot.relations.length-importedRelations};
}

async function main([action, url, projectId, directory, version, ...extra]) {
  if (!['export','import'].includes(action) || !url || !projectId || !directory || extra.length ||
      (action === 'export' ? version !== undefined : !/^\d+$/.test(version ?? '') || !Number.isSafeInteger(Number(version)))) {
    throw Error('Usage: node scripts/project-map.mjs export URL PROJECT NEW_DIRECTORY | import URL PROJECT DIRECTORY EXPECTED_PROFILE_VERSION');
  }
  const server = new URL(url);
  if (server.protocol !== 'http:' || !['localhost','127.0.0.1'].includes(server.hostname) || server.username || server.password) {
    throw Error('Supply the local HTTP Carnot server URL.');
  }
  async function api(route, options) {
    const response = await fetch(new URL(route, server), {...options, redirect:'error'});
    if (!response.ok) throw Error('Carnot ' + response.status + ': ' + await response.text());
    return response.json();
  }
  const {requestToken} = await api('/api/bootstrap');
  const headers = {'X-Carnot-Token':requestToken, Origin:server.origin, 'Content-Type':'application/json'};
  if (action === 'export') {
    const view = await api(endpoint + '?projectId=' + encodeURIComponent(projectId), {headers});
    return exportMap(view, directory);
  }
  const {entries, skippedEntries, skippedRelations} = await loadSeeds(directory);
  if (!entries.length) return {imported:0, skippedEntries, skippedRelations};
  const requestId = 'portable-' + digest(JSON.stringify([projectId, entries]));
  const receipt = await api(endpoint + '/seeds', {method:'POST', headers,
    body:JSON.stringify({projectId, requestId, expectedProfileVersion:Number(version), entries})});
  return {imported:receipt.entries.length, skippedEntries, skippedRelations, requestId,
    profileVersion:receipt.profile.version, maintenance:receipt.maintenance};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(result => console.log(pretty(result))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
