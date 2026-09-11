interface Env {
  NODE_BACKEND_URL?: string;
}

interface PagesFunctionContext {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
  waitUntil: (promise: Promise<unknown>) => void;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  data: Record<string, unknown>;
}

export const onRequest = async (context: PagesFunctionContext): Promise<Response> => {
  const url = new URL(context.request.url);
  const defaultBackend = 'https://restored-ceremony-preference-gay.trycloudflare.com';
  const backendBase = context.env.NODE_BACKEND_URL || defaultBackend;
  if (!backendBase || backendBase.includes('localhost') || backendBase.includes('127.0.0.1')) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Cloudflare Pages Backend Gateway: NODE_BACKEND_URL is not configured with a public backend endpoint.',
        message: 'Set NODE_BACKEND_URL in Cloudflare Pages project settings (e.g. https://api.procucev.com or a Cloudflare Tunnel URL).',
        currentSetting: backendBase || 'unset',
        requestedPath: url.pathname,
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  const targetUrl = new URL(url.pathname + url.search, backendBase);

  const headers = new Headers(context.request.headers);
  headers.delete('host'); // Must be removed so fetch uses the destination host
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));

  const requestInit: RequestInit = {
    method: context.request.method,
    headers,
    redirect: 'follow',
  };

  if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
    requestInit.body = context.request.body;
    // @ts-expect-error duplex required for streaming body in edge runtime
    requestInit.duplex = 'half';
  }

  try {
    const response = await fetch(targetUrl.toString(), requestInit);
    return response;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Cloudflare Pages API Gateway: Failed to reach backend service',
        detail: errorMessage,
        targetUrl: targetUrl.toString(),
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
