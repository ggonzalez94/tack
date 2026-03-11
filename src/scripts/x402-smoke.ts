import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { x402Client } from '@x402/core/client';
import { x402HTTPClient } from '@x402/core/http';
import { toClientEvmSigner } from '@x402/evm';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { createPublicClient, defineChain, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

interface SmokeConfig {
  apiBaseUrl: string;
  rpcUrl: string;
  chainId: number;
  expectedNetwork: `eip155:${number}`;
  payerPrivateKey: Hex;
  cid?: string;
  requestTimeoutMs: number;
}

interface UploadResponse {
  cid: string;
}

interface PinStatusResponse {
  requestid: string;
  status: string;
}

interface PaidRequestResult {
  acceptedRequirement: {
    network: string;
    amount: string;
    asset: string;
    payTo: string;
  };
  paymentSignatureHeaders: Record<string, string>;
  response: Response;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parsePositiveNumber(name: string, raw: string | undefined, fallback: number): number {
  const value = raw?.trim();
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function normalizeHexPrivateKey(raw: string): Hex {
  const normalized = raw.startsWith('0x') ? raw : `0x${raw}`;

  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error('SMOKE_PAYER_PRIVATE_KEY must be a 32-byte hex private key');
  }

  return normalized as Hex;
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '');
  const parsed = new URL(trimmed);

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error('SMOKE_API_BASE_URL must use http or https');
  }

  return parsed.toString().replace(/\/$/, '');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function parseConfig(): SmokeConfig {
  const chainId = parsePositiveNumber('SMOKE_CHAIN_ID', process.env.SMOKE_CHAIN_ID, 167000);
  const cid = process.env.SMOKE_CID?.trim();

  return {
    apiBaseUrl: normalizeBaseUrl(process.env.SMOKE_API_BASE_URL?.trim() ?? 'http://localhost:3000'),
    rpcUrl: requiredEnv('SMOKE_RPC_URL'),
    chainId,
    expectedNetwork: `eip155:${chainId}`,
    payerPrivateKey: normalizeHexPrivateKey(requiredEnv('SMOKE_PAYER_PRIVATE_KEY')),
    cid: cid && cid.length > 0 ? cid : undefined,
    requestTimeoutMs: parsePositiveNumber('SMOKE_REQUEST_TIMEOUT_MS', process.env.SMOKE_REQUEST_TIMEOUT_MS, 45000)
  };
}

async function payRequest(
  paymentClient: x402HTTPClient,
  url: string,
  initFactory: () => RequestInit,
  timeoutMs: number
): Promise<PaidRequestResult> {
  const unpaidResponse = await fetchWithTimeout(url, initFactory(), timeoutMs);
  const unpaidBodyText = await unpaidResponse.text();
  if (unpaidResponse.status !== 402) {
    throw new Error(`Expected 402 from unpaid ${url}, got ${unpaidResponse.status}. Body: ${unpaidBodyText}`);
  }

  const paymentRequired = paymentClient.getPaymentRequiredResponse((name) => unpaidResponse.headers.get(name));
  const acceptedRequirement = paymentRequired.accepts[0];

  if (!acceptedRequirement) {
    throw new Error(`Payment requirements were empty for ${url}`);
  }

  const paymentPayload = await paymentClient.createPaymentPayload(paymentRequired);
  const paymentSignatureHeaders = paymentClient.encodePaymentSignatureHeader(paymentPayload);
  const requestInit = initFactory();

  const response = await fetchWithTimeout(
    url,
    {
      ...requestInit,
      headers: {
        ...(requestInit.headers ?? {}),
        ...paymentSignatureHeaders
      }
    },
    timeoutMs
  );

  return {
    acceptedRequirement,
    paymentSignatureHeaders,
    response
  };
}

async function run(): Promise<void> {
  const config = parseConfig();
  const account = privateKeyToAccount(config.payerPrivateKey);
  const chain = defineChain({
    id: config.chainId,
    name: 'Smoke Chain',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    rpcUrls: {
      default: {
        http: [config.rpcUrl]
      }
    }
  });

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl)
  });

  const signer = toClientEvmSigner(account, publicClient);
  const paymentClient = new x402HTTPClient(
    new x402Client().register('eip155:*', new ExactEvmScheme(signer))
  );

  const smokeRunId = `x402-smoke-${Date.now()}`;
  const pinsUrl = `${config.apiBaseUrl}/pins`;
  const uploadUrl = `${config.apiBaseUrl}/upload`;

  let cid = config.cid;
  let uploadSummary: {
    cid: string;
    filename: string;
    bytes: number;
    transaction: string;
  } | null = null;

  if (!cid) {
    const tempDir = mkdtempSync(join(tmpdir(), 'tack-x402-smoke-'));
    const filename = `${smokeRunId}.txt`;
    const filePath = join(tempDir, filename);
    const fileContents = `Tack x402 smoke upload\nwallet=${account.address}\ntime=${new Date().toISOString()}\n`;
    writeFileSync(filePath, fileContents, 'utf8');
    const fileBytes = readFileSync(filePath);

    try {
      const uploadResult = await payRequest(
        paymentClient,
        uploadUrl,
        () => {
          const formData = new FormData();
          formData.append('file', new Blob([fileBytes], { type: 'text/plain' }), filename);

          return {
            method: 'POST',
            body: formData
          };
        },
        config.requestTimeoutMs
      );

      if (uploadResult.acceptedRequirement.network !== config.expectedNetwork) {
        throw new Error(
          `Expected upload payment network ${config.expectedNetwork} but got ${uploadResult.acceptedRequirement.network}`
        );
      }

      const uploadBodyText = await uploadResult.response.text();
      if (uploadResult.response.status !== 201) {
        throw new Error(`Expected 201 from paid POST /upload, got ${uploadResult.response.status}. Body: ${uploadBodyText}`);
      }

      let uploadBody: UploadResponse;
      try {
        uploadBody = JSON.parse(uploadBodyText) as UploadResponse;
      } catch {
        throw new Error(`Expected JSON upload response but got: ${uploadBodyText}`);
      }

      if (!uploadBody.cid) {
        throw new Error(`Upload response missing cid: ${uploadBodyText}`);
      }

      const uploadSettlement = paymentClient.getPaymentSettleResponse((name) => uploadResult.response.headers.get(name));
      if (!uploadSettlement.success || !uploadSettlement.transaction?.startsWith('0x')) {
        throw new Error(`Upload settlement failed: ${JSON.stringify(uploadSettlement)}`);
      }

      cid = uploadBody.cid;
      uploadSummary = {
        cid,
        filename,
        bytes: fileBytes.byteLength,
        transaction: uploadSettlement.transaction
      };
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  const pinRequestBody = {
    cid,
    name: `${smokeRunId}.txt`,
    meta: {
      smokeRunId
    }
  };

  const pinResult = await payRequest(
    paymentClient,
    pinsUrl,
    () => ({
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(pinRequestBody)
    }),
    config.requestTimeoutMs
  );

  if (pinResult.acceptedRequirement.network !== config.expectedNetwork) {
    throw new Error(
      `Expected pin payment network ${config.expectedNetwork} but got ${pinResult.acceptedRequirement.network}`
    );
  }

  const paidBodyText = await pinResult.response.text();
  if (pinResult.response.status !== 202) {
    throw new Error(`Expected 202 from paid POST /pins, got ${pinResult.response.status}. Body: ${paidBodyText}`);
  }

  let pinResponse: PinStatusResponse;
  try {
    pinResponse = JSON.parse(paidBodyText) as PinStatusResponse;
  } catch {
    throw new Error(`Expected JSON pin response but got: ${paidBodyText}`);
  }

  if (!pinResponse.requestid) {
    throw new Error(`Paid pin response missing requestid: ${paidBodyText}`);
  }

  const pinStatusResponse = await fetchWithTimeout(
    `${pinsUrl}/${pinResponse.requestid}`,
    {
      headers: pinResult.paymentSignatureHeaders
    },
    config.requestTimeoutMs
  );
  const pinStatusBodyText = await pinStatusResponse.text();
  if (pinStatusResponse.status !== 200) {
    throw new Error(`Expected 200 from GET /pins/:requestid, got ${pinStatusResponse.status}. Body: ${pinStatusBodyText}`);
  }

  let pinStatus: PinStatusResponse;
  try {
    pinStatus = JSON.parse(pinStatusBodyText) as PinStatusResponse;
  } catch {
    throw new Error(`Expected JSON pin status response but got: ${pinStatusBodyText}`);
  }

  if (pinStatus.status !== 'pinned') {
    throw new Error(`Expected pin status to be pinned, got ${pinStatus.status}. Body: ${pinStatusBodyText}`);
  }

  const settlement = paymentClient.getPaymentSettleResponse((name) => pinResult.response.headers.get(name));
  if (!settlement.success) {
    throw new Error(`Settlement did not succeed: ${JSON.stringify(settlement)}`);
  }

  if (settlement.network !== config.expectedNetwork) {
    throw new Error(
      `Expected settlement network ${config.expectedNetwork} but got ${settlement.network}`
    );
  }

  const settlementPayer = settlement.payer?.toLowerCase();
  if (settlementPayer && settlementPayer !== account.address.toLowerCase()) {
    throw new Error(
      `Expected settlement payer ${account.address.toLowerCase()} but got ${settlementPayer}`
    );
  }

  if (!settlement.transaction || !settlement.transaction.startsWith('0x')) {
    throw new Error(`Settlement missing transaction hash: ${JSON.stringify(settlement)}`);
  }

  const retrievalResponse = await fetchWithTimeout(
    `${config.apiBaseUrl}/ipfs/${cid}`,
    {
      method: 'GET'
    },
    config.requestTimeoutMs
  );
  const retrievalBody = await retrievalResponse.arrayBuffer();
  if (retrievalResponse.status !== 200) {
    throw new Error(`Expected 200 from GET /ipfs/:cid, got ${retrievalResponse.status}`);
  }
  if (retrievalBody.byteLength === 0) {
    throw new Error('Retrieved content was unexpectedly empty');
  }

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        flow: uploadSummary ? 'upload -> pin -> retrieve' : 'pin existing cid -> retrieve',
        upload: uploadSummary,
        pin: {
          requestId: pinStatus.requestid,
          cid,
          status: pinStatus.status,
          paymentRequired: {
            network: pinResult.acceptedRequirement.network,
            amount: pinResult.acceptedRequirement.amount,
            asset: pinResult.acceptedRequirement.asset,
            payTo: pinResult.acceptedRequirement.payTo
          },
          settlement: {
            transaction: settlement.transaction,
            network: settlement.network,
            payer: settlement.payer,
            success: settlement.success
          }
        },
        retrieval: {
          cid,
          bytes: retrievalBody.byteLength,
          etag: retrievalResponse.headers.get('etag'),
          contentType: retrievalResponse.headers.get('content-type')
        }
      },
      null,
      2
    )
  );
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[x402-smoke] ${message}`);
  process.exitCode = 1;
});
