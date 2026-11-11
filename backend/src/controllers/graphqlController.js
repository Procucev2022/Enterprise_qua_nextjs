const { graphql, parse, visit } = require('graphql');
const schema = require('../graphql/schema');
const rootResolvers = require('../graphql/resolvers');
const { logger } = require('../services/loggerService');
const { GRAPHQL_CONFIG } = require('../config/constants');

function queryExceedsConfiguredComplexity(query) {
  if (typeof query !== 'string' || query.length > GRAPHQL_CONFIG.MAX_QUERY_LENGTH) return true;

  let document;
  try {
    document = parse(query);
  } catch {
    return false;
  }

  let fieldCount = 0;
  let currentDepth = 0;
  let maximumDepth = 0;
  visit(document, {
    SelectionSet: {
      enter() {
        currentDepth += 1;
        maximumDepth = Math.max(maximumDepth, currentDepth);
      },
      leave() {
        currentDepth -= 1;
      },
    },
    Field() {
      fieldCount += 1;
    },
  });

  return fieldCount > GRAPHQL_CONFIG.MAX_QUERY_FIELDS || maximumDepth > GRAPHQL_CONFIG.MAX_QUERY_DEPTH;
}

function normalizeVariables(rawVariables) {
  if (rawVariables === undefined || rawVariables === null) return {};
  if (typeof rawVariables === 'string') {
    try {
      rawVariables = JSON.parse(rawVariables);
    } catch {
      return null;
    }
  }
  if (typeof rawVariables !== 'object' || Array.isArray(rawVariables)) return null;
  return rawVariables;
}

function sendGraphQLLimitError(res) {
  return res.status(413).json({ errors: [{ message: GRAPHQL_CONFIG.ERROR_QUERY_LIMIT }] });
}

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
          errors: [{ message: GRAPHQL_CONFIG.ERROR_BATCH_EMPTY }],
        });
      }
      if (req.body.length > GRAPHQL_CONFIG.MAX_BATCH_OPERATIONS) {
        return res.status(413).json({ errors: [{ message: GRAPHQL_CONFIG.ERROR_BATCH_LIMIT }] });
      }
      const batchVariables = [];
      for (const operation of req.body) {
        if (!operation || typeof operation.query !== 'string') {
          return res.status(400).json({ errors: [{ message: 'Each GraphQL batch operation must include a query string.' }] });
        }
        if (queryExceedsConfiguredComplexity(operation.query)) return sendGraphQLLimitError(res);
        const variables = normalizeVariables(operation.variables);
        if (variables === null) {
          return res.status(400).json({ errors: [{ message: GRAPHQL_CONFIG.ERROR_INVALID_VARIABLES }] });
        }
        batchVariables.push(variables);
      }

      const startBatch = Date.now();
      const results = [];
      for (let index = 0; index < req.body.length; index += 1) {
        const operation = req.body[index];
        results.push(await graphql({
            schema,
            source: operation.query,
            rootValue: rootResolvers,
            contextValue: { req, res },
            variableValues: batchVariables[index],
            operationName: operation.operationName,
          }));
      }
      const batchDuration = Date.now() - startBatch;
      const batchErrorCount = results.reduce((count, result) => count + (result.errors ? result.errors.length : 0), 0);
      const batchMetadata = {
        operationCount: req.body.length,
        errorCount: batchErrorCount,
        durationMs: batchDuration,
        requestId: req.requestId,
      };
      if (batchErrorCount > 0) {
        logger.warn('GraphQL batch execution completed with errors', batchMetadata, 'GRAPHQL_API');
      } else {
        logger.info('GraphQL batch execution completed successfully', batchMetadata, 'GRAPHQL_API');
      }
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

    if (queryExceedsConfiguredComplexity(query)) return sendGraphQLLimitError(res);
    variables = normalizeVariables(variables);
    if (variables === null) {
      return res.status(400).json({ errors: [{ message: GRAPHQL_CONFIG.ERROR_INVALID_VARIABLES }] });
    }

    const start = Date.now();
    const result = await graphql({
      schema,
      source: query,
      rootValue: rootResolvers,
      contextValue: { req, res },
      variableValues: variables,
      operationName,
    });
    const duration = Date.now() - start;

    if (result.errors && result.errors.length > 0) {
      logger.warn(
        `GraphQL Execution had ${result.errors.length} error(s) (${duration}ms)`,
        {
          errorCount: result.errors.length,
          errorTypes: result.errors.map((error) => error.name),
          queryLength: query.length,
          requestId: req.requestId,
        },
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
