import type { AccountInfo, BridgeApi, Category, LiveStream, Result, ShowInfo, StreamSettings } from '../shared/types';

declare global {
  interface Window {
    api: BridgeApi;
  }
}

const api = window.api;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const sections = {
  risk: $('risk'),
  signin: $('signin'),
  account: $('account'),
  setup: $('setup'),
  live: $('live'),
};
const titleInput = $<HTMLInputElement>('title');
const categoryInput = $<HTMLInputElement>('category');
const categoryList = $<HTMLUListElement>('category-list');
const matureInput = $<HTMLInputElement>('mature');
const goLiveButton = $<HTMLButtonElement>('go-live');
const endLiveButton = $<HTMLButtonElement>('end-live');
const keyInput = $<HTMLInputElement>('key');

let categoryMaskId = '';
let canBeLive = false;
let liveStream: LiveStream | null = null;

// ---------------------------------------------------------------- feedback

function showError(message: string): void {
  const el = $('error');
  el.textContent = message;
  el.hidden = !message;
}

let toastTimer: number | undefined;
function toast(message: string): void {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 2000);
}

/** Shows a failed result's error; returns the data when it succeeded. */
function handle<T>(result: Result<T>): T | undefined {
  if (result.ok) {
    showError('');
    return result.data;
  }
  showError(result.error);
  if (result.signedOut) showSignedOut();
  return undefined;
}

async function busy<T>(button: HTMLButtonElement, label: string, work: () => Promise<T>): Promise<T> {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await work();
  } finally {
    button.disabled = false;
    button.textContent = original;
    updateGoLive();
  }
}

// ---------------------------------------------------------------- views

function showSignedOut(): void {
  sections.signin.hidden = false;
  sections.account.hidden = true;
  sections.setup.hidden = true;
  canBeLive = false;
}

function showAccount(account: AccountInfo): void {
  sections.signin.hidden = true;
  sections.account.hidden = false;
  $('acct-username').textContent = `@${account.username}`;
  $('acct-status').textContent = account.applicationStatus;
  const can = $('acct-can');
  can.textContent = account.canBeLive ? 'Yes' : 'No';
  can.className = account.canBeLive ? 'yes' : 'no';
  $('acct-blocked').hidden = account.canBeLive;
  canBeLive = account.canBeLive;
  renderLive();
}

function renderLive(): void {
  sections.live.hidden = !liveStream;
  sections.setup.hidden = !!liveStream || sections.account.hidden;
  if (liveStream) {
    $<HTMLInputElement>('rtmp').value = liveStream.rtmpUrl;
    keyInput.value = liveStream.streamKey;
    keyInput.type = 'password';
    $('key-toggle').textContent = 'Show';
    $('key-missing').hidden = !!liveStream.streamKey;
    $('end-stuck').hidden = true;
  }
  updateGoLive();
}

function updateGoLive(): void {
  if (goLiveButton.textContent !== 'Go LIVE') return; // mid-request
  goLiveButton.disabled = !canBeLive || !titleInput.value.trim();
}

async function loadAccount(): Promise<void> {
  const result = await api.getAccount();
  const account = handle(result);
  if (account) showAccount(account);
  else if (!result.ok && !result.signedOut) {
    // Still signed in but Streamlabs couldn't be reached; keep the account card so Refresh is there.
    showAccount({ username: '—', applicationStatus: '—', canBeLive: false });
    $('acct-username').textContent = '—';
    $('acct-can').textContent = '—';
    $('acct-blocked').hidden = true;
  }
}

// ---------------------------------------------------------------- show title from the portal

let portalShow: ShowInfo | null = null;

