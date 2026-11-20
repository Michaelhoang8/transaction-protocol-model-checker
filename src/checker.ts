import { initial, successors, key, messageBound, validateConfig } from './model.ts';
import type { State, Config } from './model.ts';
import { stateViolations, transitionViolations, blockedWhileCoordinatorUnavailable } from './invariants.ts';
import type { Violation } from './invariants.ts';
import { performance } from 'node:perf_hooks';

export type Trace = { label: string; config: Config; depth: number; steps: Array<{ action: string; state: State }> };
export type SearchResult = {
  config: Config;
  status: 'complete' | 'incomplete-state-limit';
  statesDiscovered: number;
  statesExpanded: number;
  transitionsChecked: number;
  frontierRemaining: number;
  maxFrontier: number;
  maxDepth: number;
  maxMessages: number;
  derivedMessageBound: number;
  terminalStates: number;
  elapsedMs: number;
  violationCounts: Record<Violation, number>;
  violationCountUnits: Record<Violation, string>;
  witnesses: Partial<Record<Violation | 'coordinator-unavailable', Trace>>;
  depthCounts: Record<string, number>;
};

export function explore(config: Config): SearchResult {
  validateConfig(config);
  const start = performance.now();
  const states = [initial(config)];
  const parents = [-1];
  const actions = ['initial'];
  const depths = [0];
  const seen = new Map([[key(states[0]), 0]]);
  let head = 0;
  let transitions = 0;
  let maxFrontier = 1;
  let maxDepth = 0;
  let maxMessages = 0;
  let terminals = 0;
  let incomplete = false;
  const counts: Record<Violation, number> = { 'atomic-agreement': 0, 'commit-validity': 0, 'durable-monotonicity': 0 };
  const witnesses: SearchResult['witnesses'] = {};
  const depthCounts: Record<string, number> = { '0': 1 };
  const path = (index: number, label: string): Trace => {
    const steps: Trace['steps'] = [];
    for (let cursor = index; cursor >= 0; cursor = parents[cursor]) steps.push({ action: actions[cursor], state: states[cursor] });
    steps.reverse();
    return { label, config, depth: steps.length - 1, steps };
  };
  outer: while (head < states.length) {
    const index = head;
    const state = states[index];
    const edges = successors(state, config);
    if (edges.length === 0) terminals += 1;
    for (const edge of edges) {
      transitions += 1;
      const signature = key(edge.state);
      const known = seen.get(signature);
      for (const violation of transitionViolations(state, edge.state)) {
        counts[violation] += 1;
        if (!witnesses[violation]) {
          const trace = path(index, violation);
          trace.steps.push(edge); trace.depth += 1;
          witnesses[violation] = trace;
        }
      }
      if (known !== undefined) continue;
      if (states.length >= config.maxStates) { incomplete = true; break outer; }
      const child = states.length;
      states.push(edge.state); parents.push(index); actions.push(edge.action); depths.push(depths[index] + 1);
      seen.set(signature, child);
      maxMessages = Math.max(maxMessages, edge.state.messages.length);
      maxDepth = Math.max(maxDepth, depths[child]);
      depthCounts[String(depths[child])] = (depthCounts[String(depths[child])] ?? 0) + 1;
      maxFrontier = Math.max(maxFrontier, states.length - head);
      for (const violation of stateViolations(edge.state)) {
        counts[violation] += 1;
        if (!witnesses[violation]) witnesses[violation] = path(child, violation);
      }
      if (!witnesses['coordinator-unavailable'] && blockedWhileCoordinatorUnavailable(edge.state)) {
        witnesses['coordinator-unavailable'] = path(child, 'coordinator-unavailable');
      }
    }
    head += 1;
  }
  return { config, status: incomplete ? 'incomplete-state-limit' : 'complete', statesDiscovered: states.length,
    statesExpanded: head, transitionsChecked: transitions, frontierRemaining: states.length - head,
    maxFrontier, maxDepth, maxMessages, derivedMessageBound: messageBound(config), terminalStates: terminals,
    elapsedMs: performance.now() - start, violationCounts: counts,
    violationCountUnits: { 'atomic-agreement': 'unique discovered states', 'commit-validity': 'unique discovered states',
      'durable-monotonicity': 'traversed transition edges' }, witnesses, depthCounts };
}

export function replay(trace: Trace): void {
  validateConfig(trace.config);
  if (!trace.steps.length || trace.steps[0].action !== 'initial' || key(trace.steps[0].state) !== key(initial(trace.config))) {
    throw new Error('Trace must start from the exact initial state');
  }
  for (let index = 1; index < trace.steps.length; index += 1) {
    const step = trace.steps[index];
    const edges = successors(trace.steps[index - 1].state, trace.config);
    if (!edges.some(edge => edge.action === step.action && key(edge.state) === key(step.state))) {
      throw new Error(`Trace step ${index} is not a legal model transition`);
    }
  }
  if (trace.depth !== trace.steps.length - 1) throw new Error('Trace depth mismatch');
  const last = trace.steps.at(-1)!.state;
  const valid = trace.label === 'coordinator-unavailable' ? blockedWhileCoordinatorUnavailable(last)
    : trace.label === 'durable-monotonicity' ? transitionViolations(trace.steps.at(-2)!.state, last).includes('durable-monotonicity')
      : stateViolations(last).includes(trace.label as Violation);
  if (!valid) throw new Error('Trace does not end in its claimed condition');
}
