import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchCurrentShow, PORTAL_URL } from '../src/main/portal';
import { fakeFetch } from './helpers';

test('reads the show from the portal’s live-title endpoint', async () => {
  const { fetchImpl, requests } = fakeFetch(() => ({
    body: { show: { title: '  Saturday Roundup ', plannedAt: '2026-10-24T23:00:00.000Z' } },
  }));
  assert.deepEqual(await fetchCurrentShow(fetchImpl), {
    title: 'Saturday Roundup',
    plannedAt: '2026-10-24T23:00:00.000Z',
  });
  assert.equal(requests[0].url, `${PORTAL_URL}/api/live-title`);
});

test('no show, or a malformed one, is null', async () => {
  for (const body of [{ show: null }, {}, { show: { title: '' } }, { show: { title: 42 } }, 'not json']) {
    const { fetchImpl } = fakeFetch(() => ({ body }));
    assert.equal(await fetchCurrentShow(fetchImpl), null, JSON.stringify(body));
  }
});

test('portal errors and network failures are reported', async () => {
  const { fetchImpl } = fakeFetch(() => ({ status: 500, body: { error: 'x' } }));
  await assert.rejects(fetchCurrentShow(fetchImpl), /HTTP 500/);
  await assert.rejects(
    fetchCurrentShow(async () => {
      throw new TypeError('fetch failed');
    }),
    /Could not reach the Smoke Pit portal: fetch failed/,
  );
});
