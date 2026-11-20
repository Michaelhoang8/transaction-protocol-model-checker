export type Vote = '_' | 'Y' | 'N';
export type Decision = '_' | 'C' | 'A';
export type Variant = 'correct' | 'partial-vote-commit' | 'prepared-timeout-abort';
export type Config = {
  name: string;
  participants: 2 | 3;
  variant: Variant;
  lossBudget: number;
  duplicateBudget: number;
  crashBudget: 0 | 1;
  maxStates: number;
};
export type State = {
  started: boolean;
  coordinatorUp: boolean;
  coordinatorDecision: Decision;
  decisionBroadcast: boolean;
  observedVotes: Vote[];
  participantVotes: Vote[];
  participantDecisions: Decision[];
  messages: string[];
  losses: number;
  duplicates: number;
  crashes: number;
};
export type Transition = { action: string; state: State };

export function validateConfig(config: Config): void {
  if (!['correct', 'partial-vote-commit', 'prepared-timeout-abort'].includes(config.variant)
      || ![2, 3].includes(config.participants) || ![0, 1].includes(config.crashBudget)
      || !Number.isSafeInteger(config.lossBudget) || config.lossBudget < 0
      || !Number.isSafeInteger(config.duplicateBudget) || config.duplicateBudget < 0
      || !Number.isSafeInteger(config.maxStates) || config.maxStates < 1) throw new Error('Invalid model configuration');
}

export function initial(config: Config): State {
  return { started: false, coordinatorUp: true, coordinatorDecision: '_', decisionBroadcast: false,
    observedVotes: Array<Vote>(config.participants).fill('_'), participantVotes: Array<Vote>(config.participants).fill('_'),
    participantDecisions: Array<Decision>(config.participants).fill('_'), messages: [], losses: 0, duplicates: 0, crashes: 0 };
}

export function canonical(state: State): State {
  return { ...state, messages: [...state.messages].sort() };
}

export function key(state: State): string {
  // Participant identities are preserved; only the unordered network bag is sorted.
  return JSON.stringify([state.started, state.coordinatorUp, state.coordinatorDecision, state.decisionBroadcast,
    state.observedVotes.join(''), state.participantVotes.join(''), state.participantDecisions.join(''),
    [...state.messages].sort(), state.losses, state.duplicates, state.crashes]);
}

export function messageBound(config: Config): number {
  // With at most one crash: initial prepare + recovery resend + decision broadcast,
  // or initial prepare + first decision broadcast + recovery decision broadcast.
  return config.participants * (config.crashBudget === 1 ? 3 : 2) + config.duplicateBudget;
}

function copy(state: State): State {
  return { ...state, observedVotes: [...state.observedVotes], participantVotes: [...state.participantVotes],
    participantDecisions: [...state.participantDecisions], messages: [...state.messages] };
}

export function successors(state: State, config: Config): Transition[] {
  const result: Transition[] = [];
  const add = (action: string, edit: (next: State) => void) => {
    const next = copy(state);
    edit(next);
    if (next.messages.length > messageBound(config)) throw new Error('Derived message bound violated');
    result.push({ action, state: canonical(next) });
  };
  const broadcast = (next: State, prefix: string) => {
    for (let p = 0; p < config.participants; p += 1) next.messages.push(`${prefix}:${p}`);
  };
  if (state.coordinatorUp && !state.started) add('coordinator.start', next => { next.started = true; broadcast(next, 'prepare'); });
  if (state.coordinatorUp && state.started && state.coordinatorDecision === '_') {
    const yes = state.observedVotes.filter(vote => vote === 'Y').length;
    if (yes === config.participants || config.variant === 'partial-vote-commit' && yes > 0) {
      add('coordinator.persist-commit', next => { next.coordinatorDecision = 'C'; });
    }
    if (state.observedVotes.includes('N')) add('coordinator.persist-abort', next => { next.coordinatorDecision = 'A'; });
  }
  if (state.coordinatorUp && state.coordinatorDecision !== '_' && !state.decisionBroadcast) {
    add(`coordinator.broadcast-${state.coordinatorDecision}`, next => {
      next.decisionBroadcast = true;
      broadcast(next, `decision-${state.coordinatorDecision}`);
    });
  }
  if (state.coordinatorUp && state.crashes < config.crashBudget) add('coordinator.crash', next => {
    next.coordinatorUp = false; next.observedVotes.fill('_'); next.decisionBroadcast = false; next.crashes += 1;
  });
  if (!state.coordinatorUp) add('coordinator.recover', next => {
    next.coordinatorUp = true;
    if (next.started && next.coordinatorDecision === '_') broadcast(next, 'prepare');
    // A durable decision is resent by the normal broadcast transition.
  });

  // Identical bag occurrences are indistinguishable. Delivering any copy leads to
  // the same state, so each unique message kind contributes one delivery action.
  for (const message of new Set(state.messages)) {
    const [kind, rawParticipant] = message.split(':');
    const p = Number(rawParticipant);
    const consume = (next: State) => { next.messages.splice(next.messages.indexOf(message), 1); };
    if (kind === 'prepare') {
      const choices: Vote[] = state.participantVotes[p] !== '_' ? [state.participantVotes[p]]
        : state.participantDecisions[p] === 'A' ? ['N'] : ['Y', 'N'];
      for (const vote of choices) add(`deliver.${message}.vote-${vote}`, next => {
        consume(next);
        next.participantVotes[p] = vote;
        if (vote === 'N') next.participantDecisions[p] = 'A';
        next.messages.push(`vote-${vote}:${p}`);
      });
    } else if (kind === 'vote-Y' || kind === 'vote-N') {
      if (state.coordinatorUp) add(`deliver.${message}`, next => {
        consume(next);
        next.observedVotes[p] = kind === 'vote-Y' ? 'Y' : 'N';
      });
    } else if (kind === 'decision-C' || kind === 'decision-A') {
      add(`deliver.${message}`, next => {
        consume(next);
        // A participant's durable final decision cannot be overwritten. In the
        // timeout mutant this preserves its incorrect earlier autonomous abort.
        if (next.participantDecisions[p] === '_' && (kind === 'decision-A' || next.participantVotes[p] === 'Y')) {
          next.participantDecisions[p] = kind === 'decision-C' ? 'C' : 'A';
        }
      });
    } else throw new Error(`Unknown model message: ${message}`);
    if (state.losses < config.lossBudget) add(`network.drop.${message}`, next => { consume(next); next.losses += 1; });
    if (state.duplicates < config.duplicateBudget) add(`network.duplicate.${message}`, next => { next.messages.push(message); next.duplicates += 1; });
  }
  if (config.variant === 'prepared-timeout-abort') {
    for (let p = 0; p < config.participants; p += 1) {
      if (state.participantVotes[p] === 'Y' && state.participantDecisions[p] === '_') {
        add(`participant.${p}.timeout-abort`, next => { next.participantDecisions[p] = 'A'; });
      }
    }
  }
  return result;
}
