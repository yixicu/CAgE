import {stableHash} from '../learning/research-hash.js';
import type {PostReportStudyV45, ReportEvidenceV45, ResearchReplyV45} from '../research/versions/v4/post-report.js';

import type {Context} from '@earendil-works/pi-ai';
import {RuntimeError} from './errors.js';

const bytes = (value:unknown) => Buffer.byteLength(JSON.stringify(value));
type PageRequest = NonNullable<ResearchReplyV45['contextPages']>[number];

/** Built anew from this phase's authorized presentation. A hash is an address, never a grant. */
export class ModeratorContextPages {
    readonly inputBytes: number;
    readonly passageSize: number;
    constructor(window = 32000, output = 8000) {
        const capacity = window > 0 ? window : 32000;
        const reserve = Math.min(output > 0 ? output : capacity / 3, capacity / 3);
        // Approximate provider tokenization and leave room for message framing.
        this.inputBytes = Math.max(0, Math.floor((capacity - reserve - 256) * 2.4));
        this.passageSize = Math.max(120, Math.floor(this.inputBytes / 3));
    }

    private documents = new Map<string, string>();

    private present(text: string, preview: number) {
        if (text.length <= preview) return text;
        const ref = 'text:' + stableHash(text);
        this.documents.set(ref, text);
        return {ref, length: text.length, preview: text.slice(0, preview), nextOffset: preview};
    }

    value(value: unknown, preview = this.passageSize): unknown {
        if (value === undefined) return;
        if (typeof value === 'string') return this.present(value, preview);
        const json = JSON.stringify(value);
        return json.length <= preview ? value : this.present(json, preview);
    }

    report(report: ReportEvidenceV45, preview: number): unknown {
        const {body, proofOutline, related, supplements, ...basis} = report;
        return {...basis, ...(proofOutline && body.includes(proofOutline) ? {proofOutline} : {}), body: this.present(body, proofOutline && body.length > preview ? Math.min(preview, 360) : preview),
            supplements: supplements?.map(({body, ...record}) => ({...record, body: this.present(body, 240)})),
            related: related?.map(source => this.report(source, 240))};
    }

    history(responses: ResearchReplyV45[]) {
        const history = responses.filter(r => r.action !== 'read-context-page' &&
            !(r.action === 'read-batch' && r.readCalls?.every(call => call.request.action === 'read-context-page')));
        const records = history.map((response, index) => {
            const {knowledge, map, mapRead, mapWriteReads, reads, readCalls, ...science} = response;
            const recent = index >= history.length - 2;
            return {action: response.action, record: this.value(science, recent ? this.passageSize : 180)};
        });
        // Keep earlier research discoverable in small, individually pageable groups.
        const prior = records.slice(0, -2);
        const catalogue = [];
        for (let index = 0; index < prior.length; index += 16)
            catalogue.push({from: index + 1, through: Math.min(index + 16, prior.length), records: this.value(prior.slice(index, index + 16), 320)});
        const summary = history.findLast(r => r.action === 'continue' && r.scientificSummary)?.scientificSummary;
        const objection = history.findLast(r => r.action === 'revise');
        return {prior: this.value(catalogue, 1800), recent: records.slice(-2),
            scientificSummary: summary && this.present(summary, this.passageSize),
            latestRevisionRequest: objection && this.present(objection.body, this.passageSize)};
    }

