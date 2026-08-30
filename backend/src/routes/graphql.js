const express = require('express');
const router = express.Router();
const { handleGraphQL } = require('../controllers/graphqlController');

// Support both POST (standard mutations/queries) and GET (graphiql/introspection/cached queries)
router.post('/', handleGraphQL);
router.get('/', handleGraphQL);

module.exports = router;
