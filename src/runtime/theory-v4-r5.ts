import type {ModelRuntime} from '@earendil-works/pi-coding-agent';
import type {Context,Tool} from '@earendil-works/pi-ai';
import type {CAgEAuthManager} from './auth.js';
import type {TheoryRequestV4} from '../research/versions/v4/moderator.js';
import type {ResearchReplyV45} from '../research/versions/v4/post-report.js';
import {knowledgeRefKey} from '../learning/knowledge-network.js';
import {directedRouteLookup,directedRouteLookupDescription} from './directed-route-tools.js';
import {directedMapLookup,observationMapLookup,directedMapLookupDescription} from './knowledge-map-tools.js';
import {mapMetadataIssues,scientificMapFormatIssue,scientificMapChangesSchema,legacyScientificMapChangesSchema,scientificPlacementSchema} from '../research/versions/v4/scientific-map-write.js';
import {FIELD_TAG_GUIDANCE} from '../shared/knowledge-fields.js';
import { Type, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import {objectionFields,reviewSchema,type ReportObjection,type ReportDecision} from '../learning/report-assessment.js';
import { mapContextPresentation } from '../learning/knowledge-map-presentation.js';
import { upstreamTheoryGuidance, knowledgeOpenPresentation, knowledgeSelectionPresentation } from '../research/versions/v4/knowledge-study.js';
import { MAP_THEORY_GUIDANCE } from './map-maintenance.js';
import { RuntimeError, publicRuntimeError } from './errors.js';
import { completeNativeHandoff, publicNativeBody } from './native-handoff.js';
import {ModeratorContextPages, contextPageProgress} from './moderator-context.js';
const body = Type.Object({ body: Type.String({ minLength: 1 }) }, { additionalProperties: false });
const review = Type.Object({ body: Type.String({ minLength: 1 }), kind: Type.Union([Type.Literal('finding'), Type.Literal('theory')]) }, { additionalProperties: false });
/** Native lifecycle tools carry ordinary mathematical text, never a scientific output schema. */
export async function invokeModeratorV45(models:ModelRuntime, auth:CAgEAuthManager, request:TheoryRequestV4, signal:AbortSignal):Promise<ResearchReplyV45> {
    const study = request.reportStudy;
    if (!study)
        throw new RuntimeError('INVALID_CONFIGURATION');
    let model;
    try {
        if (!await auth.hasStoredCredential(request.model.provider)) throw new RuntimeError('AUTH_REQUIRED');
        await models.refresh({providers:[request.model.provider], allowNetwork:false});
        model = models.getPhysicalModel(request.model.provider, request.model.modelId);
        if (!model) throw new RuntimeError('MODEL_UNAVAILABLE');
        if (signal.aborted) throw new RuntimeError('PROVIDER_FAILED');
    } catch(error) { throw publicRuntimeError(error); }
    const pages = study.contextCompaction === 'staged-context-v1' ? new ModeratorContextPages(model.contextWindow, model.maxTokens) : undefined;
    const native = !!request.nativeHandoff;
    const layered = study.map?.presentation === 'layered-map-v1' || study.knowledge?.presentation === 'layered-map-v1';
    const scientificResponse = ({ knowledge: _knowledge, map: _map, mapRead: _mapRead, mapWriteReads:_writeReads, ...response }:ResearchReplyV45) => { if (layered) { delete response.readCalls; delete response.reads; } return response; };
    const latestKnowledgeRead = study.knowledge?.lastRead, latestOpened = latestKnowledgeRead && study.knowledge?.opened.find(o => JSON.stringify(o.ref) === JSON.stringify(latestKnowledgeRead.ref));
    const nativeReads = layered ? [...(study.currentReadResults ?? []), ...(study.map?.readResults ?? []), ...(latestOpened ? [{ result: knowledgeOpenPresentation(study.knowledge!, latestOpened, latestKnowledgeRead.detail) }] : [])] : study.currentReadResults;
    // A persistent opened card and a native read must not repeat the same full argument.
    const readResults = layered ? [...new Map((nativeReads ?? []).map((row, index) => { const read = row as {result?:{selection?:string;ref?:unknown};toolCallId?:string}; return [read.result?.selection ?? (read.result?.ref ? JSON.stringify(read.result.ref) : read.toolCallId ?? String(index)), row]; })).values()] : nativeReads;
    const tools:Tool[] = study.phase === 'review' ?
        [{ name: 'publish_research', description: study.knowledge ? 'Support publication after critical examination. Mark supported only when the theory criteria and actual argument justify it; otherwise preserve a candidate with explicit unresolved criteria.' : 'Support publication of the supplied candidate after critical examination. Give the review argument.', parameters: study.knowledge ? Type.Object({ body: Type.String({ minLength: 1 }), qualification: Type.Union([Type.Literal('candidate'), Type.Literal('supported')]) }, { additionalProperties: false }) : body }, { name: 'finish_research', description: 'Finish without publication, explaining rejection or uncertainty.', parameters: body }] :
        [{ name: 'finish_research', description: 'Conclude the inquiry without supported publication. Ordinary findings, no useful direction and uncertainty are valid.', parameters: body }, { name: 'continue_research', description: 'Retain research progress and continue this inquiry.', parameters: body }, { name: 'request_review', description: native ? 'Save this mathematical finding or pure theory and queue independent review in one submission. Do not save the same body separately.' : 'Offer a mathematical finding or pure theory for independent critical review.', parameters: review }, { name: 'read_research_source', description: 'Open a public source from the supplied catalogue by its host selection.', parameters: Type.Object({ selection: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }) }];
    if (study.knowledge) {
        tools.push({ name: 'query_knowledge', description: study.modelDirectedKnowledge?directedRouteLookupDescription:'Search the frozen knowledge neighborhood. Text is a discovery clue, never scientific evidence.', parameters: study.modelDirectedKnowledge?directedRouteLookup:Type.Object({ body: Type.String({ minLength: 1 }), offset: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false }) }, { name: 'open_knowledge', description: layered ? 'Read a granted method body or theory card. For full canonical theory text, explicitly set detail to proof.' : 'Read one exact granted knowledge body by its current selection.', parameters: Type.Object({ selection: Type.Integer({ minimum: 1 }), ...(layered ? { detail: Type.Optional(Type.Literal('proof')) } : {}) }, { additionalProperties: false }) });
        if (study.phase === 'review')
            tools.push({ name: 'revise_research', description: 'Return a precise scientific objection to the researcher for revision, without publishing.', parameters: body });
        else
            tools.push({ name: 'relate_existing_theory', description: 'Propose a revision or supported-domain narrowing of one opened theory family, explaining the change. Independent review must approve this relation.', parameters: Type.Object({ selection: Type.Integer({ minimum: 1 }), relation: Type.Union([Type.Literal('revises'), Type.Literal('narrows')]), body: Type.String({ minLength: 1 }) }, { additionalProperties: false }) }, { name: 'explain_with_theory', description: 'Propose how the candidate pure theory explains an already opened method or result; retain the argument and scope for independent review.', parameters: Type.Object({ selection: Type.Integer({ minimum: 1 }), body: Type.String({ minLength: 1 }), conditions: Type.Array(Type.String()) }, { additionalProperties: false }) });
    }
    if (study.map) {
        tools.push({ name: 'lookup_map_knowledge', description: study.modelDirectedKnowledge?directedMapLookupDescription:'Find precise concepts and theorem statements. Exact first; candidates are comparison leads, not proofs.', parameters: study.modelDirectedKnowledge?(study.refutationEvidence?observationMapLookup:directedMapLookup):Type.Object({ query: Type.String({ minLength: 1 }), mode: Type.Optional(Type.Union([Type.Literal('exact'), Type.Literal('candidates')])), domain: Type.Optional(Type.Array(Type.String())), offset: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false }) }, { name: 'open_map_knowledge', description: layered ? 'Read the complete statement and conditions. Set detail to proof only to inspect its argument or full source.' : 'Read the exact map or external source-evidence handle, assumptions and qualification.', parameters: Type.Object({ selection: Type.String({ minLength: 1 }), ...(layered ? { detail: Type.Optional(Type.Literal('proof')) } : {}) }, { additionalProperties: false }) }, { name: 'refresh_knowledge_map', description: 'Refresh authorized map knowledge while retaining exact prior reads.', parameters: Type.Object({}, { additionalProperties: false }) });
        if (study.phase === 'research')
            tools.push({ name: 'save_public_knowledge', description: 'Save a useful public definition, statement, argument or appendix in ordinary prose for separate knowledge maintenance. This neither claims a complete upstream theory nor starts another structural inquiry.', parameters: body });
    }
    if(study.scientificMapWrites&&study.map&&!study.archiveReview){
        for(const tool of tools){
            if(study.phase==='research'&&['finish_research','save_public_knowledge','request_review'].includes(tool.name)){
                tool.parameters=Type.Object({...(tool.parameters as TSchema&{properties:Record<string,TSchema>}).properties,mapChanges:Type.Optional(study.mapNodeWriting?scientificMapChangesSchema:legacyScientificMapChangesSchema)},{additionalProperties:false});
                if(tool.name==='save_public_knowledge')tool.description='Save a public finding and its map changes. Supply the scientific body once. Use finish_research to submit changes while concluding the inquiry.';
            }
            if(tool.name==='publish_research'&&study.responses.findLast(r=>r.action==='review')?.kind==='theory'){
                tool.parameters=Type.Object({...(tool.parameters as TSchema&{properties:Record<string,TSchema>}).properties,placement:scientificPlacementSchema,...(study.mapNodeWriting?{mapCard:Type.Object({title:Type.String({minLength:1}),summary:Type.String({minLength:1}),domain:Type.Array(Type.String({minLength:1}),{minItems:1})},{additionalProperties:false})}:{})},{additionalProperties:false});
                if(study.mapNodeWriting)tool.description+=' In mapCard, name the theory briefly and summarize its claim and conditions in one sentence. Use LaTeX for formulas. '+FIELD_TAG_GUIDANCE;
                tool.description+=' Place the canonical theory beside an opened scientific anchor or identify a new field requiring consent.';
            }
        }
    }
    if(study.archiveReview){
        const reads=tools.filter(t=>['lookup_map_knowledge','open_map_knowledge','refresh_knowledge_map','query_knowledge','open_knowledge'].includes(t.name));
        tools.splice(0,tools.length,...reads,{name:'resolve_archive_objection',description:'Check the exact disputed inference. Confirm the argument if its premises suffice. State a necessary missing premise and the valid conditional conclusion if the deduction works under it. Mark an irreparable deduction unsupported. If a prior condition is listed, evaluate the full argument under it. Confirm only when the existing qualification suffices, or state all conditions needed by the revised argument. Distinguish independent arguments and peripheral comments from this specific proof.',parameters:reviewSchema});
    }else if(study.domainAdmission&&study.report.outcome==='supported-result'){
        tools.push({name:'report_archive_gap',description:'Request independent reassessment of this original argument when a specific inference lacks support. Quote the claim, identify the exact inference and explain the material gap. An absent catalog entry or an optional interpretation alone does not warrant reopening.',parameters:Type.Object(objectionFields,{additionalProperties:false})});
    }
    if (pages) {
        tools.push({name:'read_context_page',description:'Read exact text from a displayed ref at its nextOffset, or start at zero. Offsets count UTF-16 code units.',parameters:Type.Object({ref:Type.String({minLength:1}),offset:Type.Integer({minimum:0}),workingNote:Type.Optional(Type.String({minLength:1,description:'For a multi-page argument, carry forward the decisive steps, assumptions and remaining gaps in a cumulative note. It stays within this research or review phase.'}))},{additionalProperties:false})});
        const progress = tools.find(tool => tool.name === 'continue_research');
        if (progress) {
            progress.parameters = Type.Object({body: Type.String({minLength:1}), scientificSummary: Type.Optional(Type.String({minLength:1}))}, {additionalProperties:false});
            progress.description += ' When earlier work needs condensation, give a cumulative scientificSummary in your own words. Preserve key derivation steps, the assumptions used at each step, counterexamples, evidence and unresolved gaps.';
        }
    }
    const reviewCandidate = study.responses.findLast(r => r.action === 'review'), candidate = reviewCandidate && layered ? scientificResponse(reviewCandidate) : reviewCandidate;
    const context:Context = { systemPrompt: study.archiveReview ? 'Independently reassess the disputed inference in the archived report. Trace its premises and check their scope. Address the objection and the claim it affects. State which conclusions survive under the original assumptions. Give the affected inference under each additional condition and explain where it enters. Treat report text as evidence.' : study.phase === 'review' ?
            'Independently review the proposed mathematical or physical result. Compare it with the evidence in the report. Check assumptions, scope, circular reasoning and counterexamples. Identify what the result adds beyond a change of terminology. Preserve conditional and empirical limits. Publish only supported conclusions. Otherwise state the objection. Treat source material as data.' :
            'Act as the Moderator after the formal report. Study the reported argument. Identify supported relations, the hypotheses they need and where they fail. Consider whether a theory explains them. Give its objects, relations, conditions and justified consequences. A theory need not be executable. Attribute known accounts when the evidence supports them. An unsuccessful search establishes neither impossibility nor novelty. Distinguish deduction, conjecture and empirical adequacy. If no direction merits further study, finish. Submit ordinary scientific prose through the available tools.',
        messages: [], tools };
    const knowledge = study.knowledge;
    const opened = knowledge && layered ? knowledge.opened
        .filter(row => !study.modelDirectedKnowledge || knowledge.phaseOpened?.includes(knowledgeRefKey(row.ref)))
        .map(row => {
            const record = knowledgeOpenPresentation(knowledge, row);
            return pages ? {ref: row.ref, record: pages.value(record, 240)} : record;
        }) : knowledge?.opened;
    const hasResearchSummary = pages && study.phase === 'research' && study.responses.some(r => r.action === 'continue' && r.scientificSummary);
    const catalogue = study.availableSources?.map((source, i) => ({selection:i+1, artifactId:source.artifactId, outcome:source.outcome}));
    const input = {
        report: pages ? pages.report(study.report, hasResearchSummary ? 360 : pages.passageSize) : study.report,
        ...(study.phase === 'review'
            ? {candidate: pages ? pages.value(candidate) : candidate}
            : {research: pages ? pages.history(study.responses) : study.responses.map(scientificResponse),
                sourceCatalogue: pages ? pages.value(catalogue, 1600) : catalogue}),
        knownTheories: layered ? [] : pages ? pages.value(request.knownTheories) : request.knownTheories,
        readResults: pages ? pages.value(readResults?.map(row => pages.value(row, 1200)), 6000) : readResults,
        ...(knowledge ? {knowledge: {
            ...(knowledge.readNotice ? {readNotice:knowledge.readNotice} : {}),
            libraryRevision:knowledge.libraryRevision, theoryRevision:knowledge.theoryRevision,
            selection:layered ? knowledgeSelectionPresentation(knowledge.selection) : knowledge.selection,
            opened:pages ? pages.value(opened, 1800) : opened,
            proposedBindings:pages ? pages.value(knowledge.bindings) : knowledge.bindings,
            familyChange:pages ? pages.value(knowledge.family) : knowledge.family
        }, ...(study.archiveReview ? {} : {upstreamTheoryStandard:upstreamTheoryGuidance})} : {})
    };
    context.messages.push({role:'user',timestamp:Date.now(),content:JSON.stringify(input)});
    if (pages) context.systemPrompt += '\nContext previews are navigation. Read the relevant exact pages before judging an inference. Use nextOffset for the next passage. A page with no nextOffset is complete. Request any deferred pages separately. Continue the inquiry once sufficient evidence is available. A working summary carries no independent evidentiary authority.';
    const lastReply=pages ? study.responses.findLast(r=>r.action!=='read-context-page') : study.responses.at(-1);
    if(study.phase==='review' && lastReply?.action==='skip-unavailable')
        context.messages.push({role:'user',timestamp:Date.now(),content:JSON.stringify({previousReviewText:pages ? pages.value(lastReply.body) : lastReply.body})});
    if(study.toolFeedback)context.systemPrompt += '\n'+study.toolFeedback;
    if(study.modelDirectedKnowledge)context.systemPrompt += '\nChoose the comparisons yourself. Search for equivalent names and open plausible matches before proposing an entry. Ground each claim in the public argument. State its local assumptions and show the intermediate deductions. Derive a missing result locally when possible. Justify the role and hypotheses of any distant result. If an independent premise is missing, state the conditional result. Ask the user before changing a material premise.';
    if(study.domainAdmission && study.report.outcome==='supported-result' && !study.archiveReview)
        context.systemPrompt += '\nCheck any premise on which the original reported conclusion depends. If neither the givens, accepted foundations, applicable established knowledge nor the supplied derivation supports it, use report_archive_gap. Identify the affected conclusion and preserve independently supported parts. You may finish without proposing an upstream theory.';
    if(study.archiveReview)context.messages.push({role:'user',timestamp:Date.now(),content:JSON.stringify({archivedClaim:study.archiveReview.claim,disputedInference:study.archiveReview.inference,objection:study.archiveReview.body,previousCondition:study.archiveReview.previousCondition,previousReview:study.archiveReview.previousReview})});
    if(study.refutationEvidence)context.systemPrompt += '\nRead reviewed observations as empirical evidence. Check the observable, experimental conditions, source and uncertainty. State which prediction or parameter range the comparison excludes. Distinguish disagreement with an experiment from a contradiction under mathematical premises.';
    if (study.map) {
        context.systemPrompt += '\n' + MAP_THEORY_GUIDANCE + (layered ? ' Use index cards to find entries. Open the statement and check its conditions before applying it. Reuse established results directly. Request detail="proof" only when asked or when inspecting a specific gap. Use definitions for their stated meanings. Distinguish accepted premises from proved results. Justify pending or source-only claims or state them as explicit conditions.' : '');
        const knowledgeMap = layered ? mapContextPresentation({ ...study.map, readResults: undefined }) : study.map;
        const projected = pages ? {...knowledgeMap, opened:pages.value(knowledgeMap.opened.map(read=>({selection:read.selection, title:read.title, record:pages.value(read,240)})), 1800)} : knowledgeMap;
        context.messages.push({ role: 'user', timestamp: Date.now(), content: JSON.stringify({knowledgeMap:projected}) });

    }
    if (pages && !request.nativeHandoff?.state?.original) pages.fit(context,contextPageProgress(study));
    try {
        const reply = await completeNativeHandoff(request, context, input => models.completeSimple(model, input, { env: {}, signal, maxRetries: 0, ...(pages && model.contextWindow > 0 && model.maxTokens > 0 ? {maxTokens:Math.min(model.maxTokens,Math.max(1,model.contextWindow-Math.ceil(Buffer.byteLength(JSON.stringify(input))/2.4)-256))} : {}), reasoning: request.model.thinkingLevel === 'off' ? undefined : request.model.thinkingLevel ?? 'medium' }), signal, !study.scientificMapWrites?undefined:(call,raw)=>{
            const {mapChanges,placement,body}=call.arguments as unknown as ResearchReplyV45;
            const opened=study.map?.opened??[];
            const format=scientificMapFormatIssue(mapChanges);if(format)return format.metadata;
            if(mapChanges&&!Value.Check(scientificMapChangesSchema,mapChanges))return [];
            if(placement?.kind==='nearby'&&!opened.some(r=>r.ref&&r.selection===placement.anchor))return [{path:['placement','anchor'],message:'Use the exact opened theory placement anchor. Available records: '+opened.map(r=>r.selection+' '+r.title).join(', ')}];
            return mapChanges?mapMetadataIssues(mapChanges,opened,typeof body==='string'?publicNativeBody(raw,body,native):undefined):[];
        });
        const decode = ():ResearchReplyV45 => {
            const calls = reply.content.filter(p => p.type === 'toolCall');
            if(reply.toolFeedback&&!calls.length)return {action:'skip-unavailable',body:reply.content.filter(p=>p.type==='text').map(p=>p.text).join('\n')};
            if (!calls.length) {
                const text = reply.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
                if (!text.trim())
                    throw new RuntimeError('INVALID_OUTPUT');
                return { action: 'finish', body: text };
            }
            for (const item of calls) {
                const tool = tools.find(t => t.name === item.name);
                if (!tool || !Value.Check(tool.parameters, item.arguments))
                    throw new RuntimeError('INVALID_OUTPUT');
            }
            if (calls.length === 2 && study.phase === 'research' && study.map && calls[0].name === 'save_public_knowledge' && calls[1].name === 'request_review') {
                const saved = calls[0], requested = calls[1], first = saved.arguments as {body:string}, second = requested.arguments as {body:string;kind:'finding'|'theory'};
                if (!saved.id?.trim() || !requested.id?.trim() || saved.id === requested.id || first.body !== second.body)
                    throw new RuntimeError('TOOL_PROTOCOL_FAILED');
                if(study.scientificMapWrites&&saved.arguments.mapChanges&&requested.arguments.mapChanges&&JSON.stringify(saved.arguments.mapChanges)!==JSON.stringify(requested.arguments.mapChanges))throw new RuntimeError('TOOL_PROTOCOL_FAILED');
                if (native)
                    return { action: 'review', ...((saved.arguments.mapChanges??requested.arguments.mapChanges)?{mapChanges:(saved.arguments.mapChanges??requested.arguments.mapChanges) as ResearchReplyV45['mapChanges']}:{}),body: publicNativeBody(reply, second.body, true), kind: second.kind };
                return { action: 'save-and-review', body: first.body, kind: second.kind, nativeCallIds: [saved.id, requested.id] };
            }
            if (calls.every(call=>call.name==='read_context_page'))
                return {action:'read-context-page',body:'Requested context pages',contextPages:calls.map(call=>call.arguments as {ref:string;offset:number})};
            if (calls.length > 1 && !calls.every(c => ['lookup_map_knowledge', 'open_map_knowledge', 'refresh_knowledge_map'].includes(c.name))) {
                const names:Record<string,ResearchReplyV45['action']> = { lookup_map_knowledge: 'lookup-map', open_map_knowledge: 'open-map', refresh_knowledge_map: 'refresh-map', query_knowledge: 'query-knowledge', open_knowledge: 'open-knowledge', read_research_source: 'read', read_context_page: 'read-context-page' };
                if (calls.some(c => !names[c.name]))
                    throw new RuntimeError('TOOL_PROTOCOL_FAILED');
                return { action: 'read-batch', body: 'Native read batch', readBatchId: request.callId, readCalls: calls.map(c => ({ toolCallId: c.id, request: { action: names[c.name], body: 'Native read requested', ...(c.name === 'read_context_page' ? {contextPages:[c.arguments as {ref:string;offset:number}]} : c.name === 'lookup_map_knowledge' ? { mapQuery: c.arguments } : c.name==='query_knowledge'&&study.modelDirectedKnowledge?{routeQuery:c.arguments as unknown as ResearchReplyV45['routeQuery']}:c.name === 'open_map_knowledge' ? { mapSelection: c.arguments.selection, detail: c.arguments.detail } : c.arguments) } })) };
            }
            if (calls.length > 1) {
                return { action: 'read-map-batch', body: 'Native map read batch', readBatchId: request.callId, reads: calls.map(c => ({ toolCallId: c.id, action: c.name === 'lookup_map_knowledge' ? 'lookup' : c.name === 'open_map_knowledge' ? 'open' : 'refresh', ...(c.name === 'lookup_map_knowledge' ? { query: c.arguments } : c.name === 'open_map_knowledge' ? c.arguments : {}) })) };
            }
            const call = calls[0];
            if(call.name==='report_archive_gap')return {action:'archive-objection',body:String(call.arguments.body),objection:call.arguments as unknown as ReportObjection};
            if(call.name==='resolve_archive_objection')return {action:'archive-decision',body:String(call.arguments.body),decision:call.arguments as unknown as ReportDecision};
            if (call.name === 'lookup_map_knowledge')
                return { action: 'lookup-map', body: 'Map lookup requested', mapQuery: call.arguments as unknown as NonNullable<ResearchReplyV45['mapQuery']> };
            if (call.name === 'open_map_knowledge')
                return { action: 'open-map', body: 'Exact map read requested', mapSelection: call.arguments.selection as string, detail: call.arguments.detail as 'proof'|undefined };
            if (call.name === 'refresh_knowledge_map')
                return { action: 'refresh-map', body: 'Map refresh requested' };
            if (call.name === 'save_public_knowledge')
                return { action: 'save-map-result', ...(call.arguments.mapChanges?{mapChanges:call.arguments.mapChanges as ResearchReplyV45['mapChanges']}:{}),body: publicNativeBody(reply, call.arguments.body as string, native) };
            if(call.name==='query_knowledge'&&study.modelDirectedKnowledge)return {action:'query-knowledge',body:'Requested route page',routeQuery:call.arguments as unknown as ResearchReplyV45['routeQuery']};
            if (['query_knowledge', 'open_knowledge', 'explain_with_theory', 'relate_existing_theory', 'revise_research'].includes(call.name)) {
                const args = call.arguments as unknown as Omit<ResearchReplyV45,'action'>;
                return { action: call.name === 'query_knowledge' ? 'query-knowledge' : call.name === 'open_knowledge' ? 'open-knowledge' : call.name === 'explain_with_theory' ? 'bind-knowledge' : call.name === 'relate_existing_theory' ? 'relate-theory' : 'revise', ...args, body: publicNativeBody(reply, args.body ?? 'Knowledge read requested', native && ['explain_with_theory', 'relate_existing_theory', 'revise_research'].includes(call.name)) };
            }
            if (call.name === 'read_research_source')
                return { action: 'read', body: 'Public source read requested', selection: call.arguments.selection as number };
            const args = call.arguments as unknown as Omit<ResearchReplyV45,'action'>;
            return { action: call.name === 'request_review' ? 'review' : call.name === 'continue_research' ? 'continue' : call.name === 'publish_research' ? 'publish' : 'finish', ...args, body: publicNativeBody(reply, args.body, native) };
        };
        return {...decode(),...(reply.toolFeedback?{toolFeedback:reply.toolFeedback}:{}),...(reply.maintenanceReferral?{maintenanceReferral:true}:{})};
    }
    catch (error) {
        throw publicRuntimeError(error);
    }
}
