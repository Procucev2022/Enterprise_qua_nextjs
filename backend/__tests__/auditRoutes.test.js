jest.mock('../src/middleware/auth', () => ({
  authenticate: jest.fn(),
  requireRole: jest.fn((...roles) => Object.assign(jest.fn(), { allowedRoles: roles })),
}));

const { authenticate } = require('../src/middleware/auth');
const router = require('../src/routes/audit');

function routeFor(path, method) {
  return router.stack
    .map((layer) => layer.route)
    .find((route) => route && route.path === path && route.methods[method]);
}

describe('audit route access policy', () => {
  test('restricts trail reads and verification to admins', () => {
    const readRoute = routeFor('/', 'get');
    const verifyRoute = routeFor('/verify', 'get');

    expect(readRoute.stack.some((layer) => layer.handle === authenticate)).toBe(true);
    expect(readRoute.stack.find((layer) => layer.handle.allowedRoles)?.handle.allowedRoles).toEqual(['admin']);
    expect(verifyRoute.stack.find((layer) => layer.handle.allowedRoles)?.handle.allowedRoles).toEqual(['admin']);
  });

  test('exposes no HTTP append route, so browsers cannot write audit events', () => {
    expect(routeFor('/', 'post')).toBeUndefined();
  });
});
