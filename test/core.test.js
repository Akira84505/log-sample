import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LogSampler, DEFAULTS } from '../src/index.js';

test('default head and tail sizes match DEFAULTS', () => {
  const s = new LogSampler();
  assert.equal(s.headSize, DEFAULTS.head);
  assert.equal(s.tailSize, DEFAULTS.tail);
});

test('add accumulates lines into head until it is full', () => {
  const s = new LogSampler({ head: 3, tail: 0, marker: '' });
  s.add('a');
  s.add('b');
  s.add('c');
  assert.deepEqual(s.head, ['a', 'b', 'c']);
  assert.deepEqual(s.tail, []);
  assert.equal(s.omitted, 0);
  assert.equal(s.totalSeen, 3);
});

test('lines beyond head but within tailSize land in tail', () => {
  const s = new LogSampler({ head: 1, tail: 2, marker: '' });
  s.add('first');
  s.add('second');
  s.add('third');
  assert.deepEqual(s.head, ['first']);
  assert.deepEqual(s.tail, ['second', 'third']);
  assert.equal(s.omitted, 0);
});

test('tail retains only the last tailSize entries and counts overflow as omitted', () => {
  const s = new LogSampler({ head: 1, tail: 2, marker: '' });
  s.add('first');   // head
  s.add('second');  // tail[0]
  s.add('third');   // tail[1]
  s.add('fourth');  // tail overflows -> second dropped, omitted = 1
  s.add('fifth');   // tail overflows -> third dropped, omitted = 2
  assert.deepEqual(s.head, ['first']);
  assert.deepEqual(s.tail, ['fourth', 'fifth']);
  assert.equal(s.omitted, 2);
  assert.equal(s.totalSeen, 5);
});

test('toLines inserts marker between head and tail when lines were omitted', () => {
  const s = new LogSampler({
    head: 2, tail: 2, marker: '--- omitted ---',
  });
  s.addMany(['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(s.toLines(), ['1', '2', '--- omitted ---', '5', '6']);
});

test('toLines omits the marker when nothing was dropped', () => {
  const s = new LogSampler({ head: 5, tail: 5, marker: '--- omitted ---' });
  s.addMany(['1', '2', '3']);
  assert.deepEqual(s.toLines(), ['1', '2', '3']);
});

test('toLines omits the marker when marker is an empty string, even with omissions', () => {
  const s = new LogSampler({ head: 1, tail: 1, marker: '' });
  s.addMany(['keep', 'drop1', 'drop2', 'keep2']);
  assert.deepEqual(s.toLines(), ['keep', 'keep2']);
});

test('markerIf suppresses the marker for small gaps', () => {
  const s = new LogSampler({
    head: 1, tail: 1, marker: '--- gap ---', markerIf: 3,
  });
  s.addMany(['h', 'mid1', 'mid2', 't']); // omitted = 2, below threshold
  assert.deepEqual(s.toLines(), ['h', 't']);

  const s2 = new LogSampler({
    head: 1, tail: 1, marker: '--- gap ---', markerIf: 3,
  });
  s2.addMany(['h', 'm1', 'm2', 'm3', 't']); // omitted = 3, at threshold
  assert.deepEqual(s2.toLines(), ['h', '--- gap ---', 't']);
});

test('head and tail overlap exactly when total lines equal head + tail', () => {
  // 3 lines, head=2 tail=2: no gap, head has [1,2], tail has [1,2] but since
  // total(3) < head(2)+tail(2), nothing overflows. head=[1,2], tail=[3].
  const s = new LogSampler({ head: 2, tail: 2, marker: '--- gap ---' });
  s.addMany(['1', '2', '3']);
  assert.deepEqual(s.head, ['1', '2']);
  assert.deepEqual(s.tail, ['3']);
  assert.equal(s.omitted, 0);
  assert.deepEqual(s.toLines(), ['1', '2', '3']);
});

test('zero head and zero tail records only the omission count', () => {
  const s = new LogSampler({ head: 0, tail: 0, marker: '...' });
  s.addMany(['a', 'b', 'c']);
  assert.deepEqual(s.head, []);
  assert.deepEqual(s.tail, []);
  assert.equal(s.omitted, 3);
  assert.deepEqual(s.toLines(), ['...']);
});

test('zero head with non-zero tail keeps only the last N lines', () => {
  const s = new LogSampler({ head: 0, tail: 2, marker: '' });
  s.addMany(['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(s.head, []);
  assert.deepEqual(s.tail, ['d', 'e']);
  assert.equal(s.omitted, 3);
});

test('toString joins with newline and has no trailing newline', () => {
  const s = new LogSampler({ head: 2, tail: 1, marker: '...' });
  s.addMany(['one', 'two', 'three', 'four', 'five']);
  assert.equal(s.toString(), 'one\ntwo\n...\nfive');
});

test('empty sampler produces empty toLines and empty toString', () => {
  const s = new LogSampler();
  assert.deepEqual(s.toLines(), []);
  assert.equal(s.toString(), '');
});

test('add throws on non-string input', () => {
  const s = new LogSampler();
  assert.throws(() => s.add(123), TypeError);
  assert.throws(() => s.add(null), TypeError);
});

test('addMany throws on non-iterable input', () => {
  const s = new LogSampler();
  assert.throws(() => s.addMany(42), TypeError);
  assert.throws(() => s.addMany(null), TypeError);
});

test('invalid option values fall back to defaults rather than coercing', () => {
  const s = new LogSampler({
    head: 'big', tail: -1, marker: 99, markerIf: 'never',
  });
  assert.equal(s.headSize, DEFAULTS.head);
  assert.equal(s.tailSize, DEFAULTS.tail);
  // marker normalised to the default string because 99 is not a string
  s.addMany(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
             'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u']);
  const out = s.toLines();
  assert.ok(out.includes(DEFAULTS.marker),
    'default marker text should appear when lines are omitted');
});

test('reset clears retained lines and omission count but keeps options', () => {
  const s = new LogSampler({ head: 1, tail: 1, marker: '...' });
  s.addMany(['h', 'mid', 't']);
  assert.equal(s.totalSeen, 3);
  s.reset();
  assert.deepEqual(s.head, []);
  assert.deepEqual(s.tail, []);
  assert.equal(s.omitted, 0);
  assert.equal(s.totalSeen, 0);
  assert.equal(s.headSize, 1);
  assert.equal(s.tailSize, 1);
});

test('addMany accepts any iterable, including a generator', () => {
  function* gen() { yield 'x'; yield 'y'; yield 'z'; }
  const s = new LogSampler({ head: 1, tail: 1, marker: '' });
  s.addMany(gen());
  assert.deepEqual(s.head, ['x']);
  assert.deepEqual(s.tail, ['z']);
  assert.equal(s.omitted, 1);
});

test('head and tail getters return copies, not internal references', () => {
  const s = new LogSampler({ head: 2, tail: 2, marker: '' });
  s.addMany(['1', '2', '3']);
  const h = s.head;
  const t = s.tail;
  h.push('MUTATED');
  t.push('MUTATED');
  assert.deepEqual(s.head, ['1', '2']);
  assert.deepEqual(s.tail, ['3']);
});
