import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildLoginUrl, createPkce, findDesktopToken, LoginCancelled, loginWithBrowser } from '../src/main/auth';
import { fakeFetch } from './helpers';

test('PKCE challenge is the unpadded base64url SHA-256 of a 128-hex-char verifier', () => {
  const { verifier, challenge } = createPkce();
  assert.match(verifier, /^[0-9a-f]{128}$/);
  const expected = createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal(challenge, expected);
});

test('login URL matches what Streamlabs Desktop opens', () => {
  assert.equal(
    buildLoginUrl(5123, 'abc'),
    'https://streamlabs.com/slobs/login?skip_splash=true&external=electron&tiktok&force_verify&origin=slobs&port=5123&code_challenge=abc&code_flow=true',
  );
});

/** Plays the browser: follows Streamlabs' redirect to the local callback server. */
function redirectTo(query: string, before?: string) {
  let page = '';
  let status = 0;
  const openUrl = async (url: string) => {
    const port = new URL(url).searchParams.get('port');
    if (before) await fetch(`http://127.0.0.1:${port}${before}`);
    const res = await fetch(`http://127.0.0.1:${port}/${query}`);
    status = res.status;
    page = await res.text();
  };
  return { openUrl, result: () => ({ page, status }) };
}

test('browser login exchanges the callback code with the verifier for a token', async () => {
  let challenge = '';
  const { fetchImpl, requests } = fakeFetch(() => ({ body: { success: true, data: { oauth_token: 'tok-xyz' } } }));
  const browser = redirectTo('?success=true&code=the-code', '/favicon.ico');
  const token = await loginWithBrowser({
    fetchImpl,
    openUrl: (url) => {
      challenge = new URL(url).searchParams.get('code_challenge')!;
      return browser.openUrl(url);
    },
  });

  assert.equal(token, 'tok-xyz');
  assert.equal(browser.result().status, 200);
  assert.match(browser.result().page, /You’re signed in/);
  const exchange = new URL(requests[0].url);
  assert.equal(exchange.origin + exchange.pathname, 'https://streamlabs.com/api/v5/slobs/auth/data');
  assert.equal(exchange.searchParams.get('code'), 'the-code');
  const verifier = exchange.searchParams.get('code_verifier')!;
  assert.equal(createHash('sha256').update(verifier).digest('base64url'), challenge);
});

test('browser login fails when Streamlabs redirects without success', async () => {
  const { fetchImpl, requests } = fakeFetch(() => ({ body: {} }));
  const browser = redirectTo('?success=false');
  await assert.rejects(loginWithBrowser({ fetchImpl, openUrl: browser.openUrl }), /did not complete the sign-in/);
  assert.equal(browser.result().status, 400);
  assert.equal(requests.length, 0);
});

test('browser login fails when the exchange returns no token', async () => {
  const { fetchImpl } = fakeFetch(() => ({ body: { success: false } }));
  const browser = redirectTo('?success=true&code=c');
  await assert.rejects(loginWithBrowser({ fetchImpl, openUrl: browser.openUrl }), /did not return a sign-in token/);
});

test('browser login can be cancelled and times out', async () => {
  const controller = new AbortController();
  const cancelled = loginWithBrowser({ signal: controller.signal, openUrl: () => controller.abort() });
  await assert.rejects(cancelled, LoginCancelled);

  await assert.rejects(loginWithBrowser({ timeoutMs: 20, openUrl: () => {} }), /Timed out/);
});

test('findDesktopToken reads the newest leveldb log and its last token', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'slobs-'));
  const older = join(dir, '000001.log');
  const newer = join(dir, '000002.log');
  writeFileSync(older, '{"apiToken":"aaaa1111"}');
  // Streamlabs' leveldb logs interleave NUL bytes; the match has to survive them.
  writeFileSync(newer, Buffer.from('x"apiToken":"bbbb2222"y\0"api\0Token":"cccc3333"\0z'));
  writeFileSync(join(dir, 'CURRENT'), '"apiToken":"ffff0000"');
  utimesSync(older, new Date(1000), new Date(1000));
  utimesSync(newer, new Date(2000), new Date(2000));

  assert.equal(await findDesktopToken(dir), 'cccc3333');
});

test('findDesktopToken returns null when Streamlabs Desktop is not installed', async () => {
  assert.equal(await findDesktopToken(join(tmpdir(), 'definitely-not-here-xyz')), null);
});
