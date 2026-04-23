import type Database from 'better-sqlite3';

interface DbWalletAuthChallengeRow {
  nonce_hash: string;
  address: string;
  network: string;
  chain_id: number;
  domain: string;
  uri: string;
  message: string;
  expires_at: string;
  consumed_at: string | null;
  created: string;
}

export interface WalletAuthChallengeRecord {
  nonceHash: string;
  address: string;
  network: string;
  chainId: number;
  domain: string;
  uri: string;
  message: string;
  expiresAt: string;
  consumedAt: string | null;
  created: string;
}

export class WalletAuthChallengeRepository {
  constructor(private readonly db: Database.Database) {}

  create(record: WalletAuthChallengeRecord): void {
    this.db
      .prepare(`
        INSERT INTO wallet_auth_challenges (
          nonce_hash, address, network, chain_id, domain, uri, message, expires_at, consumed_at, created
        ) VALUES (
          @nonceHash, @address, @network, @chainId, @domain, @uri, @message, @expiresAt, @consumedAt, @created
        )
      `)
      .run(record);
  }

  findByNonceHash(nonceHash: string): WalletAuthChallengeRecord | null {
    const row = this.db
      .prepare(`
        SELECT nonce_hash, address, network, chain_id, domain, uri, message, expires_at, consumed_at, created
        FROM wallet_auth_challenges
        WHERE nonce_hash = ?
      `)
      .get(nonceHash) as DbWalletAuthChallengeRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  consume(nonceHash: string, consumedAt: string): boolean {
    return this.db
      .prepare(`
        UPDATE wallet_auth_challenges
        SET consumed_at = ?
        WHERE nonce_hash = ? AND consumed_at IS NULL
      `)
      .run(consumedAt, nonceHash).changes > 0;
  }

  deleteExpired(now: string): number {
    return this.db
      .prepare('DELETE FROM wallet_auth_challenges WHERE expires_at <= ?')
      .run(now).changes;
  }

  private mapRow(row: DbWalletAuthChallengeRow): WalletAuthChallengeRecord {
    return {
      nonceHash: row.nonce_hash,
      address: row.address,
      network: row.network,
      chainId: row.chain_id,
      domain: row.domain,
      uri: row.uri,
      message: row.message,
      expiresAt: row.expires_at,
      consumedAt: row.consumed_at,
      created: row.created
    };
  }
}
