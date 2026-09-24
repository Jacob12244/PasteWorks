/**
 * ProcessPro's engine off the main thread: a closed crushing circuit and a
 * closed grinding circuit take tens of milliseconds to converge, which is
 * enough to stutter a slider drag if the page waited for it.
 */
import { summarise } from './summary';
import type { Contract, Design } from './circuit';

interface Request {
  id: number;
  contract: Contract;
  design: Design;
}

const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg);

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, contract, design } = e.data;
  try {
    post({ id, summary: summarise(contract, design) });
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
