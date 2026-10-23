import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LoginCancelled } from '../src/main/auth';
import { Controller } from '../src/main/controller';
import { Store } from '../src/main/store';
import { StreamlabsClient } from '../src/main/streamlabs';
import type { ShowInfo } from '../src/shared/types';
import { fakeCipher, fakeFetch, tempFile } from './helpers';

const settings = { title: '  The Smoke Pit  ', categoryName: 'News', categoryMaskId: '', mature: false };

function setup(
  respond: Parameters<typeof fakeFetch>[0],
  opts: { token?: string | null; show?: () => Promise<ShowInfo | null> } = {},
) {
  const store = new Store(tempFile(), fakeCipher);
  if (opts.token !== null) store.setToken(opts.token ?? 'tok');
  const { fetchImpl, requests } = fakeFetch(respond);
  const controller = new Controller({
    store,
    version: '0.1.0',
    makeClient: (token) => new StreamlabsClient(token, fetchImpl),
    loginWithBrowser: async () => 'browser-token',
    findDesktopToken: async () => null,
    fetchCurrentShow: opts.show ?? (async () => null),
  });
  return { store, controller, requests };
}

test('goLive resolves a typed category, trims the title, and remembers the stream', async () => {
  const { store, controller, requests } = setup((url) =>
    url.includes('/stream/start')
      ? { body: { id: 9, rtmp: 'rtmp://r', key: 'k' } }
      : { body: { categories: [{ full_name: 'News', game_mask_id: 'news-id' }] } },
  );
  const result = await controller.goLive(settings);

  assert.deepEqual(result, { ok: true, data: { id: '9', rtmpUrl: 'rtmp://r', streamKey: 'k' } });
  const form = requests.at(-1)!.init.body as FormData;
  assert.equal(form.get('category'), 'news-id');
  assert.equal(form.get('title'), 'The Smoke Pit');
  assert.equal(store.settings.title, 'The Smoke Pit');
  assert.equal(store.liveStream?.id, '9');
  assert.equal(controller.getState().liveStream?.streamKey, 'k');
});

test('goLive refuses a second stream and an empty title', async () => {
  const { store, controller, requests } = setup(() => ({ body: {} }));
  assert.match((await controller.goLive({ ...settings, title: ' ' }) as any).error, /title/);
  store.setLiveStream({ id: '1', rtmpUrl: 'r', streamKey: 'k' });
  assert.match((await controller.goLive(settings) as any).error, /already live/);
  assert.equal(requests.length, 0);
});

test('an expired token signs the user out but keeps the live stream so it can still be ended', async () => {
  const { store, controller } = setup(() => ({ status: 401, body: {} }));
  store.setLiveStream({ id: '1', rtmpUrl: 'r', streamKey: 'k' });
  const result = await controller.endLive();

  assert.equal(result.ok, false);
  assert.equal((result as any).signedOut, true);
  assert.equal(store.token, null);
  assert.equal(store.liveStream?.id, '1');
  assert.equal(controller.getState().signedIn, false);
});

test('endLive clears the stream once Streamlabs confirms, and forgetLiveStream clears it regardless', async () => {
  const { store, controller } = setup(() => ({ body: { success: true } }));
  store.setLiveStream({ id: '1', rtmpUrl: 'r', streamKey: 'k' });
  assert.deepEqual(await controller.endLive(), { ok: true, data: undefined });
  assert.equal(store.liveStream, null);

  store.setLiveStream({ id: '2', rtmpUrl: 'r', streamKey: 'k' });
  controller.forgetLiveStream();
  assert.equal(store.liveStream, null);
});

test('signing in checks the token with Streamlabs before saving it', async () => {
  const { store, controller } = setup(
    () => ({ body: { user: { username: 'pit' }, application_status: { status: 'approved' }, can_be_live: true } }),
    { token: null },
  );
  const result = await controller.loginWithBrowser();
  assert.deepEqual(result, { ok: true, data: { username: 'pit', applicationStatus: 'approved', canBeLive: true } });
  assert.equal(store.token, 'browser-token');
});

test('a rejected token is not saved', async () => {
  const { store, controller } = setup(() => ({ status: 401, body: {} }), { token: null });
  assert.equal((await controller.loginWithBrowser()).ok, false);
  assert.equal(store.token, null);
});

test('desktop sign-in explains when Streamlabs Desktop has no sign-in', async () => {
  const { controller } = setup(() => ({ body: {} }), { token: null });
  const result = await controller.loginWithDesktopApp();
  assert.match((result as any).error, /No Streamlabs Desktop sign-in was found/);
});

test('cancelling sign-in reports no error text', async () => {
  const store = new Store(tempFile(), fakeCipher);
  const controller = new Controller({
    store,
    version: '0',
    loginWithBrowser: (signal) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(new LoginCancelled()))),
    findDesktopToken: async () => null,
    fetchCurrentShow: async () => null,
  });
  const pending = controller.loginWithBrowser();
  controller.cancelLogin();
  assert.deepEqual(await pending, { ok: false, error: '' });
});

test('nothing reaches Streamlabs while signed out', async () => {
  const { controller, requests } = setup(() => ({ body: {} }), { token: null });
  assert.deepEqual(await controller.searchCategories('news'), { ok: false, error: 'Sign in first.', signedOut: true });
  assert.equal(requests.length, 0);
});

test('a new show from the portal becomes the stream title', async () => {
  let show: ShowInfo | null = { title: 'Election Eve Special', plannedAt: '2026-11-02T23:00:00Z' };
  const { store, controller } = setup(() => ({ body: {} }), { show: async () => show });

  const first = await controller.loadShowTitle();
  assert.deepEqual(first, { ok: true, data: { show, title: 'Election Eve Special' } });
  assert.equal(store.settings.title, 'Election Eve Special');

  // The panelist tweaks it; reopening the app for the same show keeps the tweak.
  store.setSettings({ ...store.settings, title: 'Election Eve Special 🇺🇸' });
  assert.equal(((await controller.loadShowTitle()) as any).data.title, 'Election Eve Special 🇺🇸');

  // The next show replaces it.
  show = { title: 'Results Night', plannedAt: null };
  assert.equal(((await controller.loadShowTitle()) as any).data.title, 'Results Night');
});

test('the portal title never changes a stream that is already live', async () => {
  const { store, controller } = setup(() => ({ body: {} }), {
    show: async () => ({ title: 'Next Show', plannedAt: null }),
  });
  store.setSettings({ ...store.settings, title: 'Current Show' });
  store.setLiveStream({ id: '1', rtmpUrl: 'r', streamKey: 'k' });
  assert.equal(((await controller.loadShowTitle()) as any).data.title, 'Current Show');
});

test('no show or an unreachable portal leaves the saved title alone', async () => {
  const none = setup(() => ({ body: {} }));
  none.store.setSettings({ ...none.store.settings, title: 'Saved' });
  assert.deepEqual(await none.controller.loadShowTitle(), { ok: true, data: { show: null, title: 'Saved' } });

  const down = setup(() => ({ body: {} }), {
    show: async () => {
      throw new Error('Could not reach the Smoke Pit portal: offline');
    },
  });
  assert.deepEqual(await down.controller.loadShowTitle(), {
    ok: false,
    error: 'Could not reach the Smoke Pit portal: offline',
  });
  assert.equal(down.store.settings.title, 'The Smoke Pit — LIVE');
});
