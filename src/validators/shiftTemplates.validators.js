const { z } = require('zod');
const { requiredString, timeString, optionalTime } = require('./common');
const { HEX_COLOR } = require('../services/shiftColors');

const shiftTemplateSchema = z.object({
  name:       requiredString('Le nom'),
  startTime:  timeString('L\'heure de début'),
  endTime:    timeString('L\'heure de fin'),
  breakStart: optionalTime('Le début de pause'),
  breakEnd:   optionalTime('La fin de pause'),
  color:      z.preprocess(
    (val) => (val === '' || val === null ? undefined : val),
    z.string().regex(HEX_COLOR, 'Couleur invalide.').optional()
  ),
}).refine((d) => d.startTime < d.endTime, {
  message: "L'heure de début doit être avant l'heure de fin.",
  path: ['startTime'],
});

module.exports = { shiftTemplateSchema };
