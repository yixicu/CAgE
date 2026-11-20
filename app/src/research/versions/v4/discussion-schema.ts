import {Type,type Static} from 'typebox';

const text = Type.String();
const userInput = Type.Object({id:text,kind:text,text}, {additionalProperties:false});
const assessment = Type.Object({
 id:text,revision:Type.Integer(),status:text,claim:text,inference:text,body:text,
 opposingArtifactId:Type.Optional(text),condition:Type.Optional(text),review:Type.Optional(text),previousCondition:Type.Optional(text),previousReview:Type.Optional(text),
}, {additionalProperties:false});
const report = Type.Object({
 artifactId:text,body:text,bodyHash:text,outcome:text,scope:text,conditions:Type.Array(text),qualification:text,
 archiveValid:Type.Optional(Type.Boolean()),assessment:Type.Optional(assessment),
}, {additionalProperties:false});
const turn = Type.Object({
 epochId:text,rootId:text,question:text,userInputs:Type.Array(userInput),report:Type.Optional(report),
}, {additionalProperties:false});

export const legacyDiscussion = Type.Object({
 revision:Type.Literal('public-discussion-v1'),turns:Type.Array(turn),userInputs:Type.Array(userInput),
}, {additionalProperties:false});
const compactReport=Type.Object({
 artifactId:text,bodyHash:text,outcome:text,scope:text,conditions:Type.Array(text),qualification:text,
 conclusion:text,route:text,gaps:Type.Array(text),proofOutline:Type.Optional(text),
 archiveValid:Type.Optional(Type.Boolean()),assessment:Type.Optional(assessment),
},{additionalProperties:false});
const compactTurn=Type.Object({epochId:text,rootId:text,question:text,userInputs:Type.Array(userInput),report:Type.Optional(compactReport)},{additionalProperties:false});
const compactDiscussion=Type.Object({revision:Type.Literal('public-discussion-v2'),turns:Type.Array(compactTurn),userInputs:Type.Array(userInput)},{additionalProperties:false});
export const DiscussionSchemaV4=Type.Union([legacyDiscussion,compactDiscussion]);
export type DiscussionV4=Static<typeof DiscussionSchemaV4>;
export type CompactDiscussion=Static<typeof compactDiscussion>;
export const DiscussionUpdatesSchema=Type.Array(Type.Object({
 artifactId:text,archiveValid:Type.Optional(Type.Boolean()),assessment:Type.Optional(assessment),
},{additionalProperties:false}));
export type DiscussionUpdates=Static<typeof DiscussionUpdatesSchema>;

