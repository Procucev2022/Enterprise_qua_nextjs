const authService = require('../src/services/authService');

const TEST_USERS = {
  buyer: { id: 'usr-buyer-001', email: 'buyer@procucev.com', name: 'Test Buyer', role: 'buyer', orgId: 'org-buyer-01', orgName: 'Test Buyer Org' },
  category_manager: { id: 'usr-catman-001', email: 'catmanager@procucev.com', name: 'Test Category Manager', role: 'category_manager', orgId: 'org-cm-01', orgName: 'Test CM Org' },
  vendor: { id: 'usr-vendor-001', email: 'vendor@apexsupplies.com', name: 'Test Vendor', role: 'vendor', orgId: 'org-vendor-01', orgName: 'Test Vendor Org' },
  admin: { id: 'usr-admin-001', email: 'admin@procucev.com', name: 'Test Admin', role: 'admin', orgId: 'org-admin-01', orgName: 'Test Admin Org' },
};

function getTestToken(role = 'buyer') {
  return authService.generateSessionToken(TEST_USERS[role] || TEST_USERS.buyer);
}

function authHeader(role = 'buyer') {
  return { Authorization: `Bearer ${getTestToken(role)}` };
}

module.exports = { TEST_USERS, getTestToken, authHeader };
