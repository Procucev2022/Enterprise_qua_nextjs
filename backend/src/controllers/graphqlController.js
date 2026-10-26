const { graphql } = require('graphql');
const schema = require('../graphql/schema');
const rootResolvers = require('../graphql/resolvers');
const { logger } = require('../services/loggerService');

/**
 * Enterprise GraphQL Controller
 */
async function handleGraphQL(req, res, next) {
  try {
    const isPost = req.method === 'POST';

    // Support standard batched queries array: req.body is an array of operations
    if (isPost && Array.isArray(req.body)) {
      if (req.body.length === 0) {
        return res.status(400).json({
          errors: [{ message: 'Batched query array must not be empty.' }],
        });
      }
      const startBatch = Date.now();
      const results = await Promise.all(
        req.body.map(async (op) => {
          let opVars = op?.variables;
          if (typeof opVars === 'string') {
            try {
              opVars = JSON.parse(opVars);
            } catch {
              opVars = {};
            }
          }
          return graphql({
            schema,
            source: op?.query || '',
            rootValue: rootResolvers,
            contextValue: { req, res },
            variableValues: opVars || {},
            operationName: op?.operationName,
          });
        })
      );
      const batchDuration = Date.now() - startBatch;
      logger.info(
        `GraphQL Batched Query Executed (${req.body.length} operations, ${batchDuration}ms)`,
        { operationCount: req.body.length, durationMs: batchDuration },
        'GRAPHQL_API'
      );
      return res.json(results);
    }

    const query = isPost ? req.body?.query : req.query?.query;
    let variables = isPost ? req.body?.variables : req.query?.variables;
    const operationName = isPost ? req.body?.operationName : req.query?.operationName;

    if (!query) {
      return res.status(400).json({
        errors: [{ message: 'Must provide query string in request.' }],
      });
    }

    if (typeof variables === 'string') {
      try {
        variables = JSON.parse(variables);
      } catch {
        variables = {};
      }
    }

    const start = Date.now();
    const result = await graphql({
      schema,
      source: query,
      rootValue: rootResolvers,
      contextValue: { req, res },
      variableValues: variables || {},
      operationName,
    });
    const duration = Date.now() - start;

    if (result.errors && result.errors.length > 0) {
      logger.warn(
        `GraphQL Execution had ${result.errors.length} error(s) (${duration}ms)`,
        { errors: result.errors.map((e) => e.message), query: query.substring(0, 100) },
        'GRAPHQL_API'
      );
    } else {
      logger.info(
        `GraphQL Query Executed Successfully (${duration}ms)`,
        { operationName: operationName || 'AnonymousQuery', durationMs: duration },
        'GRAPHQL_API'
      );
    }

    res.json(result);
  } catch (err) {
    logger.error('Unexpected GraphQL Error', err, 'GRAPHQL_API');
    next(err);
  }
}

module.exports = {
  handleGraphQL,
};
