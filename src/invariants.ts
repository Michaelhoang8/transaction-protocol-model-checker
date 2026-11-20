import type { State } from './model.ts';
export type Violation = 'atomic-agreement' | 'commit-validity' | 'durable-monotonicity';

// These predicates inspect snapshots and edges only; they do not use the model's
// enabling conditions or transition helpers to decide what should be permitted.
export function stateViolations(state: State): Violation[] {
  const violations: Violation[] = [];
  if (state.participantDecisions.includes('C') && state.participantDecisions.includes('A')) violations.push('atomic-agreement');
  if ((state.coordinatorDecision === 'C' || state.participantDecisions.includes('C'))
      && state.participantVotes.some(vote => vote !== 'Y')) violations.push('commit-validity');
  return violations;
}

export function transitionViolations(before: State, after: State): Violation[] {
  const changedDecision = before.coordinatorDecision !== '_' && before.coordinatorDecision !== after.coordinatorDecision;
  const changedParticipant = before.participantDecisions.some((decision, p) => decision !== '_' && decision !== after.participantDecisions[p]);
  const changedVote = before.participantVotes.some((vote, p) => vote !== '_' && vote !== after.participantVotes[p]);
  return changedDecision || changedParticipant || changedVote ? ['durable-monotonicity'] : [];
}

export function blockedWhileCoordinatorUnavailable(state: State): boolean {
  return !state.coordinatorUp && state.coordinatorDecision === '_'
    && state.participantVotes.every(vote => vote === 'Y')
    && state.participantDecisions.every(decision => decision === '_')
    && !state.messages.some(message => message.startsWith('decision-'));
}