    /** Keep base projection deterministic across page-only turns, including nested references. */
    fit(context: Context, {requests, workingNote, repeated}: ReturnType<typeof contextPageProgress>) {
        const baseline = bytes({...context, messages:[]});
        const room = this.inputBytes - baseline;
        if (room < 640) throw new RuntimeError('CONTEXT_EXHAUSTED');
        const target = baseline + Math.floor(room * 0.65);
        if (bytes(context) > target) {
            const sections = context.messages.map(msg => JSON.parse(String(msg.content)) as Record<string, unknown>);
            const fields = sections.flatMap(obj => Object.keys(obj).flatMap(key => {
                const value = obj[key];
                if (['report','research','knowledge','knowledgeMap'].includes(key) && value && typeof value === 'object')
                    return Object.keys(value).map(field => ({obj:value as Record<string,unknown>, key:field}));
                return [{obj, key}];
            })).map(field => ({...field, size:bytes(field.obj[field.key])})).sort((a,b)=>b.size-a.size);
            for (const {obj,key,size} of fields) {
                if (size < 300) break;
                const value = obj[key] as {ref?:string;preview?:string} | string;
                if (typeof value === 'object' && value?.ref && typeof value.preview === 'string')
                    obj[key] = {...value,preview:value.preview.slice(0,64),nextOffset:Math.min(64,value.preview.length)};
                else obj[key] = this.present(typeof value === 'string' ? value : JSON.stringify(value), 64);
                context.messages.forEach((msg,i)=>{msg.content=JSON.stringify(sections[i]);});
                if (bytes(context) <= target) break;
            }
        }
        // Notes and exact pages arrive after the base fit so navigation cannot change its own address.
        if (workingNote || repeated) {
            const noteRoom=Math.max(16,Math.min(1200,Math.floor((this.inputBytes-bytes(context)-400)/8)));
            context.messages.push({role:'user',timestamp:Date.now(),content:JSON.stringify({
                pageWorkingNote:workingNote && this.present(workingNote,noteRoom),
                repeatedOffset:repeated ? 'This offset was just read. Use its nextOffset to advance, or continue your scientific assessment.' : undefined
            })});
        }
        const remaining = this.inputBytes - bytes(context);
        if (remaining < 320) throw new RuntimeError('CONTEXT_EXHAUSTED');
        if (!requests.length) return;
        const unique = [...new Map(requests.map(request=>[JSON.stringify([request.ref,request.offset]),request])).values()];
        const exactPages = [];
        let deferred = unique.length;
        const message = {role:'user' as const,timestamp:Date.now(),content:''};
        for (const request of unique) {
            // Measure the actual nested JSON encoding, including quotes, escapes and Unicode.
            let low=1, high=this.passageSize, fitted;
            while (low<=high) {
                const count=Math.floor((low+high)/2);
                const page=this.result(request,count);
                message.content=JSON.stringify({exactPages:[...exactPages,page],deferred:deferred-1});
                if(bytes(message)+2<=remaining){fitted=page;low=count+1;}else high=count-1;
            }
            if(!fitted)break;
            exactPages.push(fitted);deferred--;
        }
        if(!exactPages.length)throw new RuntimeError('CONTEXT_EXHAUSTED');
        message.content=JSON.stringify({exactPages,deferred});
        context.messages.push(message);
    }

    result({ref, offset}: PageRequest, count = this.passageSize) {
        const text = this.documents.get(ref);
        if (text === undefined || !Number.isSafeInteger(offset) || offset < 0 || offset >= text.length)
            return {ref:ref.slice(0,80), offset, notice: 'This page is unavailable in the current view. Choose a displayed reference and offset.'};
        const body = text.slice(offset, offset + count);
        return {ref, offset, body, length: text.length, nextOffset: offset + body.length < text.length ? offset + body.length : undefined};
    }
}

function responsePages(last?: ResearchReplyV45) {
    if (last?.action === 'read-context-page') return last.contextPages ?? [];
    if (last?.action === 'read-batch')
        return (last.readCalls ?? []).flatMap(call => call.request.contextPages ?? []);
    return [];
}

export function contextPageProgress(study: PostReportStudyV45) {
    const boundary = study.responses.findLastIndex(r => r.action === 'review' || r.action === 'revise');
    const responses = study.responses.slice(boundary + 1);
    const requests = responsePages(responses.at(-1));
    let workingNote;
    for (let i = responses.length - 1; i >= 0 && !workingNote; i--)
        workingNote = responsePages(responses[i]).findLast(page => page.workingNote)?.workingNote;
    const previous = responsePages(responses.at(-2));
    const repeated = requests.some(page => previous.some(prior=>prior.ref===page.ref && prior.offset===page.offset));
    return {requests, workingNote, repeated};
}
