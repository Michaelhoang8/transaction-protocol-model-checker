import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initial, key, successors, messageBound } from '../src/model.ts';
import type { Config, State } from '../src/model.ts';
import { explore, replay } from '../src/checker.ts';
import { stateViolations, transitionViolations, blockedWhileCoordinatorUnavailable } from '../src/invariants.ts';
import { scenarios } from '../src/scenarios.ts';
const baseline = scenarios[0];
const faults = scenarios[1];
const step = (state: State, action: string, config = baseline): State => {
  const found = successors(state, config).find(edge => edge.action === action);
  assert.ok(found, `Missing action ${action}`);
  return found.state;
};

test('canonical key ignores message order while preserving multiplicity and participant identity', () => {
  const state = initial(baseline);
  state.messages = ['prepare:1', 'prepare:0'];
  const reversed = { ...state, messages: [...state.messages].reverse() };
  assert.equal(key(state), key(reversed));
  assert.notEqual(key(state), key({ ...state, messages: ['prepare:0', 'prepare:0', 'prepare:1'] }));
  assert.notEqual(key({ ...state, participantVotes: ['Y', 'N'] }), key({ ...state, participantVotes: ['N', 'Y'] }));
});

test('delayed PREPARE after a received abort cannot create a new YES vote', () => {
  let state = step(initial(baseline), 'coordinator.start');
  state = step(state, 'deliver.prepare:0.vote-N');
  state = step(state, 'deliver.vote-N:0');
  state = step(state, 'coordinator.persist-abort');
  state = step(state, 'coordinator.broadcast-A');
  state = step(state, 'deliver.decision-A:1');
  assert.equal(state.participantVotes[1], '_');
  assert.equal(state.participantDecisions[1], 'A');
  const choices = successors(state, baseline).filter(edge => edge.action.startsWith('deliver.prepare:1'));
  assert.deepEqual(choices.map(edge => edge.action), ['deliver.prepare:1.vote-N']);
});

test('correct coordinator cannot commit after just one YES', () => {
  let state = step(initial(baseline), 'coordinator.start');
  state = step(state, 'deliver.prepare:0.vote-Y');
  state = step(state, 'deliver.vote-Y:0');
  assert.ok(!successors(state, baseline).some(edge => edge.action === 'coordinator.persist-commit'));
  state = step(state, 'deliver.prepare:1.vote-Y');
  state = step(state, 'deliver.vote-Y:1');
  assert.ok(successors(state, baseline).some(edge => edge.action === 'coordinator.persist-commit'));
});

test('NO is durable and aborts the participant before its vote is delivered', () => {
  let state = step(initial(baseline), 'coordinator.start');
  state = step(state, 'deliver.prepare:0.vote-N');
  assert.equal(state.participantVotes[0], 'N');
  assert.equal(state.participantDecisions[0], 'A');
  assert.equal(state.observedVotes[0], '_');
  state = step(state, 'deliver.vote-N:0');
  state = step(state, 'coordinator.persist-abort');
  assert.equal(state.coordinatorDecision, 'A');
});

test('fault-free correct model exhausts both YES/NO choices and all delivery orders', () => {
  const result = explore(baseline);
  assert.equal(result.status, 'complete');
  assert.ok(result.statesDiscovered > 50);
  assert.equal(result.statesExpanded, result.statesDiscovered);
  assert.equal(result.frontierRemaining, 0);
  assert.equal(result.terminalStates, 4);
  assert.deepEqual(result.violationCounts, { 'atomic-agreement': 0, 'commit-validity': 0, 'durable-monotonicity': 0 });
});

test('bounded transport faults and coordinator recovery complete without safety violations', () => {
  const result = explore(faults);
  assert.equal(result.status, 'complete');
  assert.equal(result.statesExpanded, result.statesDiscovered);
  assert.equal(result.frontierRemaining, 0);
  assert.ok(result.maxMessages <= messageBound(faults));
  assert.deepEqual(result.violationCounts, { 'atomic-agreement': 0, 'commit-validity': 0, 'durable-monotonicity': 0 });
  replay(result.witnesses['coordinator-unavailable']!);
});

test('partial-vote mutant shortest validity witness is four actions; agreement needs seven', () => {
  const result = explore(scenarios[3]);
  assert.equal(result.status, 'complete');
  assert.equal(result.witnesses['commit-validity']!.depth, 4);
  assert.equal(result.witnesses['atomic-agreement']!.depth, 7);
  for (const trace of Object.values(result.witnesses)) replay(trace);
  assert.equal(result.violationCounts['durable-monotonicity'], 0);
});

