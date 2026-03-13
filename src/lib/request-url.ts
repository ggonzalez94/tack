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
    const value = stripQuotes(rawValue.trim());

    if (key === 'host' && value.length > 0) {
      host = value;
    }

    if (key === 'proto') {
      const normalized = value.toLowerCase();
      if (isTrustedProtocol(normalized)) {
        proto = normalized;
      }
    }
  }

  return { host, proto };
}

export function getExternalRequestUrl(requestUrl: string, headers: Headers, trustProxy: boolean): URL {
  const url = new URL(requestUrl);
  if (!trustProxy) {
    return url;
  }

  const forwarded = parseForwardedHeader(headers.get('forwarded'));
  const forwardedHost = forwarded.host ?? getFirstHeaderValue(headers.get('x-forwarded-host'));
  const forwardedProto = forwarded.proto ?? (() => {
    const proto = getFirstHeaderValue(headers.get('x-forwarded-proto'))?.toLowerCase() ?? null;
    return isTrustedProtocol(proto) ? proto : null;
  })();

  if (forwardedHost) {
    url.host = forwardedHost;
  } else {
    const forwardedPort = getFirstHeaderValue(headers.get('x-forwarded-port'));
    if (forwardedPort && /^[0-9]+$/.test(forwardedPort)) {
      url.port = forwardedPort;
    }
  }

  if (forwardedProto) {
    url.protocol = `${forwardedProto}:`;
  }

  return url;
}

export function getExternalOrigin(requestUrl: string, headers: Headers, trustProxy: boolean): string {
  return getExternalRequestUrl(requestUrl, headers, trustProxy).origin;
}
