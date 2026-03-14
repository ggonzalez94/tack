import type { MiddlewareHandler } from 'hono';
import { isTrustedProxy } from './proxy-trust';

export interface ExternalRequestUrlOptions {
  publicBaseUrl?: string;
  trustProxy?: boolean;
  trustedProxyCidrs?: string[];
  remoteAddress?: string | null;
}

interface MutableRequestUrl {
  raw: Request;
  url: string;
}

function getRemoteAddressFromBindings(env: unknown): string | null {
  if (!env || typeof env !== 'object') {
    return null;
  }

  const envRecord = env as { incoming?: { socket?: { remoteAddress?: string | null } } };
  return typeof envRecord.incoming?.socket?.remoteAddress === 'string'
    ? envRecord.incoming.socket.remoteAddress
    : null;
}

function getFirstHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const first = value.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}

function stripQuotes(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }

  return value;
}

function isTrustedProtocol(value: string | null): value is 'http' | 'https' {
  return value === 'http' || value === 'https';
}

function parseForwardedHeader(value: string | null): { host: string | null; proto: 'http' | 'https' | null } {
  const first = getFirstHeaderValue(value);
  if (!first) {
    return { host: null, proto: null };
  }

  let host: string | null = null;
  let proto: 'http' | 'https' | null = null;

  for (const part of first.split(';')) {
    const [rawKey, rawValue] = part.split('=', 2);
    if (!rawKey || !rawValue) {
      continue;
    }

    const key = rawKey.trim().toLowerCase();
    const parsedValue = stripQuotes(rawValue.trim());

    if (key === 'host' && parsedValue.length > 0) {
      host = parsedValue;
    }

    if (key === 'proto') {
      const normalized = parsedValue.toLowerCase();
      if (isTrustedProtocol(normalized)) {
        proto = normalized;
      }
    }
  }

  return { host, proto };
}

function parseForwardedPort(value: string | null): string | null {
  const port = getFirstHeaderValue(value);
  return port && /^[0-9]+$/.test(port) ? port : null;
}

function applyOrigin(url: URL, origin: URL): URL {
  url.protocol = origin.protocol;
  url.host = origin.host;
  return url;
}

function applyForwardedHost(url: URL, forwardedHost: string): boolean {
  try {
    const parsed = new URL(`${url.protocol}//${forwardedHost}`);
    if (
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.pathname !== '/' ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0
    ) {
      return false;
    }

    url.hostname = parsed.hostname;
    url.port = parsed.port;
    return true;
  } catch {
    return false;
  }
}

export function getExternalRequestUrl(requestUrl: string, headers: Headers, options?: ExternalRequestUrlOptions): URL {
  const url = new URL(requestUrl);

  if (options?.publicBaseUrl) {
    return applyOrigin(url, new URL(options.publicBaseUrl));
  }

  if (!options?.trustProxy) {
    return url;
  }

  if (!isTrustedProxy(options.remoteAddress, options.trustedProxyCidrs ?? [])) {
    return url;
  }

  const forwarded = parseForwardedHeader(headers.get('forwarded'));
  const forwardedHost = forwarded.host ?? getFirstHeaderValue(headers.get('x-forwarded-host'));
  const forwardedPort = parseForwardedPort(headers.get('x-forwarded-port'));
  const forwardedProto = forwarded.proto ?? (() => {
    const proto = getFirstHeaderValue(headers.get('x-forwarded-proto'))?.toLowerCase() ?? null;
    return isTrustedProtocol(proto) ? proto : null;
  })();

  if (forwardedHost) {
    const appliedHost = applyForwardedHost(url, forwardedHost);
    if (appliedHost && forwardedPort && url.port.length === 0) {
      url.port = forwardedPort;
    }
  } else if (forwardedPort) {
    url.port = forwardedPort;
  }

  if (forwardedProto) {
    url.protocol = `${forwardedProto}:`;
  }

  return url;
}

export function normalizeExternalRequestUrl(request: MutableRequestUrl, headers: Headers, options?: ExternalRequestUrlOptions): string {
  const externalUrl = getExternalRequestUrl(request.url, headers, options).toString();

  if (externalUrl !== request.url) {
    Object.defineProperty(request.raw, 'url', {
      value: externalUrl,
      configurable: true,
      writable: true
    });
  }

  return externalUrl;
}

export function createExternalRequestUrlMiddleware(options?: ExternalRequestUrlOptions): MiddlewareHandler {
  return async (c, next) => {
    normalizeExternalRequestUrl(c.req, c.req.raw.headers, {
      ...options,
      remoteAddress: getRemoteAddressFromBindings(c.env)
    });
    await next();
  };
}
