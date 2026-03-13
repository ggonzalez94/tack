import { describe, expect, it } from 'vitest';
import { getExternalOrigin, getExternalRequestUrl } from '../../src/lib/request-url';

describe('request URL helpers', () => {
  it('ignores forwarded headers when proxy trust is disabled', () => {
    const headers = new Headers({
      'x-forwarded-host': 'tack-api-production.up.railway.app',
      'x-forwarded-proto': 'https'
    });

    expect(getExternalOrigin('http://localhost/pins', headers, false)).toBe('http://localhost');
  });

  it('uses x-forwarded host and proto when proxy trust is enabled', () => {
    const headers = new Headers({
      'x-forwarded-host': 'tack-api-production.up.railway.app',
      'x-forwarded-proto': 'https'
    });

    expect(getExternalOrigin('http://localhost/pins', headers, true)).toBe('https://tack-api-production.up.railway.app');
  });

  it('prefers the standard Forwarded header when present', () => {
    const headers = new Headers({
      forwarded: 'for=203.0.113.10;proto=https;host=tack-api-production.up.railway.app'
    });

    expect(getExternalRequestUrl('http://localhost/pins', headers, true).toString()).toBe(
      'https://tack-api-production.up.railway.app/pins'
    );
  });
});
