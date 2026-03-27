import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createExternalRequestUrlMiddleware, getExternalRequestUrl } from '../../src/lib/request-url';

describe('request URL helpers', () => {
  it('ignores forwarded headers when proxy trust is disabled', () => {
    const headers = new Headers({
      'x-forwarded-host': 'tack.taiko.xyz',
      'x-forwarded-proto': 'https'
    });

    expect(getExternalRequestUrl('http://localhost/pins', headers).toString()).toBe('http://localhost/pins');
  });

  it('uses x-forwarded host, proto, and port when proxy trust is enabled', () => {
    const headers = new Headers({
      'x-forwarded-host': 'tack.taiko.xyz',
      'x-forwarded-port': '8443',
      'x-forwarded-proto': 'https'
    });

    expect(getExternalRequestUrl('http://localhost/pins', headers, {
      trustProxy: true,
      trustedProxyCidrs: ['10.0.0.0/8'],
      remoteAddress: '10.0.0.4'
    }).toString()).toBe(
      'https://tack.taiko.xyz:8443/pins'
    );
  });

  it('prefers the standard Forwarded header when present', () => {
    const headers = new Headers({
      forwarded: 'for=203.0.113.10;proto=https;host=tack.taiko.xyz:8443'
    });

    expect(getExternalRequestUrl('http://localhost/pins', headers, {
      trustProxy: true,
      trustedProxyCidrs: ['10.0.0.0/8'],
      remoteAddress: '10.0.0.4'
    }).toString()).toBe(
      'https://tack.taiko.xyz:8443/pins'
    );
  });

  it('ignores forwarded headers from untrusted proxy addresses', () => {
    const headers = new Headers({
      'x-forwarded-host': 'tack.taiko.xyz',
      'x-forwarded-proto': 'https'
    });

    expect(getExternalRequestUrl('http://localhost/pins', headers, {
      trustProxy: true,
      trustedProxyCidrs: ['10.0.0.0/8'],
      remoteAddress: '203.0.113.20'
    }).toString()).toBe('http://localhost/pins');
  });

  it('prefers PUBLIC_BASE_URL over forwarded headers', () => {
    const headers = new Headers({
      forwarded: 'for=203.0.113.10;proto=http;host=internal-only.example',
      'x-forwarded-host': 'proxy.example',
      'x-forwarded-proto': 'http'
    });

    expect(getExternalRequestUrl('http://localhost/pins?format=json', headers, {
      publicBaseUrl: 'https://api.tack.example'
    }).toString()).toBe('https://api.tack.example/pins?format=json');
  });

  it('normalizes c.req.url for downstream handlers', async () => {
    const app = new Hono();
    app.use(createExternalRequestUrlMiddleware({ publicBaseUrl: 'https://api.tack.example' }));
    app.get('/pins', (c) => c.text(c.req.url));

    const response = await app.request('http://localhost/pins?format=json');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('https://api.tack.example/pins?format=json');
  });
});
