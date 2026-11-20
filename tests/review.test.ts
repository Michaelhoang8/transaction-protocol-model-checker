import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explore } from '../src/checker.ts';
import { initial, successors } from '../src/model.ts';
import type { Config, State } from '../src/model.ts';

const config: Config = {
  name: 'independent-review', participants: 2, variant: 'partial-vote-commit',
  lossBudget: 0, duplicateBudget: 0, crashBudget: 0, maxStates: 10000,
};

test('shallow unpruned execution-tree search agrees with shortest bad-commit depth', () => {
  // This oracle enumerates all paths by depth, including repeated states. It
  // does not use the BFS checker, canonical state keys or invariant helpers.
  let layer: State[] = [initial(config)];
  let firstBadDepth: number | undefined;
  for (let depth = 0; depth <= 4; depth += 1) {
    if (layer.some(state => state.coordinatorDecision === 'C'
      && state.participantVotes.some(vote => vote !== 'Y'))) {
      firstBadDepth = depth;
      break;
    }
    layer = layer.flatMap(state => successors(state, config).map(edge => edge.state));
  }
  assert.equal(firstBadDepth, 4);
  const result = explore(config);
  assert.equal(result.status, 'complete');
  assert.equal(result.witnesses['commit-validity']?.depth, firstBadDepth);
});

test('a one-state cap reports incomplete exploration rather than a safety result', () => {
  const result = explore({ ...config, variant: 'correct', maxStates: 1 });
  assert.equal(result.status, 'incomplete-state-limit');
  assert.equal(result.statesDiscovered, 1);
  assert.equal(result.statesExpanded, 0);
  assert.equal(result.frontierRemaining, 1);
});

test('coordinator crash and recovery preserve durable votes and decisions', () => {
  const settings: Config = { ...config, variant: 'correct', crashBudget: 1 };
  const state: State = {
    ...initial(settings), started: true, coordinatorDecision: 'C',
    decisionBroadcast: true, observedVotes: ['Y', 'Y'], participantVotes: ['Y', 'Y'],
    participantDecisions: ['C', '_'], messages: ['decision-C:1'],
  };
  const before = JSON.stringify(state);
  const crashed = successors(state, settings).find(edge => edge.action === 'coordinator.crash')!.state;
  assert.equal(JSON.stringify(state), before, 'Transition generator mutated its input');
  assert.equal(crashed.coordinatorDecision, 'C');
  assert.deepEqual(crashed.participantVotes, ['Y', 'Y']);
  assert.deepEqual(crashed.participantDecisions, ['C', '_']);
  assert.deepEqual(crashed.observedVotes, ['_', '_']);
  const recovered = successors(crashed, settings).find(edge => edge.action === 'coordinator.recover')!.state;
  const broadcast = successors(recovered, settings).find(edge => edge.action === 'coordinator.broadcast-C')!.state;
  assert.deepEqual(broadcast.participantVotes, ['Y', 'Y']);
  assert.deepEqual(broadcast.participantDecisions, ['C', '_']);
  assert.equal(broadcast.messages.filter(message => message === 'decision-C:1').length, 2);
  assert.equal(broadcast.messages.filter(message => message === 'decision-C:0').length, 1);
});

test('unknown runtime variant strings are rejected', () => {
  assert.throws(() => explore({ ...config, variant: 'typo' as Config['variant'] }));
});
