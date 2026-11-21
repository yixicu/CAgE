import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewDeliveredProof } from '../dist/presentation/proof-questionnaire.js';

function theorem(id, title, statement) {
  return {
    selection: 'map_' + id, title, body: statement,
    ref: { store: 'map', id, version: 1, bodyHash: id },
    kind: 'theorem', qualification: 'pending', assumptions: [],
    accepted: false, supports: [], sources: [],
  };
}

const parity = theorem('parity', 'Even square', 'The square of an even integer is even.');
const unused = theorem('unused', 'Unused lemma', 'The sum of two odd integers is even.');
const derivation = [
  '## Derivation',
  'Write the arbitrary even integer as n = 2k for an integer k.',
  'Squaring gives n² = 4k² = 2(2k²). Since 2k² is an integer, n² is even.',
  'Applying [[Even square]] now proves that this particular square is even.',
];

async function run(lines, nodes, replies, declared = nodes.map(n => n.selection)) {
  const calls = [];
  const result = await reviewDeliveredProof(lines.join('\n'), nodes, declared,
    async (instruction, fragment) => {
      const index = calls.length;
      assert.ok(index < replies.length, 'Unexpected additional provider request');
      calls.push({ instruction, fragment });
      return replies[index];
    }, async node => node.qualification === 'pending');
  return { ...result, calls };
}

test('a mixed questionnaire retries only the duplicated formula response', async () => {
  const formula = String.raw`$\sqqrt{x}$`;
  const replacement = String.raw`$\sqrt{x}$`;
  const lines = [...derivation, 'Only the typesetting needs repair here: ' + formula + '.'];
  const result = await run(lines, [parity, unused], [
    'Q3: NONE\nQ1: SKIP\nQ2: PROVED 4 2-3\nQ1: ' + replacement,
    'Q1: ' + replacement,
  ]);
  assert.equal(result.calls.length, 2);
  const [first, retry] = result.calls.map(c => c.fragment);
  assert.match(first, /Q1:[\s\S]*Q2:[\s\S]*Q3:/);
  assert.match(retry, /Q1:/);
  assert.ok(retry.includes(formula));
  assert.doesNotMatch(retry, /Q2:|Q3:|arbitrary even integer|particular square/);
  assert.deepEqual(result.notes.formulas.map(f => f.replacement), [replacement]);
  assert.equal(result.confirmations.length, 1);
  const [confirmed] = result.confirmations;
  assert.equal(confirmed.selection, parity.selection);
  assert.equal(confirmed.useLine, 3);
  assert.equal(confirmed.excerpt, derivation.slice(1, 3).join('\n'));
  assert.deepEqual(confirmed.prerequisites, []);
});

test('a missing citation and its approval are answered in one item', async () => {
  const lines = [...derivation.slice(0, 3), 'This result about even squares now applies to the integer in the question.'];
  const result = await run(lines, [parity], ['Q1: PROVED 4 2-3']);
  assert.equal(result.calls.length, 1);
  assert.equal(result.notes.locations[0].line, 3);
  assert.equal(result.confirmations[0].useLine, 3);
});

test('a display calculation can prove a theorem whose inline use occurs later', async () => {
  const lines = [
    'Write n = 2k for an arbitrary even integer n.',
    '$$', String.raw`n^2=(2k)^2=4k^2=2(2k^2),\qquad 2k^2\in\mathbb{Z}`, '$$',
    'Applying [[Even square]] to the integer in the question now establishes the result.',
  ];
  const result = await run(lines, [parity], ['Q1: PROVED 5 2-4']);
  assert.equal(result.confirmations[0].excerpt, lines.slice(1, 4).join('\n'));
});

for (const heading of ['## References', '~~~tex']) {
  test('a displayed calculation under ' + heading + ' cannot be submitted as proof evidence', async () => {
    const lines = [
      'Applying [[Even square]] to the integer in the question gives the result.',
      heading, '$$', 'n^2=(2k)^2=4k^2=2(2k^2)', '$$',
      ...(heading.startsWith('~') ? ['~~~'] : []),
    ];
    const result = await run(lines, [parity], ['Q1: PROVED 1 3-5', 'Q1: PROVED 1 3-5']);
    assert.deepEqual(result.confirmations, []);
  });
}

for (const sentence of ['By [[Even square]], this follows.', 'We assume [[Even square]].', '由 [[Even square]] 可得结论。']) {
  test('a bare invocation cannot be filed as its own proof: ' + sentence, async () => {
    const result = await run(['## Proof', sentence], [parity],
      ['Q1: PROVED 2 2-2', 'Q1: PROVED 2 2-2']);
    assert.deepEqual(result.confirmations, []);
  });
}

test('plain use and narrower examples leave the node pending', async () => {
  const result = await run(['For n = 2, we get n² = 4, illustrating [[Even square]].'], [parity], ['Q1: USE 1']);
  assert.deepEqual(result.confirmations, []);
  assert.equal(result.calls.length, 1);
});

test('an out-of-range span and then a false use location cannot approve', async () => {
  const result = await run(derivation, [parity], ['Q1: PROVED 4 2-999', 'Q1: PROVED 1 2-3']);
  assert.equal(result.calls.length, 2);
  assert.deepEqual(result.confirmations, []);
});

for (const heading of ['References', 'Knowledge map references', '引用的知识节点']) {
  test('a bibliography line alone cannot confirm a theorem under ' + heading, async () => {
    const lines = [...derivation.slice(0, 3), '## ' + heading, '- [[Even square]] — preliminary source consulted for context.'];
    const result = await run(lines, [parity], ['Q1: PROVED 5 2-3', 'Q1: PROVED 5 2-3']);
    assert.deepEqual(result.confirmations, []);
    assert.deepEqual(result.notes.locations, []);
  });
}

test('transport interruption ends the optional questionnaire immediately', async () => {
  const result = await run(derivation, [parity], [undefined]);
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.confirmations, []);
});
