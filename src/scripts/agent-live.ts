import { x402Client } from '@x402/core/client';
import { x402HTTPClient } from '@x402/core/http';
import { toClientEvmSigner } from '@x402/evm';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { createPublicClient, defineChain, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

interface AgentConfig {
  agentCardUrl: string;
  rpcUrl: string;
  chainId: number;
  expectedNetwork: `eip155:${number}`;
  payerPrivateKey: Hex;
  requestTimeoutMs: number;
}

interface AgentCard {
  protocol: string;
  name?: string;
  endpoint?: string;
  capabilities?: {
    pinningApi?: {
      endpoints?: string[];
    };
  };
  pricing?: {
    pinning?: {
      protocol?: string;
      network?: string;
      asset?: string;
      baseUsd?: number;
      perMbUsd?: number;
      maxUsd?: number;
    } | null;
  };
}

interface UploadResponse {
  cid: string;
}

interface PinStatusResponse {
  requestid: string;
  status: string;
  created?: string;
  pin?: {
    cid?: string;
    name?: string;
    meta?: Record<string, string>;
  };
}

interface PinListResponse {
  count: number;
  results: PinStatusResponse[];
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
    throw new Error('AGENT_PAYER_PRIVATE_KEY must be a 32-byte hex private key');
  }

  return normalized as Hex;
}

function normalizeUrl(name: string, raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '');
  const parsed = new URL(trimmed);

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(`${name} must use http or https`);
  }

  return parsed.toString();
}