test('prepared timeout mutant shortest disagreement needs nine actions', () => {
  const result = explore(scenarios[4]);
  assert.equal(result.status, 'complete');
  const trace = result.witnesses['atomic-agreement']!;
  assert.equal(trace.depth, 9);
  assert.ok(trace.steps.some(row => row.action.endsWith('timeout-abort')));
  replay(trace);
  assert.equal(result.violationCounts['commit-validity'], 0);
  assert.equal(result.violationCounts['durable-monotonicity'], 0);
});

test('blocked witness is conditional on coordinator unavailability, with recovery still enabled', () => {
  const trace = explore(faults).witnesses['coordinator-unavailable']!;
  assert.equal(trace.depth, 4);
  const last = trace.steps.at(-1)!.state;
  assert.ok(blockedWhileCoordinatorUnavailable(last));
  const choices = successors(last, faults);
  assert.ok(choices.some(edge => edge.action === 'coordinator.recover'));
  for (const edge of choices.filter(edge => edge.action !== 'coordinator.recover')) {
    assert.deepEqual(edge.state.participantDecisions, ['_', '_']);
  }
});

test('crash erases volatile vote cache but preserves durable decision and votes', () => {
  let state = step(initial(faults), 'coordinator.start', faults);
  for (const p of [0, 1]) {
    state = step(state, `deliver.prepare:${p}.vote-Y`, faults);
    state = step(state, `deliver.vote-Y:${p}`, faults);
  }
  state = step(state, 'coordinator.persist-commit', faults);
  state = step(state, 'coordinator.crash', faults);
  assert.deepEqual(state.observedVotes, ['_', '_']);
  assert.deepEqual(state.participantVotes, ['Y', 'Y']);
  assert.equal(state.coordinatorDecision, 'C');
  state = step(state, 'coordinator.recover', faults);
  assert.ok(successors(state, faults).some(edge => edge.action === 'coordinator.broadcast-C'));
});

test('duplicate delivery resends an existing durable vote and cannot choose a new vote', () => {
  let state = step(initial(faults), 'coordinator.start', faults);
  state = step(state, 'network.duplicate.prepare:0', faults);
  state = step(state, 'deliver.prepare:0.vote-Y', faults);
  const choices = successors(state, faults).filter(edge => edge.action.startsWith('deliver.prepare:0'));
  assert.deepEqual(choices.map(edge => edge.action), ['deliver.prepare:0.vote-Y']);
  assert.ok(!successors(state, faults).some(edge => edge.action.startsWith('network.duplicate')));
});

test('independent invariants reject deliberately inconsistent snapshots and durable transitions', () => {
  const before = initial(baseline);
  before.participantVotes = ['Y', 'N'];
  before.participantDecisions = ['C', 'A'];
  assert.deepEqual(stateViolations(before), ['atomic-agreement', 'commit-validity']);
  const after = structuredClone(before);
  after.participantDecisions[0] = 'A';
  assert.deepEqual(transitionViolations(before, after), ['durable-monotonicity']);
  before.coordinatorDecision = 'C';
  after.coordinatorDecision = '_';
  assert.deepEqual(transitionViolations(before, after), ['durable-monotonicity']);
});

test('trace replay rejects tampered action and state evidence', () => {
  const trace = explore(scenarios[3]).witnesses['commit-validity']!;
  const badAction = structuredClone(trace);
  badAction.steps[1].action = 'fabricated-action';
  assert.throws(() => replay(badAction), /not a legal/);
  const badState = structuredClone(trace);
  badState.steps[2].state.participantVotes[1] = 'Y';
  assert.throws(() => replay(badState), /not a legal/);
});

test('state limit reports incomplete exploration and retains pending frontier', () => {
  const result = explore({ ...baseline, maxStates: 2 });
  assert.equal(result.status, 'incomplete-state-limit');
  assert.ok(result.frontierRemaining > 0);
  assert.ok(result.statesExpanded < result.statesDiscovered);
});

test('three participant fault-free model finishes and retains the safety properties', () => {
  const result = explore(scenarios[2]);
  assert.equal(result.status, 'complete');
  assert.equal(result.terminalStates, 8);
  assert.deepEqual(result.violationCounts, { 'atomic-agreement': 0, 'commit-validity': 0, 'durable-monotonicity': 0 });
});
