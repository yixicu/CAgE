const fs = require('node:fs');
const path = require('node:path');
const link = path.resolve('node_modules');
const backup = link + '.carnot-previous';
const stage = link + '.carnot-new';

function junctionExists(location) {
  const stat = fs.lstatSync(location, { throwIfNoEntry: false });
  if (!stat) return false;
  if (!stat.isSymbolicLink()) throw Error('Expected a directory link at ' + location);
  return true;
}

if (junctionExists(backup)) {
  if (!junctionExists(link)) fs.renameSync(backup, link);
  else fs.unlinkSync(backup);
}
const previous = junctionExists(link);
if (junctionExists(stage)) fs.unlinkSync(stage);
fs.symlinkSync(fs.realpathSync(process.env.CARNOT_RECOVERY_MODULES), stage, 'junction');
try {
  if (previous) fs.renameSync(link, backup);
  try { fs.renameSync(stage, link); }
  catch (error) {
    if (previous) fs.renameSync(backup, link);
    throw error;
  }
  if (previous) fs.unlinkSync(backup);
} finally {
  if (junctionExists(stage)) fs.unlinkSync(stage);
}
