// Everything the window can ask for, independent of Electron so it can be tested.

import type { AccountInfo, AppState, Category, LiveStream, Result, ShowInfo, StreamSettings } from '../shared/types';
import { LoginCancelled } from './auth';
import { StreamlabsClient, StreamlabsError } from './streamlabs';
import type { Store } from './store';

export interface ControllerDeps {
  store: Store;
  version: string;
  makeClient?: (token: string) => StreamlabsClient;
  loginWithBrowser: (signal: AbortSignal) => Promise<string>;
  findDesktopToken: () => Promise<string | null>;
  fetchCurrentShow: () => Promise<ShowInfo | null>;
}

export class Controller {
  private pendingLogin: AbortController | null = null;
  private readonly makeClient: (token: string) => StreamlabsClient;

  constructor(private readonly deps: ControllerDeps) {
    this.makeClient = deps.makeClient ?? ((token) => new StreamlabsClient(token));
  }

  getState(): AppState {
    const { store } = this.deps;
    return {
      acknowledgedRisk: store.acknowledgedRisk,
      signedIn: store.token !== null,
      settings: store.settings,
      liveStream: store.liveStream,
      version: this.deps.version,
    };
  }

  /**
   * Takes the stream title from the portal when there's a new show. The same show
   * again (an app restart) keeps whatever the panelist changed the title to, and a
   * stream that's already live is left alone.
   */
  async loadShowTitle(): Promise<Result<{ show: ShowInfo | null; title: string }>> {
    const { store } = this.deps;
    try {
      const show = await this.deps.fetchCurrentShow();
      if (show && show.title !== store.portalTitle && !store.liveStream) {
        store.setSettings({ ...store.settings, title: show.title });
        store.setPortalTitle(show.title);
      }
      return { ok: true, data: { show, title: store.settings.title } };
    } catch (err) {
      return failure(err);
    }
  }

  acknowledgeRisk(): void {
    this.deps.store.acknowledgeRisk();
  }

  async loginWithBrowser(): Promise<Result<AccountInfo>> {
    this.pendingLogin?.abort();
    const pending = new AbortController();
    this.pendingLogin = pending;
    try {
      return await this.signInWith(await this.deps.loginWithBrowser(pending.signal));
    } catch (err) {
      return failure(err);
    } finally {
      if (this.pendingLogin === pending) this.pendingLogin = null;
    }
  }

  cancelLogin(): void {
    this.pendingLogin?.abort();
  }

  async loginWithDesktopApp(): Promise<Result<AccountInfo>> {
    try {
      const token = await this.deps.findDesktopToken();
      if (!token) {
        return {
          ok: false,
          error:
            'No Streamlabs Desktop sign-in was found on this Mac. Open Streamlabs Desktop, sign in with TikTok, ' +
            'then try again — or use “Sign in with TikTok” instead.',
        };
      }
      return await this.signInWith(token);
    } catch (err) {
      return failure(err);
    }
  }

  async getAccount(): Promise<Result<AccountInfo>> {
    return this.withClient((client) => client.getAccount());
  }

  signOut(): void {
    this.deps.store.setToken(null);
  }

  async searchCategories(query: string): Promise<Result<Category[]>> {
    return this.withClient((client) => client.searchCategories(query));
  }

  saveSettings(settings: StreamSettings): void {
    this.deps.store.setSettings(settings);
  }

  async goLive(settings: StreamSettings): Promise<Result<LiveStream>> {
    const title = settings.title.trim();
    if (!title) return { ok: false, error: 'Give the stream a title first.' };
    if (this.deps.store.liveStream) {
      return { ok: false, error: 'A stream is already live. End it before starting a new one.' };
    }
    this.deps.store.setSettings({ ...settings, title });

    return this.withClient(async (client) => {
      // A typed-in category that was never picked from the list still needs its id.
      const maskId = settings.categoryMaskId || (await client.resolveCategory(settings.categoryName));
      const started = await client.start(title, maskId, settings.mature);
      this.deps.store.setLiveStream(started);
      return started;
    });
  }

  async endLive(): Promise<Result<void>> {
    const live = this.deps.store.liveStream;
    if (!live) return { ok: true, data: undefined };
    return this.withClient(async (client) => {
      await client.end(live.id);
      this.deps.store.setLiveStream(null);
    });
  }

  /** For a stream that already ended on TikTok's side, so End keeps failing. */
  forgetLiveStream(): void {
    this.deps.store.setLiveStream(null);
  }

  private async signInWith(token: string): Promise<Result<AccountInfo>> {
    const account = await this.makeClient(token).getAccount();
    this.deps.store.setToken(token);
    return { ok: true, data: account };
  }

  private async withClient<T>(fn: (client: StreamlabsClient) => Promise<T>): Promise<Result<T>> {
    const token = this.deps.store.token;
    if (!token) return { ok: false, error: 'Sign in first.', signedOut: true };
    try {
      return { ok: true, data: await fn(this.makeClient(token)) };
    } catch (err) {
      if (err instanceof StreamlabsError && err.isAuthFailure) {
        this.deps.store.setToken(null);
        return { ok: false, error: err.message, signedOut: true };
      }
      return failure(err);
    }
  }
}

function failure(err: unknown): { ok: false; error: string } {
  if (err instanceof LoginCancelled) return { ok: false, error: '' };
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}
