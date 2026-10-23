import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, Store } from '../src/main/store';
import { fakeCipher, noCipher, tempFile } from './helpers';

test('the token and stream key are only written encrypted, and survive a restart', () => {
  const file = tempFile();
  const store = new Store(file, fakeCipher);
  store.setToken('secret-token');
  store.setLiveStream({ id: '7', rtmpUrl: 'rtmp://x', streamKey: 'secret-key' });

  const raw = readFileSync(file, 'utf8');
  assert.doesNotMatch(raw, /secret-token|secret-key/);

  const reopened = new Store(file, fakeCipher);
  assert.equal(reopened.token, 'secret-token');
  assert.deepEqual(reopened.liveStream, { id: '7', rtmpUrl: 'rtmp://x', streamKey: 'secret-key' });
});

test('without encryption the token lasts only for this session, but the stream id is kept', () => {
  const file = tempFile();
  const store = new Store(file, noCipher);
  store.setToken('secret-token');
  store.setLiveStream({ id: '7', rtmpUrl: 'rtmp://x', streamKey: 'secret-key' });
  assert.equal(store.token, 'secret-token');
  assert.equal(store.liveStream?.streamKey, 'secret-key');
  assert.doesNotMatch(readFileSync(file, 'utf8'), /secret/);

  const reopened = new Store(file, noCipher);
  assert.equal(reopened.token, null);
  assert.deepEqual(reopened.liveStream, { id: '7', rtmpUrl: 'rtmp://x', streamKey: '' });
});

test('signing out removes the token', () => {
  const file = tempFile();
  const store = new Store(file, fakeCipher);
  store.setToken('t');
  store.setToken(null);
  assert.equal(store.token, null);
  assert.equal(new Store(file, fakeCipher).token, null);
});

test('settings default to the Smoke Pit title and persist', () => {
  const file = tempFile();
  const store = new Store(file, fakeCipher);
  assert.deepEqual(store.settings, DEFAULT_SETTINGS);
  assert.equal(store.acknowledgedRisk, false);

  const settings = { title: 'Election Night', categoryName: 'News', categoryMaskId: 'n1', mature: true };
  store.setSettings(settings);
  store.acknowledgeRisk();
  const reopened = new Store(file, fakeCipher);
  assert.deepEqual(reopened.settings, settings);
  assert.equal(reopened.acknowledgedRisk, true);
});

test('a corrupt settings file starts fresh instead of crashing', () => {
  const file = tempFile();
  writeFileSync(file, '{not json');
  assert.deepEqual(new Store(file, fakeCipher).settings, DEFAULT_SETTINGS);
});
