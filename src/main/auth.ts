// Getting a Streamlabs token, ported from TokenRetriever.py and the "Load from PC"
// path of Loukious/StreamLabsTikTokStreamKeyGenerator.
//
// Browser sign-in uses the same PKCE flow as Streamlabs Desktop: Streamlabs'
// login page redirects to a one-shot server on 127.0.0.1 with a code, which is
// swapped for the token.

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, win32 } from 'node:path';
import { STREAMLABS_USER_AGENT, StreamlabsError, type FetchLike } from './streamlabs';

const TOKEN_EXCHANGE_URL = 'https://streamlabs.com/api/v5/slobs/auth/data';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function createPkce(): Pkce {
  const verifier = randomBytes(64).toString('hex');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function buildLoginUrl(port: number, challenge: string): string {
  return (
    'https://streamlabs.com/slobs/login?skip_splash=true&external=electron&tiktok&force_verify' +
    `&origin=slobs&port=${port}&code_challenge=${challenge}&code_flow=true`
  );
}

export class LoginCancelled extends Error {
  constructor() {
    super('Sign-in was cancelled.');
    this.name = 'LoginCancelled';
  }
}

export interface BrowserLoginOptions {
  openUrl: (url: string) => Promise<void> | void;
  signal?: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

/** Opens Streamlabs' TikTok login in the browser and resolves with the Streamlabs token. */
export async function loginWithBrowser(opts: BrowserLoginOptions): Promise<string> {
  const pkce = createPkce();
  const { server, port, code } = await startCallbackServer(opts.signal, opts.timeoutMs ?? LOGIN_TIMEOUT_MS);
  try {
    await opts.openUrl(buildLoginUrl(port, pkce.challenge));
    return await exchangeCode(await code, pkce.verifier, opts.fetchImpl ?? fetch);
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

async function startCallbackServer(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<{ server: Server; port: number; code: Promise<string> }> {
  let settle!: { resolve: (code: string) => void; reject: (err: Error) => void };
  const code = new Promise<string>((resolve, reject) => (settle = { resolve, reject }));
  // Rejections are observed by the caller; this keeps an early abort from going unhandled.
  code.catch(() => {});

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/favicon.ico') {
      res.writeHead(404).end();
      return;
    }
    const params = url.searchParams;
    const authCode = params.get('code');
    const ok = params.get('success') === 'true' && !!authCode;
    res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    res.end(callbackPage(ok));
    if (ok) settle.resolve(authCode!);
    else settle.reject(new Error('Streamlabs did not complete the sign-in. Please try again.'));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const timer = setTimeout(
    () => settle.reject(new Error('Timed out waiting for you to finish signing in.')),
    timeoutMs,
  );
  const onAbort = () => settle.reject(new LoginCancelled());
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  code.finally(() => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }).catch(() => {});

  return { server, port: (server.address() as AddressInfo).port, code };
}

export async function exchangeCode(code: string, verifier: string, fetchImpl: FetchLike): Promise<string> {
  const url = `${TOKEN_EXCHANGE_URL}?${new URLSearchParams({ code_verifier: verifier, code })}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { 'user-agent': STREAMLABS_USER_AGENT, accept: '*/*' } });
  } catch (err) {
    throw new StreamlabsError(`Could not reach Streamlabs: ${(err as Error).message}`);
  }
  const body: any = await response.json().catch(() => null);
  const token = body?.data?.oauth_token;
  if (!response.ok || body?.success !== true || typeof token !== 'string' || !token) {
    throw new StreamlabsError('Streamlabs did not return a sign-in token. Please try again.', response.status);
  }
  return token;
}

/** Where Streamlabs Desktop keeps its local storage, or null on a platform it doesn't run on. */
export function defaultDesktopStorageDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string | null {
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'slobs-client', 'Local Storage', 'leveldb');
  }
  if (platform === 'win32') {
    const appData = env.APPDATA || win32.join(home, 'AppData', 'Roaming');
    return win32.join(appData, 'slobs-client', 'Local Storage', 'leveldb');
  }
  return null;
}

/**
 * Reads the token Streamlabs Desktop saved when the user signed in there with
 * TikTok. Returns null when Streamlabs Desktop isn't installed or signed in.
 */
export async function findDesktopToken(dir = defaultDesktopStorageDir()): Promise<string | null> {
  if (!dir) return null;
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.log'));
  } catch {
    return null;
  }
  const files = await Promise.all(
    names.map(async (n) => {
      const path = join(dir, n);
      return { path, mtime: (await stat(path)).mtimeMs };
    }),
  );
  files.sort((a, b) => b.mtime - a.mtime);

  const pattern = /"apiToken":"([a-f0-9]+)"/gi;
  for (const { path } of files) {
    const content = (await readFile(path)).toString('utf8').replace(/\0/g, '');
    const matches = [...content.matchAll(pattern)];
    if (matches.length) return matches[matches.length - 1][1];
  }
  return null;
}

function callbackPage(ok: boolean): string {
  const heading = ok ? 'You’re signed in' : 'Sign-in didn’t finish';
  const detail = ok
    ? 'Close this tab and go back to CRAYON EATER MEDIA LIVE.'
    : 'Go back to CRAYON EATER MEDIA LIVE and try again.';
  return `<!doctype html><meta charset="utf-8"><title>CRAYON EATER MEDIA · LIVE</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1f3c;color:#ede8dc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;text-align:center">
<div><p style="letter-spacing:.14em;color:#c1121f;font-size:12px;font-family:system-ui,sans-serif;font-weight:600">CRAYON EATER MEDIA · LIVE</p>
<h1 style="font-weight:600">${heading}</h1><p style="color:rgba(237,232,220,.7)">${detail}</p></div></body>`;
}
