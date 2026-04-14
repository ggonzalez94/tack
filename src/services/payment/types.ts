export type PaymentProtocol = 'x402' | 'mpp';

export interface PaymentResult {
  wallet: string;
  protocol: PaymentProtocol;
  chainName: string;
  receipt?: string;
}
