const { z } = require('zod');
const { requiredString, timeString, optionalTime } = require('./common');

const shiftTemplateSchema = z.object({
  name:       requiredString('Le nom'),
  startTime:  timeString('L\'heure de début'),
  endTime:    timeString('L\'heure de fin'),
  breakStart: optionalTime('Le début de pause'),
  breakEnd:   optionalTime('La fin de pause'),
}).refine((d) => d.startTime < d.endTime, {
  message: "L'heure de début doit être avant l'heure de fin.",
  path: ['startTime'],
});

module.exports = { shiftTemplateSchema };
