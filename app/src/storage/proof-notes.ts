import { join } from 'node:path';
import type { RawAnswerRefV21 } from '../research/contracts/v21.js';
import type { ProofNotes } from '../presentation/proof-annotations.js';
import type {ProofConfirmation} from '../presentation/proof-questionnaire.js';
import { atomicWrite, readJson } from './atomic.js';

function file(root:string, ref:RawAnswerRefV21){
  if(!/^raw_[0-9a-f]{64}$/.test(ref.id)||!/^[0-9a-f]{64}$/.test(ref.bodyHash))throw Error('Invalid proof identity.');
  return join(root,'proof-annotations',ref.id+'-'+ref.bodyHash+'.json');
}
export async function saveProofNotes(root:string,ref:RawAnswerRefV21,notes:ProofNotes, confirmations:ProofConfirmation[]=[]){
  await atomicWrite(file(root,ref),JSON.stringify({...notes,...(confirmations.length?{confirmations}:{})}));
}
export async function loadProofNotes(root:string,ref:RawAnswerRefV21){
  try{return await readJson<ProofNotes & {confirmations?:ProofConfirmation[]}>(file(root,ref));}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
}
