const { z } = require('zod');
const { numberLike } = require('./common');

const updateSettingsSchema = z.object({
  defaultWeeklyHours:          numberLike(),
  leaveAccrualPerMonth:        numberLike(),
  overtimeTier1Rate:           numberLike(),
  overtimeTier2Rate:           numberLike(),
  overtimeTier2ThresholdHours: numberLike(),
  primaryColor: z.string().trim()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'Couleur invalide (format hex, ex. #1C4ED8).')
    .optional().or(z.literal('')),
});

module.exports = { updateSettingsSchema };
