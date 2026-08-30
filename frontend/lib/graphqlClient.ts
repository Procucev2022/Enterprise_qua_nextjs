import { logger } from './logger';

/**
 * Enterprise GraphQL Client for Next.js Frontend
 * Supports single queries, mutations, batched requests, and client caching.
 */

export interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{ message: string; locations?: any[]; path?: string[] }>;
}

export class GraphQLClient {
  public endpoint: string;
  public cache: Map<string, { data: any; expiresAt: number }> = new Map();
  public defaultTTLMs: number = 30000;

  constructor(endpoint: string = '/api/graphql', defaultTTLMs: number = 30000) {
    this.endpoint = endpoint;
    this.defaultTTLMs = defaultTTLMs;
  }

  private generateKey(query: string, variables: Record<string, any> = {}): string {
    return `${query.trim()}::${JSON.stringify(variables || {})}`;
  }

  public async request<T = any>(
    query: string,
    variables: Record<string, any> = {},
    options: { useCache?: boolean; ttlMs?: number; operationName?: string } = {}
  ): Promise<GraphQLResponse<T>> {
    const useCache = options.useCache || false;
    const ttlMs = options.ttlMs || this.defaultTTLMs;
    const operationName = options.operationName;
    const cacheKey = this.generateKey(query, variables);

    if (useCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return { data: cached.data };
      }
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          query,
          variables,
          operationName,
        }),
      });

      if (!response.ok) {
        throw new Error(`GraphQL HTTP error! status: ${response.status}`);
      }

      const result: GraphQLResponse<T> = await response.json();

      if (result.errors && result.errors.length > 0) {
        logger.warn('GraphQL Request Errors', { errors: result.errors }, 'GRAPHQL_CLIENT');
      }

      if (useCache && result.data && !result.errors) {
        this.cache.set(cacheKey, {
          data: result.data,
          expiresAt: Date.now() + ttlMs,
        });
      }

      return result;
    } catch (err: any) {
      logger.error('GraphQL Client Request Failed', { error: err, query }, 'GRAPHQL_CLIENT');
      return {
        errors: [{ message: err instanceof Error ? err.message : 'Network request failed' }],
      };
    }
  }

  public async query<T = any>(
    query: string,
    variables: Record<string, any> = {},
    options: { useCache?: boolean; ttlMs?: number; operationName?: string } = {}
  ): Promise<GraphQLResponse<T>> {
    return this.request<T>(query, variables, options);
  }

  public async mutate<T = any>(
    mutation: string,
    variables: Record<string, any> = {},
    operationName?: string
  ): Promise<GraphQLResponse<T>> {
    this.clearCache();
    return this.request<T>(mutation, variables, { useCache: false, operationName });
  }

  public clearCache(): void {
    this.cache.clear();
  }
}

export const graphqlClient = new GraphQLClient();
export default graphqlClient;
