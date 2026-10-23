// The Smoke Pit panelist portal's public GET /api/live-title, which names the
// show on air now or next up within 24 hours (or null when there isn't one).

import type { ShowInfo } from '../shared/types';
import type { FetchLike } from './streamlabs';

export const PORTAL_URL = 'https://thesmokepit.crayoneatermedia.com';

export async function fetchCurrentShow(fetchImpl: FetchLike = fetch, baseUrl = PORTAL_URL): Promise<ShowInfo | null> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/live-title`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    throw new Error(`Could not reach the Smoke Pit portal: ${(err as Error).message}`);
  }
  if (!response.ok) throw new Error(`The Smoke Pit portal returned an error (HTTP ${response.status}).`);

  const body: any = await response.json().catch(() => null);
  const show = body?.show;
  if (!show) return null;
  if (typeof show.title !== 'string' || !show.title.trim()) return null;
  return {
    title: show.title.trim(),
    plannedAt: typeof show.plannedAt === 'string' ? show.plannedAt : null,
  };
}
