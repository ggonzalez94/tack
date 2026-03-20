import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export interface WalletAuthConfig {
  secret: string;
  issuer: string;
  audience: string;
  ttlSeconds: number;
}

export interface WalletAuthToken {
  token: string;
  expiresAt: string;
}

export interface RequestOwnerIdentity {
  wallet: string | null;
  authError: string | null;
  paidWallet: string | null;
}

export const WALLET_AUTH_TOKEN_RESPONSE_HEADER = 'x-wallet-auth-token';
export const WALLET_AUTH_TOKEN_EXPIRES_AT_RESPONSE_HEADER = 'x-wallet-auth-token-expires-at';

const MAX_WALLET_AUTH_CLOCK_SKEW_SECONDS = 60;

export function normalizeWalletAddress(raw: string | undefined): string | null {
  if (!raw) {
    return null;
  }

  const trimmed = raw.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    return null;
  }

  return trimmed.toLowerCase();
}

export function toBase64Url(value: Buffer): string {
  return value
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function fromBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9\-_]+$/.test(value)) {
    return null;
  }

  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

  try {
    return Buffer.from(padded, 'base64');
  } catch {
    return null;
  }
}

export function getWalletAuthToken(headers: Headers): { token: string | null; malformed: boolean } {
  const directToken = headers.get('x-wallet-auth-token');
  if (directToken !== null) {
    const token = directToken.trim();
    return {
      token: token.length > 0 ? token : null,
      malformed: token.length === 0
    };
  }

  const authorization = headers.get('authorization');
  if (authorization === null) {
    return { token: null, malformed: false };
  }

  const trimmed = authorization.trim();
  if (trimmed.length === 0) {
    return { token: null, malformed: true };
  }

  // Recognize Payment scheme (MPP credential) — not malformed, handled elsewhere
  if (trimmed.startsWith('Payment ')) {
    return { token: null, malformed: false };
  }

  if (!trimmed.toLowerCase().startsWith('bearer ')) {
    return { token: null, malformed: true };
  }

  const token = trimmed.slice(7).trim();
  return {
    token: token.length > 0 ? token : null,
    malformed: token.length === 0
  };
}

export function verifyWalletAuthToken(token: string, config: WalletAuthConfig): { wallet: string | null; error: string | null } {
  const segments = token.split('.');
  if (segments.length !== 3) {
    return { wallet: null, error: 'invalid wallet auth token' };
  }

  const [headerSegment, payloadSegment, signatureSegment] = segments;
  const headerBuffer = fromBase64Url(headerSegment);
  const payloadBuffer = fromBase64Url(payloadSegment);

  if (!headerBuffer || !payloadBuffer || signatureSegment.length === 0) {
    return { wallet: null, error: 'invalid wallet auth token' };
  }

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;

  try {
    header = JSON.parse(headerBuffer.toString('utf8')) as Record<string, unknown>;
    payload = JSON.parse(payloadBuffer.toString('utf8')) as Record<string, unknown>;
  } catch {
    return { wallet: null, error: 'invalid wallet auth token' };
  }

  if (header.alg !== 'HS256') {
    return { wallet: null, error: 'unsupported wallet auth token algorithm' };
  }

  const expectedSignature = toBase64Url(
    createHmac('sha256', config.secret)
      .update(`${headerSegment}.${payloadSegment}`)
      .digest()
  );
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const actualBuffer = Buffer.from(signatureSegment, 'utf8');

  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { wallet: null, error: 'invalid wallet auth token signature' };
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issuedAt = typeof payload.iat === 'number' && Number.isFinite(payload.iat)
    ? Math.trunc(payload.iat)
    : null;
  if (issuedAt === null) {
    return { wallet: null, error: 'wallet auth token issued-at is invalid' };
  }

  if (issuedAt > nowSeconds + MAX_WALLET_AUTH_CLOCK_SKEW_SECONDS) {
    return { wallet: null, error: 'wallet auth token issued-at is invalid' };
  }

  const expiresAt = typeof payload.exp === 'number' && Number.isFinite(payload.exp)
    ? Math.trunc(payload.exp)
    : null;
  if (expiresAt === null) {
    return { wallet: null, error: 'wallet auth token expiration is required' };
  }

  if (expiresAt <= issuedAt) {
    return { wallet: null, error: 'wallet auth token expiration is invalid' };
  }

  if (expiresAt - issuedAt > config.ttlSeconds) {
    return { wallet: null, error: 'wallet auth token lifetime exceeds maximum' };
  }

  if (nowSeconds >= expiresAt) {
    return { wallet: null, error: 'wallet auth token has expired' };
  }

  if (typeof payload.nbf === 'number' && Number.isFinite(payload.nbf) && nowSeconds < payload.nbf) {
    return { wallet: null, error: 'wallet auth token is not active yet' };
  }

  if (payload.iss !== config.issuer) {
    return { wallet: null, error: 'wallet auth token issuer is invalid' };
  }

  const audience = payload.aud;
  const validAudience = typeof audience === 'string'
    ? audience === config.audience
    : Array.isArray(audience)
      ? audience.includes(config.audience)
      : false;
  if (!validAudience) {
    return { wallet: null, error: 'wallet auth token audience is invalid' };
  }

  const wallet = normalizeWalletAddress(
    typeof payload.sub === 'string'
      ? payload.sub
      : typeof payload.wallet === 'string'
        ? payload.wallet
        : undefined
  );

  if (!wallet) {
    return { wallet: null, error: 'wallet auth token subject is invalid' };
  }

  return { wallet, error: null };
}

export function createWalletAuthToken(walletAddress: string, config: WalletAuthConfig): WalletAuthToken {
  const wallet = normalizeWalletAddress(walletAddress);
  if (!wallet) {
    throw new Error('wallet auth token wallet address is invalid');
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + config.ttlSeconds;
  const header = toBase64Url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8'));
  const payload = toBase64Url(
    Buffer.from(
      JSON.stringify({
        sub: wallet,
        iss: config.issuer,
        aud: config.audience,
        iat: issuedAt,
        nbf: issuedAt,
        exp: expiresAt,
        jti: randomUUID()
      }),
      'utf8'
    )
  );
  const signature = toBase64Url(
    createHmac('sha256', config.secret)
      .update(`${header}.${payload}`)
      .digest()
  );

  return {
    token: `${header}.${payload}.${signature}`,
    expiresAt: new Date(expiresAt * 1000).toISOString()
  };
}
