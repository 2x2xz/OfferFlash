import type { JobInput, MatchResult, SourceDefinition, SourceCollectionResult } from './contracts.js';

export interface DiscoverySource {
  id: string; provider: 'tencent' | 'tencent-campus' | 'lever' | 'ashby' | 'feishu' | 'candidate';
  name: string; company: string; url: string; enabled: boolean;
}
export interface DiscoverySourceInput { company: string; url: string; name?: string; }
export interface DiscoveryOptions {
  region?: 'mainland' | 'overseas' | 'all';
  sourceIds?: string[]; maxSources?: number; maxPages?: number; pageSize?: number; detailLimit?: number;
  includeExperienced?: boolean;
}
export interface DiscoveryPlan {
  profileVersion: number; keywords: string[]; cities: string[]; educationSummary: string; notes: string[];
}
export interface PublicJobSearchInput { keywords: string[]; cities: string[]; region: 'mainland' | 'overseas'; }
export interface PublicJobSearchResult {
  status: 'completed' | 'failed' | 'cancelled' | 'unavailable';
  leads: Array<{ title: string; url: string; verification: 'search-source-only' }>;
  reason: string; observedAt: string; durationMs: number; totalTokens: number | null;
}
export interface DiscoverySourceReport {
  sourceId: string; name: string; url: string; provider: DiscoverySource['provider'];
  status: 'success' | 'partial' | 'failed' | 'skipped'; reason: string;
  pagesRequested: number; pagesSucceeded: number; entriesRead: number; detailChecked: number;
  detailComplete: number; matchedCount: number; excludedCount: number; officialTotal: number | null;
  requestURLs: string[]; warnings: string[]; jobIds: string[]; unviewed: string[];
  duplicateCount?: number;
  audit?: { kind: 'public-keyword-search' | 'public-recommendation-graph'; requests: number;
    detailResponses: number; excludedNonMainland: number; excludedRecruitment: number; incompleteDetails: number; notes: string[] };
}
export interface DiscoveryReport {
  id: string; startedAt: string; finishedAt: string; status: 'success' | 'partial' | 'failed' | 'cancelled';
  plan: DiscoveryPlan; options: Required<DiscoveryOptions>; sources: DiscoverySourceReport[];
  unviewedSources: Array<{ sourceId: string; name: string; reason: string }>;
  uniqueJobs: number; completeDetails: number; duplicateCount: number;
  scopeNote: string;
  publicSearch?: PublicJobSearchResult;
}
export interface DiscoveryResult {
  jobs: JobInput[];
  matches: Array<{ jobId: string; url: string; match: MatchResult; detailComplete: boolean }>;
  report: DiscoveryReport;
  collections: Array<{ source: SourceDefinition; result: SourceCollectionResult }>;
}
export interface DiscoveryState { sources: DiscoverySource[]; runs: DiscoveryReport[]; }
/** A narrow optional IPC extension; collection never implies an application. */
export interface DiscoveryAPI {
  discoveryState(): Promise<DiscoveryState>;
  addDiscoverySource(input: DiscoverySourceInput): Promise<DiscoverySource>;
  discoverJobs(options?: DiscoveryOptions): Promise<DiscoveryResult>;
  cancelDiscovery(): Promise<void>;
}
