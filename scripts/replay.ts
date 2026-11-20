import { readFileSync } from 'node:fs';
import { replay } from '../src/checker.ts';
import type { Trace } from '../src/checker.ts';
const args = process.argv.slice(2);
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log('Usage: npm run replay -- <trace.json>\nChecks the initial state, every action/state transition and the claimed final condition.');
} else if (args.length !== 1) {
  console.error('Usage: npm run replay -- <trace.json>'); process.exitCode = 2;
} else {
  try {
    const trace = JSON.parse(readFileSync(args[0], 'utf8')) as Trace;
    replay(trace);
    console.log(`Validated ${trace.depth} legal actions: ${trace.config.name} / ${trace.label}`);
  } catch (error) {
    console.error(`Replay failed: ${error instanceof Error ? error.message : 'unknown error'}`); process.exitCode = 2;
  }
}
