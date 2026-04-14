import { isAddressEqual, parseEventLogs, type TransactionReceipt } from 'viem';
import { Abis } from 'viem/tempo';
import { Receipt } from 'mppx';

/**
 * Verified on-chain payer extraction for MPP/Tempo payments.
 *
 * The MPP credential's optional `source` DID is *self-asserted* by the
 * client — it is written into the credential as opaque metadata and is
 * neither signed into the payment proof nor verified by the mppx SDK
 * (see `mppx/Credential.ts` and `mppx/tempo/server/Charge.ts`). Trusting
 * `source` for ownership allows a paying attacker to forge
 * `did:pkh:eip155:4217:<victim>` and mint owner-scoped JWTs for the
 * victim.
 *
 * This module derives the payer address from the verified on-chain
 * `Transfer`/`TransferWithMemo` event emitted by the charge transaction.
 * mppx broadcasts + confirms the transaction during `verify()` (we keep
 * `waitForConfirmation: true`, the default) and exposes the transaction
 * hash through the `Payment-Receipt` header's `reference` field. We then
 * re-read the receipt from Tempo RPC and locate the Transfer log that
 * matches the expected `(currency, recipient, amount)` tuple. The event's
 * `from` field is the EOA that authorized the spend, which is the real
 * payer regardless of any fee-payer relaying.
 */

export interface TempoPayerContext {
  /** TIP-20 currency address the charge was settled in (e.g. USDC.e). */
  currency: `0x${string}`;
  /** Recipient wallet expected by the challenge. */
  recipient: `0x${string}`;
  /** Expected transfer amount in the asset's smallest unit (string for bigint safety). */
  amount: string;
}

/**
 * Minimal receipt shape the payer resolver needs. Compatible with
 * `viem.TransactionReceipt` but narrows the surface so test doubles
 * don't have to fabricate the full viem receipt.
 */
export interface TempoReceiptLike {
  status: 'success' | 'reverted';
  logs: TransactionReceipt['logs'];
}

export type FetchTempoReceipt = (hash: `0x${string}`) => Promise<TempoReceiptLike>;

/**
 * Decode the `Payment-Receipt` header value that mppx writes onto
 * a successful charge response. Returns the transaction hash that
 * actually settled the payment on Tempo.
 */
export function extractReceiptHash(withReceipt: (response: Response) => Response): `0x${string}` {
  const probe = withReceipt(new Response(null));
  const header = probe.headers.get('Payment-Receipt');
  if (!header) {
    throw new Error('mppx charge response is missing the Payment-Receipt header');
  }

  const receipt = Receipt.deserialize(header);
  if (receipt.status !== 'success') {
    throw new Error(`mppx charge reported status ${String(receipt.status)}`);
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(receipt.reference)) {
    throw new Error(`mppx receipt reference is not a transaction hash: ${receipt.reference}`);
  }

  return receipt.reference as `0x${string}`;
}

/**
 * Fetch the on-chain receipt for a Tempo transaction hash and return
 * the `from` address of the matching TIP-20 Transfer event.
 */
export async function resolvePayerFromTransactionHash(
  fetchReceipt: FetchTempoReceipt,
  txHash: `0x${string}`,
  context: TempoPayerContext
): Promise<`0x${string}`> {
  const receipt = await fetchReceipt(txHash);

  if (receipt.status !== 'success') {
    throw new Error(`Tempo transaction ${txHash} did not succeed on-chain (status=${String(receipt.status)})`);
  }

  const transferLogs = parseEventLogs({
    abi: Abis.tip20,
    eventName: 'Transfer',
    logs: receipt.logs,
  });

  const memoLogs = parseEventLogs({
    abi: Abis.tip20,
    eventName: 'TransferWithMemo',
    logs: receipt.logs,
  });

  const expectedAmount = BigInt(context.amount);

  const candidates = [...transferLogs, ...memoLogs];
  const match = candidates.find((log) => {
    const args = log.args as { from: `0x${string}`; to: `0x${string}`; amount: bigint };
    return (
      isAddressEqual(log.address, context.currency) &&
      isAddressEqual(args.to, context.recipient) &&
      args.amount === expectedAmount
    );
  });

  if (!match) {
    throw new Error(
      `No matching TIP-20 Transfer event in receipt ${txHash} ` +
        `(currency=${context.currency}, recipient=${context.recipient}, amount=${context.amount})`
    );
  }

  const from = (match.args as { from: `0x${string}` }).from;
  return from.toLowerCase() as `0x${string}`;
}

export interface TempoPayerResolverConfig {
  fetchReceipt: FetchTempoReceipt;
  /**
   * Resolves the on-chain payment parameters for a given request so we
   * can locate the right Transfer event in the receipt. Must match the
   * values encoded into the challenge that the client paid against.
   */
  getContext: (request: Request) => TempoPayerContext | Promise<TempoPayerContext>;
}

export type ResolvePayerFn = (
  request: Request,
  withReceipt: (response: Response) => Response
) => Promise<string>;

/**
 * Build an async payer resolver that the MPP middleware can call after
 * mppx has verified + settled a charge.
 */
export function createTempoPayerResolver(config: TempoPayerResolverConfig): ResolvePayerFn {
  return async (request, withReceipt) => {
    const txHash = extractReceiptHash(withReceipt);
    const context = await config.getContext(request);
    return resolvePayerFromTransactionHash(config.fetchReceipt, txHash, context);
  };
}

