const { z } = require('zod');
const { requiredString, requiredNumberLike } = require('./common');

const generatePayslipSchema = z.object({
  userId: requiredString('L\'employé'),
  month:  requiredNumberLike('Le mois'),
  year:   requiredNumberLike('L\'année'),
});

const generateAllPayslipsSchema = z.object({
  month: requiredNumberLike('Le mois'),
  year:  requiredNumberLike('L\'année'),
});

module.exports = { generatePayslipSchema, generateAllPayslipsSchema };
