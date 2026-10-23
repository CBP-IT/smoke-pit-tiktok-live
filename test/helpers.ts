import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FetchLike } from '../src/main/streamlabs';
import type { Cipher } from '../src/main/store';

export interface RecordedRequest {
  url: string;
  init: RequestInit;
}

/** A fetch stand-in that answers from `respond` and records every request. */
export function fakeFetch(respond: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (url, init = {}) => {
    requests.push({ url, init });
    const { status = 200, body } = respond(url, init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { fetchImpl, requests };
}

/** Reversible stand-in for safeStorage that visibly isn't plaintext. */
export const fakeCipher: Cipher = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(`enc:${[...plain].reverse().join('')}`),
  decrypt: (buf) => [...buf.toString().slice(4)].reverse().join(''),
};

export const noCipher: Cipher = {
  isAvailable: () => false,
  encrypt: () => {
    throw new Error('unavailable');
  },
  decrypt: () => {
    throw new Error('unavailable');
  },
};

export function tempFile(name = 'settings.json'): string {
  return join(mkdtempSync(join(tmpdir(), 'sp-tiktok-')), name);
}
