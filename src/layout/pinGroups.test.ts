import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPin } from './pinGroups';
import type { Port } from '../parser/types';

const ports: Port[] = [
  { name: 'AVD_0V8', dir: 'I' },
  { name: 'AVS', dir: 'I' },
  { name: 'LOAD', dir: 'O' },
  { name: 'D', dir: 'B' },
];

test('a power/ground net puts the pin on the supply/ground band', () => {
  assert.equal(classifyPin('D', 'power', ports), 'supply');
  assert.equal(classifyPin('D', 'ground', ports), 'ground');
});

test('a supply-named pin lands on the supply band even on a signal net (e.g. AVRH rail)', () => {
  // XI17.AVD_0V8 wires to net AVRH (typed signal) — the pin role still governs.
  assert.equal(classifyPin('AVD_0V8', 'signal', ports), 'supply');
  assert.equal(classifyPin('AVS', 'signal', ports), 'ground');
});

test('plain signal pins fall to input/output by direction', () => {
  assert.equal(classifyPin('LOAD', 'signal', ports), 'output');
  assert.equal(classifyPin('VCO_IN', 'signal', ports), 'input');
  // over-match guard: a signal pin starting with "v" is not a supply
  assert.equal(classifyPin('vdata', 'signal', ports), 'input');
});
