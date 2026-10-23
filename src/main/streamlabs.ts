// Client for the (undocumented) Streamlabs Desktop TikTok endpoints, ported from
// Loukious/StreamLabsTikTokStreamKeyGenerator (Stream.py). Streamlabs only serves
// these to its own desktop app, so requests carry its user agent and platform.

import type { AccountInfo, Category } from '../shared/types';

export const STREAMLABS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'StreamlabsDesktop/1.20.4 Chrome/122.0.6261.156 Electron/29.3.1 Safari/537.36';

const API = 'https://streamlabs.com/api/v5/slobs/tiktok';

// Streamlabs returns HTTP 500 for category searches longer than this.
const MAX_CATEGORY_QUERY = 25;

export const OTHER_CATEGORY: Category = { name: 'Other', maskId: '' };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class StreamlabsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'StreamlabsError';
  }

  /** The token was rejected, so the user has to sign in again. */
  get isAuthFailure(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

export interface StartedStream {
  id: string;
  rtmpUrl: string;
  streamKey: string;
}

export class StreamlabsClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async getAccount(): Promise<AccountInfo> {
    const info = await this.request(`${API}/info`);
    return {
      username: info?.user?.username ?? 'Unknown',
      applicationStatus: info?.application_status?.status ?? 'Unknown',
      canBeLive: info?.can_be_live === true,
    };
  }

  async searchCategories(query: string): Promise<Category[]> {
    const q = query.trim().slice(0, MAX_CATEGORY_QUERY);
    if (!q) return [OTHER_CATEGORY];
    const info = await this.request(`${API}/info?category=${encodeURIComponent(q)}`);
    const found: Category[] = (info?.categories ?? [])
      .filter((c: any) => typeof c?.full_name === 'string')
      .map((c: any) => ({ name: c.full_name, maskId: String(c.game_mask_id ?? '') }));
    return [...found, OTHER_CATEGORY];
  }

  /** The mask id of the category named exactly `name`, or '' (Other) when there is none. */
  async resolveCategory(name: string): Promise<string> {
    if (!name.trim()) return '';
    const match = (await this.searchCategories(name)).find((c) => c.name === name);
    return match?.maskId ?? '';
  }

  async start(title: string, categoryMaskId: string, mature: boolean): Promise<StartedStream> {
    const form = new FormData();
    form.append('title', title);
    form.append('device_platform', 'win32');
    form.append('category', categoryMaskId);
    form.append('audience_type', mature ? '1' : '0');
    const res = await this.request(`${API}/stream/start`, { method: 'POST', body: form });
    if (!res?.id || !res?.rtmp || !res?.key) {
      throw new StreamlabsError(describeFailure(res, 'TikTok did not return a stream key.'));
    }
    return { id: String(res.id), rtmpUrl: res.rtmp, streamKey: res.key };
  }

  async end(streamId: string): Promise<void> {
    const res = await this.request(`${API}/stream/${encodeURIComponent(streamId)}/end`, {
      method: 'POST',
    });
    if (res?.success !== true) {
      throw new StreamlabsError(describeFailure(res, 'Streamlabs did not confirm the stream ended.'));
    }
  }

  private async request(url: string, init: RequestInit = {}): Promise<any> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: {
          'user-agent': STREAMLABS_USER_AGENT,
          authorization: `Bearer ${this.token}`,
        },
      });
    } catch (err) {
      throw new StreamlabsError(`Could not reach Streamlabs: ${(err as Error).message}`);
    }

    const text = await response.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON bodies (HTML error pages) fall through to the status check below.
    }

    if (!response.ok) {
      const fallback =
        response.status === 401 || response.status === 403
          ? 'Your Streamlabs sign-in has expired. Please sign in again.'
          : `Streamlabs returned an error (HTTP ${response.status}).`;
      throw new StreamlabsError(describeFailure(body, fallback), response.status);
    }
    return body;
  }
}

function describeFailure(body: any, fallback: string): string {
  const message = body?.message ?? body?.error ?? body?.data?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}
