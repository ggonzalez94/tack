import { formatPinningPriceFormula } from './services/payment/pricing';
import type { AgentCardConfig } from './types';

export interface BuildOpenApiInput {
  baseUrl: string;
  agentCard?: AgentCardConfig;
  uploadMaxSizeBytes: number;
}

interface PriceFixed {
  mode: 'fixed';
  amount: string;
  currency: string;
}

interface PriceDynamic {
  mode: 'dynamic';
  min: string;
  max: string;
  currency: string;
}

type Price = PriceFixed | PriceDynamic;

interface XPaymentInfo {
  price: Price;
  protocols: Array<Record<string, unknown>>;
}

function parseEip155ChainId(network: string | undefined): number | undefined {
  if (!network) {
    return undefined;
  }
  const match = /^eip155:(\d+)$/.exec(network.trim());
  if (!match) {
    return undefined;
  }
  const chainId = Number(match[1]);
  return Number.isInteger(chainId) ? chainId : undefined;
}

function knownChainName(chainId: number | undefined): string | undefined {
  switch (chainId) {
    case 167000:
      return 'taiko';
    case 167009:
      return 'taiko-hekla';
    case 8453:
      return 'base';
    default:
      return undefined;
  }
}

function paymentProtocols(agent: AgentCardConfig | undefined): Array<Record<string, unknown>> {
  const protocols: Array<Record<string, unknown>> = [];

  for (const chain of agent?.x402Chains ?? []) {
    const x402: Record<string, unknown> = {
      network: chain.network,
      asset: chain.usdcAssetAddress
    };
    const chainId = parseEip155ChainId(chain.network);
    if (chainId !== undefined) {
      x402.chainId = chainId;
      const chainName = knownChainName(chainId);
      if (chainName) x402.chain = chainName;
    }
    protocols.push({ x402 });
  }

  if (agent?.mppMethod) {
    const mpp: Record<string, unknown> = {
      method: agent.mppMethod,
      intent: 'charge'
    };
    if (agent.mppAsset) mpp.currency = agent.mppAsset;
    if (agent.mppAsset) mpp.asset = agent.mppAsset;
    if (agent.mppChainId !== undefined) mpp.chainId = agent.mppChainId;
    if (agent.mppAssetSymbol) mpp.assetSymbol = agent.mppAssetSymbol;
    if (agent.mppMethod === 'tempo') mpp.chain = 'tempo';
    protocols.push({ mpp });
  }

  return protocols;
}

function dynamicPaymentInfo(agent: AgentCardConfig | undefined): XPaymentInfo {
  const min = agent?.x402MinPriceUsd ?? 0.001;
  const max = agent?.x402MaxPriceUsd ?? 50;
  return {
    price: {
      mode: 'dynamic',
      min: min.toFixed(6),
      max: max.toFixed(6),
      currency: 'USD'
    },
    protocols: paymentProtocols(agent)
  };
}

function describeProtocols(agent: AgentCardConfig | undefined): string {
  const networks = (agent?.x402Chains ?? []).map((chain) => chain.network).filter(Boolean);
  const x402Hint = networks.length > 0 ? `x402 on ${networks.join(', ')}` : 'x402';
  if (!agent?.mppMethod) {
    return x402Hint;
  }
  const mppParts: string[] = [`MPP via ${agent.mppMethod}`];
  if (agent.mppAssetSymbol) {
    mppParts.push(`(${agent.mppAssetSymbol})`);
  }
  return `${x402Hint} and ${mppParts.join(' ')}`;
}

function buildGuidance(input: BuildOpenApiInput): string {
  const agent = input.agentCard;
  const rate = agent?.x402RatePerGbMonthUsd;
  const minPrice = agent?.x402MinPriceUsd;
  const maxPrice = agent?.x402MaxPriceUsd;
  const defaultMonths = agent?.x402DefaultDurationMonths;
  const maxMonths = agent?.x402MaxDurationMonths;
  const protocols = describeProtocols(agent);

  const pricingLine = rate !== undefined && minPrice !== undefined && maxPrice !== undefined && defaultMonths !== undefined && maxMonths !== undefined
    ? `Pinning is priced at $${rate}/GB/month, clamped to $${minPrice}–$${maxPrice} per pin. Pin duration is ${defaultMonths}–${maxMonths} months (default ${defaultMonths}). Final amount: ${formatPinningPriceFormula({ ratePerGbMonthUsd: rate, minPriceUsd: minPrice, maxPriceUsd: maxPrice })}.`
    : 'Pinning uses dynamic pricing based on content size and duration. The exact rate, minimum, and bounds are advertised in GET /.well-known/agent.json.';

  return [
    `Tack is an IPFS pinning service that accepts machine payments via ${protocols}. See GET /openapi.json or GET /.well-known/agent.json for the live chain and asset details.`,
    'No accounts. The wallet that pays for a pin owns it. Paid responses include an x-wallet-auth-token bearer token; use it as Authorization: Bearer <token> on owner endpoints (GET /pins, GET/POST/DELETE /pins/:requestid).',
    pricingLine,
    `Uploads are capped at ${Math.floor(input.uploadMaxSizeBytes / (1024 * 1024))}MB. POST /pins takes a CID; POST /upload takes a multipart file.`,
    'Retrieval via GET /ipfs/:cid is free by default. Owners may set a paywall via meta.retrievalPrice when creating the pin — paywalled CIDs return 402 with a runtime challenge.',
    'Conforms to the IPFS Pinning Service API (https://ipfs.github.io/pinning-services-api-spec/).'
  ].join(' ');
}

