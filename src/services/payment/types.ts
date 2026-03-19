export type PaymentProtocol = 'x402' | 'mpp';

export interface PaymentChain {
  name: string;
  chainId: number;
  protocol: PaymentProtocol;
  rpcUrl: string;
  asset: {
    address: string;
    decimals: number;
    symbol: string;
  };
  x402?: {
    network: string;
    facilitatorUrl: string;
    domainName: string;
    domainVersion: string;
  };
  mpp?: {
    method: string;
    intent: 'charge';
  };
}

export interface PaymentResult {
  wallet: string;
  protocol: PaymentProtocol;
  chainName: string;
  receipt?: string;
}
