import { GraphQLClient, graphqlClient } from '@/lib/graphqlClient';

describe('Frontend GraphQLClient Unit Tests', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    graphqlClient.clearCache();
    jest.clearAllMocks();
  });

  test('executes GraphQL query successfully with custom endpoint and default constructor', async () => {
    const mockData = { rfqs: [{ id: 'rfq-1', title: 'Test RFQ' }] };
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: mockData }),
      })
    );

    // Test default constructor
    const defaultClient = new GraphQLClient();
    const resDefault = await defaultClient.query('query { rfqs { id } }');
    expect(resDefault.data).toEqual(mockData);

    // Direct request method with 1 argument only
    const resReq = await defaultClient.request('query { simple }');
    expect(resReq.data).toEqual(mockData);

    const client = new GraphQLClient('/api/graphql', 1000);
    const res = await client.query('query { rfqs { id title } }', { limit: 5 }, { operationName: 'GetRFQs' });

    expect(res.data).toEqual(mockData);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      })
    );
  });

  test('caches query responses and avoids redundant fetch calls, handling expiration and errors with cache', async () => {
    const mockData = { activeBuyerAccount: { id: 'b-1', organizationName: 'Tata Steel' } };
    const mockFetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: mockData }),
      })
    );
    global.fetch = mockFetch;

    const client = new GraphQLClient('/api/graphql', 200);
    const queryStr = 'query { activeBuyerAccount { id organizationName } }';

    // First call (cache miss -> set)
    const res1 = await client.query(queryStr, {}, { useCache: true });
    expect(res1.data).toEqual(mockData);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call (cache hit)
    const res2 = await client.query(queryStr, {}, { useCache: true });
    expect(res2.data).toEqual(mockData);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Wait for TTL expiration
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Third call after expiry (cache miss again)
    const res3 = await client.query(queryStr, {}, { useCache: true });
    expect(res3.data).toEqual(mockData);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Query with useCache but response has errors (should not cache)
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: null, errors: [{ message: 'Some Error' }] }),
      })
    );
    const resErr = await client.query('query { broken }', {}, { useCache: true });
    expect(resErr.errors).toBeDefined();
  });

  test('executes mutation with and without variables, clearing client cache', async () => {
    const mockData = { createRFQ: { id: 'rfq-new', title: 'New RFQ' } };
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: mockData }),
      })
    );

    const res1 = await graphqlClient.mutate(
      'mutation CreateRFQ($input: CreateRFQInput!) { createRFQ(input: $input) { id title } }',
      { input: { title: 'New RFQ', category: 'Steel' } },
      'CreateRFQMutation'
    );
    expect(res1.data).toEqual(mockData);

    // Mutation without variables
    const res2 = await graphqlClient.mutate('mutation { clearQueryCache }');
    expect(res2.data).toEqual(mockData);
  });

  test('handles GraphQL errors returned in response payload', async () => {
    const mockErrors = [{ message: 'Field not found on Type RFQ' }];
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ errors: mockErrors }),
      })
    );

    const res = await graphqlClient.query('query { invalidField }');
    expect(res.errors).toEqual(mockErrors);
  });

  test('handles HTTP error status codes gracefully', async () => {
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 500,
      })
    );

    const res = await graphqlClient.query('query { rfqs { id } }');
    expect(res.errors).toBeDefined();
    expect(res.errors![0].message).toMatch(/status: 500/);
  });

  test('handles network failure fetch rejection gracefully with Error and non-Error objects', async () => {
    global.fetch = jest.fn().mockImplementation(() => Promise.reject(new Error('Network disconnected')));
    const res1 = await graphqlClient.query('query { rfqs { id } }');
    expect(res1.errors).toBeDefined();
    expect(res1.errors![0].message).toBe('Network disconnected');

    // Non-Error rejection
    global.fetch = jest.fn().mockImplementation(() => Promise.reject('String error rejection'));
    const res2 = await graphqlClient.query('query { rfqs { id } }');
    expect(res2.errors).toBeDefined();
    expect(res2.errors![0].message).toBe('Network request failed');
  });
});
