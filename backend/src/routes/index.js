const express = require('express');
const router = express.Router();

const rfqRoutes = require('./rfqs');
const vendorRoutes = require('./vendors');
const buyerAccountRoutes = require('./buyerAccounts');
const evaluationRoutes = require('./evaluations');
const auditRoutes = require('./audit');
const aiFeedRoutes = require('./aiFeed');
const systemConfigRoutes = require('./systemConfig');
const dbRoutes = require('./db');
const bootstrapRoutes = require('./bootstrap');
const supportChatRoutes = require('./supportChat');
const catalogueRoutes = require('./catalogue');
const logsRoutes = require('./logs');
const graphqlRoutes = require('./graphql');

// Mount sub-routers
router.use('/bootstrap', bootstrapRoutes);
router.use('/rfqs', rfqRoutes);
router.use('/vendors', vendorRoutes);
router.use('/buyer-accounts', buyerAccountRoutes);
router.use('/evaluations', evaluationRoutes);
router.use('/audit', auditRoutes);
router.use('/ai-feed', aiFeedRoutes);
router.use('/system-config', systemConfigRoutes);
router.use('/db', dbRoutes);
router.use('/support-chat', supportChatRoutes);
router.use('/catalogue', catalogueRoutes);
router.use('/logs', logsRoutes);
router.use('/graphql', graphqlRoutes);

module.exports = router;
