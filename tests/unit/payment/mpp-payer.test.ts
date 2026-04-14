import { describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, pad, type Log } from 'viem';
import { Abis } from 'viem/tempo';
import { Receipt } from 'mppx';
import {
  createTempoPayerResolver,
  extractReceiptHash,
  resolvePayerFromTransactionHash,
  type FetchTempoReceipt,
  type TempoPayerContext,
  type TempoReceiptLike
} from '../../../src/services/payment/mpp-payer';

const TEMPO_CURRENCY = '0x20C000000000000000000000b9537d11c60E8b50' as `0x${string}`;
const RECIPIENT = '0x1111111111111111111111111111111111111111' as `0x${string}`;
const PAYER_REAL = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as `0x${string}`;
const PAYER_OTHER = '0xcccccccccccccccccccccccccccccccccccccccc' as `0x${string}`;
const TX_HASH = ('0x' + 'de'.repeat(32)) as `0x${string}`;

function buildTransferLog(overrides: {
  address: `0x${string}`;
  from: `0x${string}`;
  to: `0x${string}`;
  amount: bigint;
}): Log {
  const topics = encodeEventTopics({
    abi: Abis.tip20,
    eventName: 'Transfer',
    args: { from: overrides.from, to: overrides.to },
  });

  const data = encodeAbiParameters([{ type: 'uint256' }], [overrides.amount]);

  return {
    address: overrides.address,
    topics,
    data,
    blockHash: pad('0x01', { size: 32 }),
    blockNumber: 1n,
    logIndex: 0,
    removed: false,
    transactionHash: TX_HASH,
    transactionIndex: 0,
  } as unknown as Log;
}

function makeFetchReceipt(
  logs: Log[],
  status: 'success' | 'reverted' = 'success'
): FetchTempoReceipt {
  return vi.fn((hash: `0x${string}`) => {
    expect(hash).toBe(TX_HASH);
    const receipt: TempoReceiptLike = { status, logs };
    return Promise.resolve(receipt);
  });
}

function buildReceiptHeader(hash: `0x${string}`): string {
  const receipt = Receipt.from({
    method: 'tempo',
    reference: hash,
    status: 'success',
    timestamp: new Date().toISOString(),
  });
  return Receipt.serialize(receipt);
}

function makeWithReceipt(header: string) {
  return (res: Response) => {
    const headers = new Headers(res.headers);
    headers.set('Payment-Receipt', header);
    return new Response(res.body, { status: res.status, headers });
  };
}

const context: TempoPayerContext = {
  currency: TEMPO_CURRENCY,
  recipient: RECIPIENT,
  amount: '1000',
};

describe('extractReceiptHash', () => {
  it('pulls the tx hash out of the mppx Payment-Receipt header', () => {
    const withReceipt = makeWithReceipt(buildReceiptHeader(TX_HASH));
    expect(extractReceiptHash(withReceipt)).toBe(TX_HASH);
  });

  it('throws when the header is missing', () => {
    const withReceipt = (res: Response) => res;
    expect(() => extractReceiptHash(withReceipt)).toThrow(/Payment-Receipt/);
  });

  it('throws when the reference is not a 32-byte hash', () => {
    const receipt = Receipt.from({
      method: 'tempo',
      reference: '0xdeadbeef',
      status: 'success',
      timestamp: new Date().toISOString(),
    });
    const withReceipt = makeWithReceipt(Receipt.serialize(receipt));
    expect(() => extractReceiptHash(withReceipt)).toThrow(/transaction hash/);
  });
});

describe('resolvePayerFromTransactionHash', () => {
  it('returns the from address of the matching TIP-20 Transfer log', async () => {
    const fetchReceipt = makeFetchReceipt([
      buildTransferLog({ address: TEMPO_CURRENCY, from: PAYER_REAL, to: RECIPIENT, amount: 1000n }),
    ]);

    const payer = await resolvePayerFromTransactionHash(fetchReceipt, TX_HASH, context);
    expect(payer).toBe(PAYER_REAL.toLowerCase());
  });

  it('ignores transfers on other currencies in the same receipt', async () => {
    const fetchReceipt = makeFetchReceipt([
      buildTransferLog({
        address: '0x9999999999999999999999999999999999999999',
        from: PAYER_OTHER,
        to: RECIPIENT,
        amount: 1000n,
      }),
      buildTransferLog({ address: TEMPO_CURRENCY, from: PAYER_REAL, to: RECIPIENT, amount: 1000n }),
    ]);

    const payer = await resolvePayerFromTransactionHash(fetchReceipt, TX_HASH, context);
    expect(payer).toBe(PAYER_REAL.toLowerCase());
  });

  it('ignores transfers to other recipients', async () => {
    const fetchReceipt = makeFetchReceipt([
      buildTransferLog({
        address: TEMPO_CURRENCY,
        from: PAYER_OTHER,
        to: '0x2222222222222222222222222222222222222222',
        amount: 1000n,
      }),
      buildTransferLog({ address: TEMPO_CURRENCY, from: PAYER_REAL, to: RECIPIENT, amount: 1000n }),
    ]);

    const payer = await resolvePayerFromTransactionHash(fetchReceipt, TX_HASH, context);
    expect(payer).toBe(PAYER_REAL.toLowerCase());
  });

  it('ignores transfers with a different amount', async () => {
    const fetchReceipt = makeFetchReceipt([
      buildTransferLog({ address: TEMPO_CURRENCY, from: PAYER_OTHER, to: RECIPIENT, amount: 500n }),
      buildTransferLog({ address: TEMPO_CURRENCY, from: PAYER_REAL, to: RECIPIENT, amount: 1000n }),
    ]);

    const payer = await resolvePayerFromTransactionHash(fetchReceipt, TX_HASH, context);
    expect(payer).toBe(PAYER_REAL.toLowerCase());
  });

  it('throws when no matching Transfer event is present', async () => {
    const fetchReceipt = makeFetchReceipt([
      buildTransferLog({
        address: TEMPO_CURRENCY,
        from: PAYER_REAL,
        to: '0x2222222222222222222222222222222222222222',
        amount: 1000n,
      }),
    ]);

    await expect(resolvePayerFromTransactionHash(fetchReceipt, TX_HASH, context)).rejects.toThrow(
      /No matching TIP-20 Transfer event/
    );
  });

  it('throws when the tempo transaction reverted', async () => {
    const fetchReceipt = makeFetchReceipt([], 'reverted');

    await expect(resolvePayerFromTransactionHash(fetchReceipt, TX_HASH, context)).rejects.toThrow(
      /did not succeed on-chain/
    );
  });
});

describe('createTempoPayerResolver', () => {
  it('combines header extraction with on-chain lookup', async () => {
    const fetchReceipt = makeFetchReceipt([
      buildTransferLog({ address: TEMPO_CURRENCY, from: PAYER_REAL, to: RECIPIENT, amount: 1000n }),
    ]);

    const resolver = createTempoPayerResolver({
      fetchReceipt,
      getContext: () => context,
    });

    const withReceipt = makeWithReceipt(buildReceiptHeader(TX_HASH));
    const request = new Request('http://localhost/pins', { method: 'POST' });
    const payer = await resolver(request, withReceipt);
    expect(payer).toBe(PAYER_REAL.toLowerCase());
  });
});
