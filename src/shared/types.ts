// Shapes that cross the IPC bridge between the main process and the window.

export interface AccountInfo {
  username: string;
  applicationStatus: string;
  canBeLive: boolean;
}

export interface Category {
  name: string;
  maskId: string;
}

/** The show the portal says is on now or next (within 24 hours). */
export interface ShowInfo {
  title: string;
  plannedAt: string | null;
}

export interface StreamSettings {
  title: string;
  categoryName: string;
  categoryMaskId: string;
  mature: boolean;
}

export interface LiveStream {
  id: string;
  rtmpUrl: string;
  streamKey: string;
}

export interface AppState {
  acknowledgedRisk: boolean;
  signedIn: boolean;
  settings: StreamSettings;
  /** Set while a stream started from this app has not been ended yet, even across restarts. */
  liveStream: LiveStream | null;
  version: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; signedOut?: boolean };

export type ExternalLink = 'liveCenter' | 'liveAccess' | 'source' | 'upstream';

export interface BridgeApi {
  getState(): Promise<AppState>;
  /** Asks the portal for the show; `title` is the stream title to show afterwards. */
  loadShowTitle(): Promise<Result<{ show: ShowInfo | null; title: string }>>;
  acknowledgeRisk(): Promise<void>;
  loginWithBrowser(): Promise<Result<AccountInfo>>;
  cancelLogin(): Promise<void>;
  loginWithDesktopApp(): Promise<Result<AccountInfo>>;
  getAccount(): Promise<Result<AccountInfo>>;
  signOut(): Promise<void>;
  searchCategories(query: string): Promise<Result<Category[]>>;
  saveSettings(settings: StreamSettings): Promise<void>;
  goLive(settings: StreamSettings): Promise<Result<LiveStream>>;
  endLive(): Promise<Result<void>>;
  forgetLiveStream(): Promise<void>;
  copy(text: string): Promise<void>;
  open(link: ExternalLink): Promise<void>;
}
