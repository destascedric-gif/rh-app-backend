const { z } = require('zod');
const { requiredString, optionalText, timeString } = require('./common');

const meetingSchema = z.object({
  title: z.preprocess(
    (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
    z.string().trim().max(120, 'Le titre fait 120 caractères au maximum.').optional()
  ),
  date: requiredString('La date').regex(/^\d{4}-\d{2}-\d{2}$/, 'La date doit être une date valide.'),
  startTime: timeString('L\'heure de début'),
  endTime:   timeString('L\'heure de fin'),
  note:      optionalText().refine((v) => !v || v.length <= 255, 'La note fait 255 caractères au maximum.'),
  participantIds: z.array(z.string(), { error: 'Choisissez au moins un participant.' })
    .min(1, 'Choisissez au moins un participant.'),
})
  .refine((d) => d.startTime < d.endTime, { message: "L'heure de début doit être avant l'heure de fin.", path: ['startTime'] });

module.exports = { meetingSchema };