const PIN_REQUEST_BODY = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['cid'],
        properties: {
          cid: { type: 'string', description: 'IPFS content identifier to pin' },
          name: { type: 'string', description: 'Optional human-readable name' },
          origins: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional peer multiaddrs to fetch from'
          },
          meta: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Optional metadata. meta.retrievalPrice gates GET /ipfs/:cid behind a paywall.'
          }
        }
      }
    }
  }
} as const;

const PIN_STATUS_RESPONSE = {
  description: 'Pin status object (IPFS Pinning Service API)',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['requestid', 'status', 'created', 'pin', 'delegates'],
        properties: {
          requestid: { type: 'string' },
          status: {
            type: 'string',
            enum: ['queued', 'pinning', 'pinned', 'failed']
          },
          created: { type: 'string', format: 'date-time' },
          pin: { type: 'object' },
          delegates: { type: 'array', items: { type: 'string' } },
          info: { type: 'object', additionalProperties: true }
        }
      }
    }
  }
} as const;

export function buildOpenApiDocument(input: BuildOpenApiInput): Record<string, unknown> {
  const { baseUrl, agentCard, uploadMaxSizeBytes } = input;
  const guidance = buildGuidance(input);
  const paid = dynamicPaymentInfo(agentCard);
  // Retrieval is free by default; owners may attach an arbitrary paywall via
  // `meta.retrievalPrice`. The service does not clamp retrieval prices to
  // `x402MaxPriceUsd` (that bound applies only to pinning), so we cannot
  // honestly advertise a service-wide dynamic max. We publish the default
  // (fixed: $0) and rely on the runtime 402 challenge as the source of truth
  // for the actual amount — surfaced via `x-optional` + `x-source` so
  // discovery consumers know the real price is owner- and runtime-defined.
  const retrievalPaid: XPaymentInfo & {
    'x-optional': true;
    'x-source': string;
    'x-note': string;
  } = {
    price: { mode: 'fixed', amount: '0', currency: 'USD' },
    protocols: paymentProtocols(agentCard),
    'x-optional': true,
    'x-source': 'meta.retrievalPrice',
    'x-note':
      'Default: free. Pin owners may attach an arbitrary paywall via meta.retrievalPrice (not bounded by service max). Actual price is advertised in the runtime 402 challenge.'
  };
  const uploadMaxMb = Math.floor(uploadMaxSizeBytes / (1024 * 1024));

  return {
    openapi: '3.1.0',
    info: {
      title: agentCard?.name ?? 'Tack',
      version: agentCard?.version ?? '0.0.0',
      description:
        agentCard?.description ?? 'IPFS pinning and content retrieval with wallet-native payments.',
      'x-guidance': guidance,
      contact: { name: 'Tack', url: baseUrl }
    },
    servers: [{ url: baseUrl }],
    tags: [
      { name: 'Auth', description: 'Wallet signature login' },
      { name: 'Pins', description: 'Pin lifecycle (IPFS Pinning Service API)' },
      { name: 'Upload', description: 'Direct file upload + pin' },
      { name: 'Gateway', description: 'IPFS content retrieval' },
      { name: 'Private Storage', description: 'Wallet-owned private objects stored outside IPFS' }
    ],
    paths: {
      '/auth/challenge': {
        post: {
          operationId: 'createWalletAuthChallenge',
          summary: 'Create a SIWE wallet login challenge',
          tags: ['Auth'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['address'],
                  properties: {
                    address: { type: 'string' },
                    network: { type: 'string', description: 'CAIP-2 EVM network, e.g. eip155:8453' },
                    chainId: { type: 'integer', description: 'Numeric EVM chain ID alternative to network' }
                  }
                }
              }
            }
          },
          responses: {
            '201': { description: 'SIWE challenge' },
            '400': { description: 'Invalid wallet login request' }
          }
        }
      },
      '/auth/token': {
        post: {
          operationId: 'createWalletAuthToken',
          summary: 'Exchange a signed SIWE message for a wallet auth token',
          tags: ['Auth'],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['message', 'signature'],
                  properties: {
                    message: { type: 'string' },
                    signature: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '200': { description: 'Wallet auth token' },
            '400': { description: 'Invalid or expired wallet challenge' }
          }
        }
      },
      '/pins': {
        post: {
          operationId: 'createPin',
          summary: 'Pin content by CID',
          tags: ['Pins'],
          'x-payment-info': paid,
          parameters: [
            {
              name: 'X-Pin-Duration-Months',
              in: 'header',
              required: false,
              description: `Pin duration in months (1–${agentCard?.x402MaxDurationMonths ?? 24}). Default: ${agentCard?.x402DefaultDurationMonths ?? 1}.`,
              schema: { type: 'integer', minimum: 1 }
            }
          ],
          requestBody: PIN_REQUEST_BODY,
          responses: {
            '202': PIN_STATUS_RESPONSE,
            '402': { description: 'Payment Required' }
          }
        },
        get: {
          operationId: 'listPins',
          summary: 'List pins owned by the authenticated wallet',
          tags: ['Pins'],
          security: [{ walletAuthToken: [] }],
          parameters: [
            { name: 'cid', in: 'query', schema: { type: 'string' } },
            { name: 'name', in: 'query', schema: { type: 'string' } },
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'after', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 1000 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } }
          ],
          responses: {
            '200': {
              description: 'Pin list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['count', 'results'],
                    properties: {
                      count: { type: 'integer' },
                      results: { type: 'array', items: { type: 'object' } }
                    }
                  }
                }
              }
            },
            '401': { description: 'Missing or invalid wallet auth token' }
          }
        }
      },
      '/pins/{requestid}': {
        parameters: [
          { name: 'requestid', in: 'path', required: true, schema: { type: 'string' } }
        ],
        get: {
          operationId: 'getPin',
          summary: 'Get a specific pin',
          tags: ['Pins'],
          security: [{ walletAuthToken: [] }],
          responses: {
            '200': PIN_STATUS_RESPONSE,
            '401': { description: 'Missing or invalid wallet auth token' },
            '404': { description: 'Pin not found' }
          }
        },
        post: {
          operationId: 'replacePin',
          summary: 'Replace a pin',
          tags: ['Pins'],
          security: [{ walletAuthToken: [] }],
          requestBody: PIN_REQUEST_BODY,
          responses: {
            '202': PIN_STATUS_RESPONSE,
            '401': { description: 'Missing or invalid wallet auth token' },
            '404': { description: 'Pin not found' }
          }
        },
        delete: {
          operationId: 'deletePin',
          summary: 'Delete a pin',
          tags: ['Pins'],
          security: [{ walletAuthToken: [] }],
          responses: {
            '202': { description: 'Pin removal accepted' },
            '401': { description: 'Missing or invalid wallet auth token' },
            '404': { description: 'Pin not found' }
          }
        }
      },
      '/upload': {
        post: {
          operationId: 'uploadAndPin',
          summary: `Upload a file and pin it (max ${uploadMaxMb}MB)`,
          tags: ['Upload'],
          'x-payment-info': paid,
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: {
                    file: { type: 'string', format: 'binary' }
                  }
                }
              }
            }
          },
          responses: {
            '201': {
              description: 'Uploaded',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['cid'],
                    properties: { cid: { type: 'string' } }
                  }
                }
              }
            },
            '402': { description: 'Payment Required' },
            '413': { description: 'Upload exceeds size limit' }
          }
        }
      },
      '/ipfs/{cid}': {
        get: {
          operationId: 'getContent',
          summary: 'Retrieve content by CID',
          description:
            'Free for most CIDs. Owners may attach a paywall via meta.retrievalPrice when creating the pin; paywalled CIDs return 402 with a runtime payment challenge. Clients should be ready to handle a 402 response on this route and retry with payment.',
          tags: ['Gateway'],
          'x-payment-info': retrievalPaid,
          parameters: [
            { name: 'cid', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'Range', in: 'header', required: false, schema: { type: 'string' } }
          ],
          responses: {
            '200': { description: 'Content body' },
            '206': { description: 'Partial content (Range request)' },
            '304': { description: 'Not modified' },
            '402': {
              description:
                'Payment Required — owner attached a retrieval paywall. The 402 body carries the x402/MPP challenge.'
            },
            '404': { description: 'Content not found' },
            '416': { description: 'Range not satisfiable' }
          }
        }
      },
      '/private/objects': {
        post: {
          operationId: 'createPrivateObject',
          summary: 'Store a wallet-owned private object',
          tags: ['Private Storage'],
          'x-payment-info': paid,
          parameters: [
            {
              name: 'X-Content-Size-Bytes',
              in: 'header',
              required: true,
              schema: { type: 'integer', minimum: 0 }
            },
            {
              name: 'X-Storage-Duration-Months',
              in: 'header',
              required: false,
              schema: { type: 'integer', minimum: 1 }
            }
          ],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file'],
                  properties: {
                    file: { type: 'string', format: 'binary' },
                    name: { type: 'string' },
                    meta: { type: 'string', description: 'JSON object string with string values' }
                  }
                }
              },
              'application/octet-stream': {
                schema: { type: 'string', format: 'binary' }
              }
            }
          },
          responses: {
            '201': { description: 'Private object metadata' },
            '402': { description: 'Payment Required' },
            '413': { description: 'Object exceeds size limit' }
          }
        },
        get: {
          operationId: 'listPrivateObjects',
          summary: 'List private objects owned by the authenticated wallet',
          tags: ['Private Storage'],
          security: [{ walletAuthToken: [] }],
          responses: {
            '200': { description: 'Private object list' },
            '401': { description: 'Missing or invalid wallet auth token' }
          }
        }
      },
      '/private/objects/{objectId}': {
        parameters: [
          { name: 'objectId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        get: {
          operationId: 'getPrivateObject',
          summary: 'Get private object metadata',
          tags: ['Private Storage'],
          security: [{ walletAuthToken: [] }],
          responses: {
            '200': { description: 'Private object metadata' },
            '404': { description: 'Private object not found' }
          }
        },
        patch: {
          operationId: 'updatePrivateObject',
          summary: 'Update private object metadata',
          tags: ['Private Storage'],
          security: [{ walletAuthToken: [] }],
          responses: {
            '200': { description: 'Private object metadata' },
            '404': { description: 'Private object not found' }
          }
        },
        delete: {
          operationId: 'deletePrivateObject',
          summary: 'Delete a private object',
          tags: ['Private Storage'],
          security: [{ walletAuthToken: [] }],
          responses: {
            '202': { description: 'Private object deleted' },
            '404': { description: 'Private object not found' }
          }
        }
      },
      '/private/objects/{objectId}/content': {
        parameters: [
          { name: 'objectId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        get: {
          operationId: 'getPrivateObjectContent',
          summary: 'Read private object bytes',
          tags: ['Private Storage'],
          security: [{ walletAuthToken: [] }],
          responses: {
            '200': { description: 'Private object bytes' },
            '206': { description: 'Partial content' },
            '404': { description: 'Private object not found' }
          }
        },
        head: {
          operationId: 'headPrivateObjectContent',
          summary: 'Read private object content headers',
          tags: ['Private Storage'],
          security: [{ walletAuthToken: [] }],
          responses: {
            '200': { description: 'Private object content headers' },
            '404': { description: 'Private object not found' }
          }
        }
      },
      '/private/objects/{objectId}/renew': {
        parameters: [
          { name: 'objectId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        post: {
          operationId: 'renewPrivateObject',
          summary: 'Pay to extend private object retention',
          tags: ['Private Storage'],
          security: [{ walletAuthToken: [] }],
          'x-payment-info': paid,
          responses: {
            '200': { description: 'Private object metadata' },
            '402': { description: 'Payment Required' },
            '403': { description: 'Payment wallet does not match owner' },
            '404': { description: 'Private object not found' }
          }
        }
      },
    },
    components: {
      securitySchemes: {
        // Declared as apiKey (not http/bearer) because the AgentCash discovery
        // validator's inferAuthMode only recognizes apiKey schemes. The token
        // is actually a JWT bearer — strict OpenAPI codegen will produce
        // incorrect clients for this scheme; discovery parity is the priority.
        walletAuthToken: {
          type: 'apiKey',
          in: 'header',
          name: 'Authorization',
          description:
            'Short-lived bearer token (`Bearer <token>`) issued in the x-wallet-auth-token response header after a successful payment. Required for owner endpoints (GET /pins, GET/POST/DELETE /pins/:requestid).'
        }
      }
    }
  };
}
