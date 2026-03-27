export function extractPaymentAuthorizationCredential(authHeader: string | null | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const trimmed = authHeader.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const match = /^payment\s+(.+)$/i.exec(trimmed);
  if (!match) {
    return null;
  }

  const credential = match[1]?.trim();
  return credential ? credential : null;
}

export function extractIpfsCidFromPath(path: string): string | null {
  const prefix = '/ipfs/';
  if (!path.startsWith(prefix)) {
    return null;
  }

  const cid = path.slice(prefix.length);
  if (cid.length === 0 || cid.includes('/')) {
    return null;
  }

  return cid;
}
