const { validateAndLookupPincode } = require('../services/pincodeService');
const { logger } = require('../services/loggerService');

/**
 * Controller to handle PIN code validation and postal lookup
 */
async function lookupPincode(req, res, next) {
  try {
    const rawPincode = req.params.pincode || req.query.pincode || '';
    const result = await validateAndLookupPincode(rawPincode);

    if (!result.valid) {
      return res.status(400).json({
        success: false,
        valid: false,
        error: result.message || 'Invalid PIN code.',
        data: result,
      });
    }

    return res.json({
      success: true,
      valid: true,
      data: result,
    });
  } catch (err) {
    logger.error('Error in pincode controller lookup', err, 'PINCODE_CONTROLLER');
    next(err);
  }
}

module.exports = {
  lookupPincode,
};
