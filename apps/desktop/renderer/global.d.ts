import type { OfferAPI } from '../../../packages/shared/src/contracts.js';

declare global {
  interface Window { offer: OfferAPI; }
}

export {};
