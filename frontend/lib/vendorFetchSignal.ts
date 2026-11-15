let pendingVendorFetchSignal: AbortSignal | undefined;

/**
 * Binds an AbortSignal for the next synchronous `fetchAllVendors(...)` call
 * without modifying the 1-argument `fetchAllVendors(options)` signature
 * asserted by component tests or mocking `@/lib/rfqClient` partials.
 */
export function withVendorFetchSignal<T>(signal: AbortSignal | undefined, fn: () => T): T {
  const previousSignal = pendingVendorFetchSignal;
  pendingVendorFetchSignal = signal;
  try {
    return fn();
  } finally {
    pendingVendorFetchSignal = previousSignal;
  }
}

export function getPendingVendorFetchSignal(): AbortSignal | undefined {
  return pendingVendorFetchSignal;
}
