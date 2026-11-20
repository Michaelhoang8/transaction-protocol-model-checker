import type { Config } from './model.ts';
export const scenarios: Config[] = [
  { name: 'correct-2p', participants: 2, variant: 'correct', lossBudget: 0, duplicateBudget: 0, crashBudget: 0, maxStates: 100000 },
  { name: 'correct-2p-faults', participants: 2, variant: 'correct', lossBudget: 1, duplicateBudget: 1, crashBudget: 1, maxStates: 100000 },
  { name: 'correct-3p', participants: 3, variant: 'correct', lossBudget: 0, duplicateBudget: 0, crashBudget: 0, maxStates: 100000 },
  { name: 'partial-vote-commit', participants: 2, variant: 'partial-vote-commit', lossBudget: 0, duplicateBudget: 0, crashBudget: 0, maxStates: 100000 },
  { name: 'prepared-timeout-abort', participants: 2, variant: 'prepared-timeout-abort', lossBudget: 0, duplicateBudget: 0, crashBudget: 0, maxStates: 100000 },
];
