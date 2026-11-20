import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { platform, arch } from 'node:os';
import { explore, replay } from '../src/checker.ts';
import type { Trace } from '../src/checker.ts';
import { scenarios } from '../src/scenarios.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: npm run check -- [--output results-local]\nCompletes all five finite searches and writes replayable evidence.');
  process.exit(0);
}
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--output' || !args[1])) {
  console.error('Usage: npm run check -- [--output results-local]'); process.exit(2);
}
const output = resolve(root, args[1] ?? 'results');
mkdirSync(join(output, 'traces'), { recursive: true });
const writeJson = (name: string, value: unknown) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n');
const results = scenarios.map(explore);
const traceFiles: Array<{ file: string; label: string; scenario: string; depth: number }> = [];
for (const result of results) {
  for (const [label, trace] of Object.entries(result.witnesses)) {
    replay(trace);
    const name = `${result.config.name}-${label}`;
    writeJson(`traces/${name}.json`, trace);
    const lines = trace.steps.map((step, index) => `${String(index).padStart(2, '0')} ${step.action}\n   coordinator=${step.state.coordinatorUp ? 'up' : 'down'}/${step.state.coordinatorDecision} observed=${step.state.observedVotes.join('')} durable votes=${step.state.participantVotes.join('')} decisions=${step.state.participantDecisions.join('')}\n   messages: ${step.state.messages.join(', ') || '(none)'}`);
    writeFileSync(join(output, 'traces', `${name}.txt`), `${result.config.name}: ${label}\nShortest BFS witness: ${trace.depth} actions\n\n${lines.join('\n')}\n`);
    traceFiles.push({ file: `traces/${name}.json`, label, scenario: result.config.name, depth: trace.depth });
  }
}
writeJson('searches.json', results);
writeJson('trace-index.json', traceFiles);
const columns = ['scenario', 'status', 'participants', 'lossBudget', 'duplicateBudget', 'crashBudget', 'statesDiscovered', 'statesExpanded', 'transitionsChecked', 'frontierRemaining', 'maxFrontier', 'maxDepth', 'maxMessages', 'derivedMessageBound', 'terminalStates', 'elapsedMs', 'atomicAgreementStates', 'commitValidityStates', 'durableMonotonicityEdges'];
const rows = results.map(result => [result.config.name, result.status, result.config.participants, result.config.lossBudget,
  result.config.duplicateBudget, result.config.crashBudget, result.statesDiscovered, result.statesExpanded, result.transitionsChecked,
  result.frontierRemaining, result.maxFrontier, result.maxDepth, result.maxMessages, result.derivedMessageBound, result.terminalStates,
  result.elapsedMs, result.violationCounts['atomic-agreement'], result.violationCounts['commit-validity'], result.violationCounts['durable-monotonicity']]);
writeFileSync(join(output, 'counts.csv'), columns.join(',') + '\n' + rows.map(row => row.join(',')).join('\n') + '\n');
const sources = ['src/model.ts', 'src/invariants.ts', 'src/checker.ts', 'src/scenarios.ts', 'scripts/check.ts'];
writeJson('environment.json', { measuredAt: new Date().toISOString(), node: process.version, platform: platform(), architecture: arch(),
  clock: 'performance.now', sourceHashEncoding: 'UTF-8, CRLF normalized to LF',
  sourceSha256: Object.fromEntries(sources.map(name => [name, createHash('sha256').update(readFileSync(join(root, name), 'utf8').replace(/\r\n/g, '\n')).digest('hex')])),
  provenance: 'AI-assisted finite-state portfolio study. Synthetic protocol model; actual BFS execution, no deployed cluster or TLA+/TLC run.' });
for (const result of results) console.log(`${result.config.name}: ${result.status}; ${result.statesDiscovered} states; ${result.transitionsChecked} edges; ${result.elapsedMs.toFixed(2)} ms`);
const incomplete = results.some(result => result.status !== 'complete');
const unsafeCorrect = results.some(result => result.config.variant === 'correct' && Object.values(result.violationCounts).some(count => count > 0));
const missingMutationWitness = results.some(result => result.config.variant !== 'correct' && !result.witnesses['atomic-agreement']);
if (incomplete || unsafeCorrect || missingMutationWitness) process.exitCode = 1;