function airTime(iso: string | null): string {
  if (!iso) return '';
  const when = new Date(iso);
  const sameDay = when.toDateString() === new Date().toDateString();
  const time = when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? `today at ${time}` : `${when.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
}

function renderShowHint(message?: string): void {
  const hint = $('show-hint');
  const text = $('show-hint-text');
  const useButton = $('use-show-title');
  if (portalShow) {
    const when = airTime(portalShow.plannedAt);
    text.replaceChildren('Portal: ', Object.assign(document.createElement('b'), { textContent: portalShow.title }), when ? ` · ${when}` : '');
    useButton.hidden = titleInput.value === portalShow.title;
    hint.hidden = false;
  } else {
    text.textContent = message ?? '';
    useButton.hidden = true;
    hint.hidden = !message;
  }
}

async function loadShowTitle(): Promise<void> {
  const before = titleInput.value;
  const result = await api.loadShowTitle();
  if (!result.ok) {
    // Not worth an error banner: the saved title still works.
    renderShowHint('Couldn’t reach the portal for the show title.');
    return;
  }
  portalShow = result.data.show;
  // Typing that happened while the portal answered wins.
  if (!liveStream && titleInput.value === before) titleInput.value = result.data.title;
  renderShowHint(portalShow ? undefined : 'No show on the portal in the next 24 hours.');
  updateGoLive();
}

$('use-show-title').addEventListener('click', () => {
  if (!portalShow) return;
  titleInput.value = portalShow.title;
  renderShowHint();
  updateGoLive();
  saveSoon();
});

// ---------------------------------------------------------------- settings

function currentSettings(): StreamSettings {
  return {
    title: titleInput.value,
    categoryName: categoryInput.value.trim(),
    categoryMaskId,
    mature: matureInput.checked,
  };
}

let saveTimer: number | undefined;
function saveSoon(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void api.saveSettings(currentSettings()), 400);
}

// ---------------------------------------------------------------- category search

let categories: Category[] = [];
let activeIndex = -1;
let searchTimer: number | undefined;
let searchSeq = 0;

function closeCategories(): void {
  categoryList.hidden = true;
  categoryInput.setAttribute('aria-expanded', 'false');
  activeIndex = -1;
}

function renderCategories(): void {
  categoryList.replaceChildren(
    ...categories.map((c, i) => {
      const li = document.createElement('li');
      li.textContent = c.name;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === activeIndex));
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pickCategory(c);
      });
      return li;
    }),
  );
  categoryList.hidden = categories.length === 0;
  categoryInput.setAttribute('aria-expanded', String(!categoryList.hidden));
}

function pickCategory(c: Category): void {
  categoryInput.value = c.name;
  categoryMaskId = c.maskId;
  closeCategories();
  saveSoon();
}

categoryInput.addEventListener('input', () => {
  categoryMaskId = '';
  saveSoon();
  clearTimeout(searchTimer);
  const query = categoryInput.value.trim();
  if (!query) return closeCategories();
  searchTimer = window.setTimeout(async () => {
    const seq = ++searchSeq;
    const result = await api.searchCategories(query);
    if (seq !== searchSeq || document.activeElement !== categoryInput) return;
    const found = handle(result);
    if (!found) return;
    categories = found;
    activeIndex = -1;
    renderCategories();
  }, 300);
});

categoryInput.addEventListener('keydown', (e) => {
  if (categoryList.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    activeIndex = (activeIndex + step + categories.length) % categories.length;
    renderCategories();
  } else if (e.key === 'Enter' && activeIndex >= 0) {
    e.preventDefault();
    pickCategory(categories[activeIndex]);
  } else if (e.key === 'Escape') {
    closeCategories();
  }
});
categoryInput.addEventListener('blur', closeCategories);

// ---------------------------------------------------------------- actions

$<HTMLInputElement>('risk-check').addEventListener('change', (e) => {
  $<HTMLButtonElement>('risk-continue').disabled = !(e.target as HTMLInputElement).checked;
});
$('risk-continue').addEventListener('click', async () => {
  await api.acknowledgeRisk();
  sections.risk.hidden = true;
  await start();
});

$<HTMLButtonElement>('login-browser').addEventListener('click', async (e) => {
  const button = e.currentTarget as HTMLButtonElement;
  $('login-waiting').hidden = false;
  try {
    const account = await busy(button, 'Waiting for browser…', () => api.loginWithBrowser().then(handle));
    if (account) showAccount(account);
  } finally {
    $('login-waiting').hidden = true;
  }
});
$('login-cancel').addEventListener('click', () => void api.cancelLogin());

$<HTMLButtonElement>('login-desktop').addEventListener('click', async (e) => {
  const account = await busy(e.currentTarget as HTMLButtonElement, 'Looking…', () =>
    api.loginWithDesktopApp().then(handle),
  );
  if (account) showAccount(account);
});

$<HTMLButtonElement>('refresh').addEventListener('click', (e) =>
  busy(e.currentTarget as HTMLButtonElement, 'Refreshing…', loadAccount),
);

$('signout').addEventListener('click', async () => {
  await api.signOut();
  showError('');
  showSignedOut();
});

titleInput.addEventListener('input', () => {
  updateGoLive();
  if (portalShow) renderShowHint();
  saveSoon();
});
matureInput.addEventListener('change', saveSoon);

goLiveButton.addEventListener('click', async () => {
  const started = await busy(goLiveButton, 'Starting…', () => api.goLive(currentSettings()).then(handle));
  if (started) {
    liveStream = started;
    renderLive();
    toast('Your stream is ready — paste it into OBS.');
  }
});

endLiveButton.addEventListener('click', async () => {
  const result = await busy(endLiveButton, 'Ending…', () => api.endLive());
  handle(result);
  if (result.ok) {
    liveStream = null;
    renderLive();
    toast('Stream ended.');
  } else {
    $('end-stuck').hidden = false;
  }
});

$('forget-live').addEventListener('click', async () => {
  await api.forgetLiveStream();
  liveStream = null;
  showError('');
  renderLive();
});

$('key-toggle').addEventListener('click', (e) => {
  const showing = keyInput.type === 'text';
  keyInput.type = showing ? 'password' : 'text';
  (e.currentTarget as HTMLElement).textContent = showing ? 'Show' : 'Hide';
});

document.querySelectorAll<HTMLElement>('[data-copy]').forEach((button) =>
  button.addEventListener('click', async () => {
    const field = $<HTMLInputElement>(button.dataset.copy!);
    await api.copy(field.value);
    toast(button.dataset.copy === 'key' ? 'Stream key copied' : 'Server copied');
  }),
);

document.querySelectorAll<HTMLElement>('[data-open]').forEach((el) =>
  el.addEventListener('click', () => void api.open(el.dataset.open as Parameters<BridgeApi['open']>[0])),
);

// ---------------------------------------------------------------- start up

async function start(): Promise<void> {
  const state = await api.getState();
  $('version').textContent = state.version;
  titleInput.value = state.settings.title;
  categoryInput.value = state.settings.categoryName;
  categoryMaskId = state.settings.categoryMaskId;
  matureInput.checked = state.settings.mature;
  liveStream = state.liveStream;

  if (!state.acknowledgedRisk) {
    sections.risk.hidden = false;
    return;
  }
  renderLive();
  void loadShowTitle();
  if (state.signedIn) await loadAccount();
  else showSignedOut();
}

void start();
