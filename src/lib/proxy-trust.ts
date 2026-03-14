import { isIP } from 'node:net';

function normalizeIpAddress(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }

  const withoutZone = trimmed.split('%', 1)[0] ?? trimmed;
  const ipv4MappedPrefix = '::ffff:';
  const normalized = withoutZone.startsWith(ipv4MappedPrefix)
    ? withoutZone.slice(ipv4MappedPrefix.length)
    : withoutZone;

  return isIP(normalized) === 0 ? null : normalized;
}

function parseIpv4Address(value: string): Uint8Array | null {
  const parts = value.split('.');
  if (parts.length !== 4) {
    return null;
  }

  const bytes = new Uint8Array(4);
  for (const [index, part] of parts.entries()) {
    if (!/^[0-9]{1,3}$/.test(part)) {
      return null;
    }

    const parsed = Number(part);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
      return null;
    }

    bytes[index] = parsed;
  }

  return bytes;
}

function parseIpv6Address(value: string): Uint8Array | null {
  const normalized = value.toLowerCase();
  const doubleColonIndex = normalized.indexOf('::');
  if (doubleColonIndex !== normalized.lastIndexOf('::')) {
    return null;
  }

  const [headRaw, tailRaw = ''] = normalized.split('::', 2);
  const head = headRaw.length > 0 ? headRaw.split(':') : [];
  const tail = tailRaw.length > 0 ? tailRaw.split(':') : [];
  const expandIpv4Tail = (parts: string[]): string[] | null => {
    if (parts.length === 0) {
      return parts;
    }

    const last = parts[parts.length - 1];
    if (!last || !last.includes('.')) {
      return parts;
    }

    const ipv4Bytes = parseIpv4Address(last);
    if (!ipv4Bytes) {
      return null;
    }

    return [
      ...parts.slice(0, -1),
      ((ipv4Bytes[0] << 8) | ipv4Bytes[1]).toString(16),
      ((ipv4Bytes[2] << 8) | ipv4Bytes[3]).toString(16)
    ];
  };

  const expandedHead = expandIpv4Tail(head);
  const expandedTail = expandIpv4Tail(tail);
  if (!expandedHead || !expandedTail) {
    return null;
  }

  let parts: string[];
  if (doubleColonIndex >= 0) {
    const missingGroups = 8 - (expandedHead.length + expandedTail.length);
    if (missingGroups < 1) {
      return null;
    }

    parts = [
      ...expandedHead,
      ...Array.from({ length: missingGroups }, () => '0'),
      ...expandedTail
    ];
  } else {
    parts = [...expandedHead, ...expandedTail];
    if (parts.length !== 8) {
      return null;
    }
  }

  const bytes = new Uint8Array(16);
  for (const [index, part] of parts.entries()) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) {
      return null;
    }

    const parsed = Number.parseInt(part, 16);
    bytes[index * 2] = (parsed >> 8) & 0xff;
    bytes[index * 2 + 1] = parsed & 0xff;
  }

  return bytes;
}

function parseIpAddress(value: string): Uint8Array | null {
  if (isIP(value) === 4) {
    return parseIpv4Address(value);
  }

  if (isIP(value) === 6) {
    return parseIpv6Address(value);
  }

  return null;
}

function cidrToBytes(value: string): { address: Uint8Array; prefixLength: number } | null {
  const [rawAddress, rawPrefix] = value.split('/', 2);
  const normalizedAddress = normalizeIpAddress(rawAddress);
  if (!normalizedAddress) {
    return null;
  }

  const address = parseIpAddress(normalizedAddress);
  if (!address) {
    return null;
  }

  const maxPrefixLength = address.length * 8;
  const prefixLength = rawPrefix === undefined
    ? maxPrefixLength
    : Number.parseInt(rawPrefix, 10);
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > maxPrefixLength) {
    return null;
  }

  return {
    address,
    prefixLength
  };
}

function bytesMatchPrefix(address: Uint8Array, candidate: Uint8Array, prefixLength: number): boolean {
  if (address.length !== candidate.length) {
    return false;
  }

  const fullBytes = Math.floor(prefixLength / 8);
  const remainingBits = prefixLength % 8;

  for (let index = 0; index < fullBytes; index += 1) {
    if (address[index] !== candidate[index]) {
      return false;
    }
  }

  if (remainingBits === 0) {
    return true;
  }

  const mask = 0xff << (8 - remainingBits);
  return (address[fullBytes] & mask) === (candidate[fullBytes] & mask);
}

export function isTrustedProxy(remoteAddress: string | null | undefined, trustedProxyCidrs: string[]): boolean {
  const normalizedRemoteAddress = normalizeIpAddress(remoteAddress);
  if (!normalizedRemoteAddress || trustedProxyCidrs.length === 0) {
    return false;
  }

  const remoteBytes = parseIpAddress(normalizedRemoteAddress);
  if (!remoteBytes) {
    return false;
  }

  for (const cidr of trustedProxyCidrs) {
    const parsedCidr = cidrToBytes(cidr.trim());
    if (!parsedCidr) {
      continue;
    }

    if (bytesMatchPrefix(parsedCidr.address, remoteBytes, parsedCidr.prefixLength)) {
      return true;
    }
  }

  return false;
}
