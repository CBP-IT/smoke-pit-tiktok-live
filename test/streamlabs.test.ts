import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OTHER_CATEGORY, STREAMLABS_USER_AGENT, StreamlabsClient, StreamlabsError } from '../src/main/streamlabs';
import { fakeFetch } from './helpers';

test('getAccount maps the info response and sends the desktop app headers', async () => {
  const { fetchImpl, requests } = fakeFetch(() => ({
    body: { user: { username: 'smokepit' }, application_status: { status: 'approved' }, can_be_live: true },
  }));
  const account = await new StreamlabsClient('tok123', fetchImpl).getAccount();

  assert.deepEqual(account, { username: 'smokepit', applicationStatus: 'approved', canBeLive: true });
  assert.equal(requests[0].url, 'https://streamlabs.com/api/v5/slobs/tiktok/info');
  const headers = requests[0].init.headers as Record<string, string>;
  assert.equal(headers.authorization, 'Bearer tok123');
  assert.equal(headers['user-agent'], STREAMLABS_USER_AGENT);
});

test('getAccount treats a missing can_be_live as not allowed', async () => {
  const { fetchImpl } = fakeFetch(() => ({ body: {} }));
  const account = await new StreamlabsClient('t', fetchImpl).getAccount();
  assert.deepEqual(account, { username: 'Unknown', applicationStatus: 'Unknown', canBeLive: false });
});

test('searchCategories truncates to 25 characters, encodes, and appends Other', async () => {
  const { fetchImpl, requests } = fakeFetch(() => ({
    body: { categories: [{ full_name: 'News & Politics', game_mask_id: 'm1' }, { bogus: true }] },
  }));
  const found = await new StreamlabsClient('t', fetchImpl).searchCategories(' News & Politics and a very long tail ');

  assert.deepEqual(found, [{ name: 'News & Politics', maskId: 'm1' }, OTHER_CATEGORY]);
  const q = new URL(requests[0].url).searchParams.get('category');
  assert.equal(q, 'News & Politics and a ver');
});

test('searchCategories skips the request for an empty query', async () => {
  const { fetchImpl, requests } = fakeFetch(() => ({ body: {} }));
  assert.deepEqual(await new StreamlabsClient('t', fetchImpl).searchCategories('  '), [OTHER_CATEGORY]);
  assert.equal(requests.length, 0);
});

test('resolveCategory picks the exact match or falls back to Other', async () => {
  const { fetchImpl } = fakeFetch(() => ({
    body: { categories: [{ full_name: 'Talk Shows', game_mask_id: 'ts' }, { full_name: 'Talk', game_mask_id: 'tk' }] },
  }));
  const client = new StreamlabsClient('t', fetchImpl);
  assert.equal(await client.resolveCategory('Talk'), 'tk');
  assert.equal(await client.resolveCategory('Cooking'), '');
});

test('start posts the same multipart fields as Streamlabs Desktop', async () => {
  const { fetchImpl, requests } = fakeFetch(() => ({ body: { id: 42, rtmp: 'rtmp://push/live', key: 'sk-1' } }));
  const started = await new StreamlabsClient('t', fetchImpl).start('The Smoke Pit', 'm1', true);

  assert.deepEqual(started, { id: '42', rtmpUrl: 'rtmp://push/live', streamKey: 'sk-1' });
  assert.equal(requests[0].url, 'https://streamlabs.com/api/v5/slobs/tiktok/stream/start');
  assert.equal(requests[0].init.method, 'POST');
  const form = requests[0].init.body as FormData;
  assert.deepEqual(Object.fromEntries(form.entries()), {
    title: 'The Smoke Pit',
    device_platform: 'win32',
    category: 'm1',
    audience_type: '1',
  });
});

test('start surfaces Streamlabs’ message when no key comes back', async () => {
  const { fetchImpl } = fakeFetch(() => ({ body: { success: false, message: 'Account is not eligible' } }));
  await assert.rejects(new StreamlabsClient('t', fetchImpl).start('x', '', false), /Account is not eligible/);
});

test('a 401 is reported as an auth failure', async () => {
  const { fetchImpl } = fakeFetch(() => ({ status: 401, body: '<html>nope</html>' }));
  const err = await new StreamlabsClient('t', fetchImpl).getAccount().catch((e) => e);
  assert.ok(err instanceof StreamlabsError);
  assert.equal(err.isAuthFailure, true);
  assert.match(err.message, /sign-in has expired/);
});

test('a 500 is an ordinary error with the status in the message', async () => {
  const { fetchImpl } = fakeFetch(() => ({ status: 500, body: 'oops' }));
  const err = await new StreamlabsClient('t', fetchImpl).getAccount().catch((e) => e);
  assert.equal(err.isAuthFailure, false);
  assert.match(err.message, /HTTP 500/);
});

test('network failures become a readable error', async () => {
  const client = new StreamlabsClient('t', async () => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(client.getAccount(), /Could not reach Streamlabs: fetch failed/);
});

test('end posts to the stream and requires success', async () => {
  const ok = fakeFetch(() => ({ body: { success: true } }));
  await new StreamlabsClient('t', ok.fetchImpl).end('42');
  assert.equal(ok.requests[0].url, 'https://streamlabs.com/api/v5/slobs/tiktok/stream/42/end');
  assert.equal(ok.requests[0].init.method, 'POST');

  const bad = fakeFetch(() => ({ body: { success: false } }));
  await assert.rejects(new StreamlabsClient('t', bad.fetchImpl).end('42'), /did not confirm/);
});
