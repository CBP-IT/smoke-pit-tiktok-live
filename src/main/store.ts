// Settings persisted as JSON in the app's data folder. The Streamlabs token is
// only written encrypted (macOS Keychain via Electron's safeStorage); if
// encryption is unavailable it is kept in memory for this session only.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LiveStream, StreamSettings } from '../shared/types';

export interface Cipher {
  isAvailable(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(encrypted: Buffer): string;
}

interface StoredData {
  acknowledgedRisk?: boolean;
  encryptedToken?: string;
  settings?: Partial<StreamSettings>;
  liveStream?: { id: string; rtmpUrl: string; encryptedKey?: string } | null;
  /** The last show title taken from the portal, so a panelist's edit to it survives a restart. */
  portalTitle?: string;
}

export const DEFAULT_SETTINGS: StreamSettings = {
  title: 'The Smoke Pit — LIVE',
  categoryName: '',
  categoryMaskId: '',
  mature: false,
};

export class Store {
  private data: StoredData;
  private sessionToken: string | null = null;
  private sessionStreamKey: string | null = null;

  constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {
    this.data = read(file);
  }

  get acknowledgedRisk(): boolean {
    return this.data.acknowledgedRisk === true;
  }

  acknowledgeRisk(): void {
    this.data.acknowledgedRisk = true;
    this.save();
  }

  get token(): string | null {
    return this.sessionToken ?? this.decrypt(this.data.encryptedToken);
  }

  setToken(token: string | null): void {
    this.sessionToken = token;
    this.data.encryptedToken = this.encrypt(token);
    this.save();
  }

  get settings(): StreamSettings {
    return { ...DEFAULT_SETTINGS, ...this.data.settings };
  }

  setSettings(settings: StreamSettings): void {
    this.data.settings = {
      title: settings.title,
      categoryName: settings.categoryName,
      categoryMaskId: settings.categoryMaskId,
      mature: settings.mature,
    };
    this.save();
  }

  get portalTitle(): string | null {
    return this.data.portalTitle ?? null;
  }

  setPortalTitle(title: string): void {
    this.data.portalTitle = title;
    this.save();
  }

  get liveStream(): LiveStream | null {
    const stored = this.data.liveStream;
    if (!stored) return null;
    const streamKey = this.sessionStreamKey ?? this.decrypt(stored.encryptedKey) ?? '';
    return { id: stored.id, rtmpUrl: stored.rtmpUrl, streamKey };
  }

  /** The stream id is always kept so the stream can be ended after a restart; the key only encrypted. */
  setLiveStream(stream: LiveStream | null): void {
    this.sessionStreamKey = stream?.streamKey ?? null;
    this.data.liveStream = stream
      ? { id: stream.id, rtmpUrl: stream.rtmpUrl, encryptedKey: this.encrypt(stream.streamKey) }
      : null;
    this.save();
  }

  private encrypt(plain: string | null): string | undefined {
    if (!plain || !this.cipher.isAvailable()) return undefined;
    return this.cipher.encrypt(plain).toString('base64');
  }

  private decrypt(encrypted: string | undefined): string | null {
    if (!encrypted || !this.cipher.isAvailable()) return null;
    try {
      return this.cipher.decrypt(Buffer.from(encrypted, 'base64'));
    } catch {
      return null;
    }
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

function read(file: string): StoredData {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
