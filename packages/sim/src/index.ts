import { CAP } from '@crowntag/content';
import type { StubMessage } from '@crowntag/protocol';

/**
 * Advance the Arena sim by one tick.
 * Stub — real rules land later. Headless: no DOM / Cloudflare APIs.
 */
export function step(_message?: StubMessage): void {
  void CAP;
}

export { CAP };