function parseConfig(): AgentConfig {
  const chainId = parsePositiveNumber(
    'AGENT_CHAIN_ID',
    process.env.AGENT_CHAIN_ID ?? process.env.SMOKE_CHAIN_ID,
    167000
  );
  const agentCardUrl = normalizeUrl(
    'AGENT_CARD_URL',
    process.env.AGENT_CARD_URL?.trim() ?? 'http://localhost:3000/.well-known/agent.json'
  );

  return {
    agentCardUrl,
    rpcUrl: normalizeUrl('AGENT_RPC_URL', process.env.AGENT_RPC_URL?.trim() ?? requiredEnv('SMOKE_RPC_URL')),
    chainId,
    expectedNetwork: `eip155:${chainId}`,
    payerPrivateKey: normalizeHexPrivateKey(
      process.env.AGENT_PAYER_PRIVATE_KEY?.trim() ?? requiredEnv('SMOKE_PAYER_PRIVATE_KEY')
    ),
    requestTimeoutMs: parsePositiveNumber(
      'AGENT_REQUEST_TIMEOUT_MS',
      process.env.AGENT_REQUEST_TIMEOUT_MS ?? process.env.SMOKE_REQUEST_TIMEOUT_MS,
      45000
    )
  };
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

function resolveEffectiveApiBaseUrl(agentCardUrl: string, agentCard: AgentCard): {
  advertisedEndpoint: string | null;
  effectiveApiBaseUrl: string;
  endpointAdjusted: boolean;
} {
  const discoveryUrl = new URL(agentCardUrl);
  const advertisedEndpoint = typeof agentCard.endpoint === 'string' && agentCard.endpoint.length > 0
    ? new URL(agentCard.endpoint, discoveryUrl).toString().replace(/\/$/, '')
    : null;

  if (!advertisedEndpoint) {
    return {
      advertisedEndpoint: null,
      effectiveApiBaseUrl: discoveryUrl.origin,
      endpointAdjusted: false
    };
  }

  const advertisedUrl = new URL(advertisedEndpoint);
  if (discoveryUrl.protocol === 'https:' && advertisedUrl.protocol === 'http:' && discoveryUrl.host === advertisedUrl.host) {
    const upgradedPath = advertisedUrl.pathname.replace(/\/$/, '');
    return {
      advertisedEndpoint,
      effectiveApiBaseUrl: discoveryUrl.origin + upgradedPath,
      endpointAdjusted: true
    };
  }

  return {
    advertisedEndpoint,
    effectiveApiBaseUrl: advertisedEndpoint,
    endpointAdjusted: false
  };
}

async function waitForPinnedStatus(
  statusUrl: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<PinStatusResponse> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus: string | null = null;

  while (Date.now() < deadline) {
    const response = await fetchWithTimeout(statusUrl, { headers }, timeoutMs);
    const bodyText = await response.text();
    if (response.status !== 200) {
      throw new Error(`Expected 200 from ${statusUrl}, got ${response.status}. Body: ${bodyText}`);
    }

    const status = JSON.parse(bodyText) as PinStatusResponse;
    lastStatus = status.status;
    if (status.status === 'pinned') {
      return status;
    }

    if (status.status === 'failed') {
      throw new Error(`Pin transitioned to failed. Body: ${bodyText}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`Timed out waiting for pin to become pinned. Last status: ${lastStatus ?? 'unknown'}`);
}

async function run(): Promise<void> {
  const config = parseConfig();
  const account = privateKeyToAccount(config.payerPrivateKey);
  const chain = defineChain({
    id: config.chainId,
    name: 'Agent Live Chain',
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

  const agentCardResponse = await fetchWithTimeout(config.agentCardUrl, { method: 'GET' }, config.requestTimeoutMs);
  const agentCardText = await agentCardResponse.text();
  if (agentCardResponse.status !== 200) {
    throw new Error(`Expected 200 from agent card endpoint, got ${agentCardResponse.status}. Body: ${agentCardText}`);
  }

  const agentCard = JSON.parse(agentCardText) as AgentCard;
  if (agentCard.protocol !== 'a2a') {
    throw new Error(`Expected agent card protocol "a2a", got ${agentCard.protocol}`);
  }

  const { advertisedEndpoint, effectiveApiBaseUrl, endpointAdjusted } = resolveEffectiveApiBaseUrl(
    config.agentCardUrl,
    agentCard
  );
  const flowId = `trusted-agents-live-${Date.now()}`;
  const filename = `${flowId}.txt`;
  const artifactContents = [
    'trusted-agents live artifact',
    `wallet=${account.address}`,
    `flow=${flowId}`,
    `time=${new Date().toISOString()}`,
    'note=agent discovered Tack, paid to upload, pinned content, listed owner pins, and retrieved the artifact.'
  ].join('\n');
  const artifactBytes = new TextEncoder().encode(`${artifactContents}\n`);

  const uploadResult = await payRequest(
    paymentClient,
    `${effectiveApiBaseUrl}/upload`,
    () => {
      const formData = new FormData();
      formData.append('file', new Blob([artifactBytes], { type: 'text/plain' }), filename);

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

  const uploadBody = JSON.parse(uploadBodyText) as UploadResponse;
  if (!uploadBody.cid) {
    throw new Error(`Upload response missing cid: ${uploadBodyText}`);
  }

  const uploadSettlement = paymentClient.getPaymentSettleResponse((name) => uploadResult.response.headers.get(name));
  if (!uploadSettlement.success || !uploadSettlement.transaction?.startsWith('0x')) {
    throw new Error(`Upload settlement failed: ${JSON.stringify(uploadSettlement)}`);
  }

  const pinBody = {
    cid: uploadBody.cid,
    name: filename,
    meta: {
      flowId,
      useCase: 'trusted-agents-live-test',
      createdBy: 'codex-agent-live'
    }
  };

  const pinResult = await payRequest(
    paymentClient,
    `${effectiveApiBaseUrl}/pins`,
    () => ({
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(pinBody)
    }),
    config.requestTimeoutMs
  );

  if (pinResult.acceptedRequirement.network !== config.expectedNetwork) {
    throw new Error(
      `Expected pin payment network ${config.expectedNetwork} but got ${pinResult.acceptedRequirement.network}`
    );
  }

  const pinBodyText = await pinResult.response.text();
  if (pinResult.response.status !== 202) {
    throw new Error(`Expected 202 from paid POST /pins, got ${pinResult.response.status}. Body: ${pinBodyText}`);
  }

  const pinResponse = JSON.parse(pinBodyText) as PinStatusResponse;
  if (!pinResponse.requestid) {
    throw new Error(`Paid pin response missing requestid: ${pinBodyText}`);
  }

  const pinSettlement = paymentClient.getPaymentSettleResponse((name) => pinResult.response.headers.get(name));
  if (!pinSettlement.success || !pinSettlement.transaction?.startsWith('0x')) {
    throw new Error(`Pin settlement failed: ${JSON.stringify(pinSettlement)}`);
  }

  const walletAuthToken = pinResult.response.headers.get('x-wallet-auth-token');
  if (!walletAuthToken) {
    throw new Error('Paid pin response missing x-wallet-auth-token header');
  }
  const ownerHeaders = { Authorization: `Bearer ${walletAuthToken}` };

  const pinStatus = await waitForPinnedStatus(
    `${effectiveApiBaseUrl}/pins/${pinResponse.requestid}`,
    ownerHeaders,
    config.requestTimeoutMs
  );

  const listResponse = await fetchWithTimeout(
    `${effectiveApiBaseUrl}/pins?cid=${encodeURIComponent(uploadBody.cid)}&limit=5`,
    {
      headers: ownerHeaders
    },
    config.requestTimeoutMs
  );
  const listBodyText = await listResponse.text();
  if (listResponse.status !== 200) {
    throw new Error(`Expected 200 from GET /pins, got ${listResponse.status}. Body: ${listBodyText}`);
  }

  const listBody = JSON.parse(listBodyText) as PinListResponse;
  const listMatch = listBody.results.find((result) => result.requestid === pinResponse.requestid);
  if (!listMatch) {
    throw new Error(`Newly created pin ${pinResponse.requestid} not found in owner pin list`);
  }

  const retrievalResponse = await fetchWithTimeout(
    `${effectiveApiBaseUrl}/ipfs/${uploadBody.cid}`,
    { method: 'GET' },
    config.requestTimeoutMs
  );
  const retrievalBytes = await retrievalResponse.arrayBuffer();
  if (retrievalResponse.status !== 200) {
    throw new Error(`Expected 200 from GET /ipfs/:cid, got ${retrievalResponse.status}`);
  }

  const retrievalPreview = new TextDecoder().decode(retrievalBytes).trim();
  if (!retrievalPreview.includes(flowId)) {
    throw new Error(`Retrieved artifact did not contain expected flow id ${flowId}`);
  }

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        scenario: 'discover -> pay upload -> pay pin -> list owner pins -> retrieve artifact',
        agent: {
          cardUrl: config.agentCardUrl,
          name: agentCard.name ?? null,
          advertisedEndpoint,
          effectiveApiBaseUrl,
          endpointAdjusted,
          pinningEndpoints: agentCard.capabilities?.pinningApi?.endpoints ?? [],
          pricing: agentCard.pricing?.pinning ?? null
        },
        artifact: {
          filename,
          bytes: artifactBytes.byteLength,
          flowId
        },
        upload: {
          cid: uploadBody.cid,
          transaction: uploadSettlement.transaction
        },
        pin: {
          requestId: pinResponse.requestid,
          status: pinStatus.status,
          paymentRequired: {
            network: pinResult.acceptedRequirement.network,
            amount: pinResult.acceptedRequirement.amount,
            asset: pinResult.acceptedRequirement.asset,
            payTo: pinResult.acceptedRequirement.payTo
          },
          settlement: {
            transaction: pinSettlement.transaction,
            network: pinSettlement.network,
            payer: pinSettlement.payer,
            success: pinSettlement.success
          }
        },
        ownerView: {
          count: listBody.count,
          matchedRequestId: listMatch?.requestid ?? null
        },
        retrieval: {
          cid: uploadBody.cid,
          bytes: retrievalBytes.byteLength,
          etag: retrievalResponse.headers.get('etag'),
          contentType: retrievalResponse.headers.get('content-type'),
          preview: retrievalPreview
        }
      },
      null,
      2
    )
  );
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[agent-live] ${message}`);
  process.exitCode = 1;
});
