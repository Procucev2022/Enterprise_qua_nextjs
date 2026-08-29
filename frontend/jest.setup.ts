import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// Polyfill TextEncoder and TextDecoder
if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder as any;
}

// Ensure Fetch Web APIs are globally available
if (typeof global.Request === 'undefined') {
  global.Request = globalThis.Request;
}
if (typeof global.Response === 'undefined') {
  global.Response = globalThis.Response;
}
if (typeof global.Headers === 'undefined') {
  global.Headers = globalThis.Headers;
}
if (typeof global.fetch === 'undefined') {
  global.fetch = globalThis.fetch;
}

if (typeof window !== 'undefined') {
  if (typeof (window as any).Request === 'undefined') {
    (window as any).Request = globalThis.Request;
  }
  if (typeof (window as any).Response === 'undefined') {
    (window as any).Response = globalThis.Response;
  }
  if (typeof (window as any).Headers === 'undefined') {
    (window as any).Headers = globalThis.Headers;
  }
  if (typeof (window as any).fetch === 'undefined') {
    (window as any).fetch = globalThis.fetch;
  }

  // Polyfill scrollIntoView
  if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = jest.fn();
  }

  // Mock window print
  window.print = jest.fn();

  // Mock iframe print and contentWindow
  if (typeof HTMLIFrameElement !== 'undefined') {
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get: () => ({
        document: {
          open: jest.fn(),
          write: jest.fn(),
          close: jest.fn(),
        },
        focus: jest.fn(),
        print: jest.fn(),
      }),
    });
  }

  // Mock window matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });

  // Mock ResizeObserver
  global.ResizeObserver = class ResizeObserver {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  };

  // Mock IntersectionObserver
  global.IntersectionObserver = class IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
    takeRecords = jest.fn().mockReturnValue([]);
    constructor() {}
  } as any;

  // Mock window.scrollTo
  window.scrollTo = jest.fn();

  // Mock window alert, confirm, prompt
  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);
  window.prompt = jest.fn(() => '');

  // Mock clipboard
  Object.assign(navigator, {
    clipboard: {
      writeText: jest.fn().mockResolvedValue(undefined),
      readText: jest.fn().mockResolvedValue(''),
    },
  });

  // Mock URL.createObjectURL and revokeObjectURL
  if (typeof URL.createObjectURL === 'undefined') {
    URL.createObjectURL = jest.fn(() => 'blob:mock-url');
  }
  if (typeof URL.revokeObjectURL === 'undefined') {
    URL.revokeObjectURL = jest.fn();
  }
}

// Global test timeout (20s)
jest.setTimeout(20000);
