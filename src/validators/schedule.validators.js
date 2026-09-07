const { z } = require('zod');
const { requiredString, optionalText, timeString } = require('./common');

const SHIFT_TYPES = ['travail', 'conge', 'repos', 'absence'];

const breakSchema = z.object({
  start_time: timeString('L\'heure de début de pause'),
  end_time:   timeString('L\'heure de fin de pause'),
  label:      optionalText(),
});

// Une pause doit rester dans les bornes du créneau et avoir un sens propre.
const breaksWithinShift = (data) =>
  (data.breaks ?? []).every(
    (b) => b.start_time >= data.startTime && b.end_time <= data.endTime && b.start_time < b.end_time
  );
const BREAKS_ERROR = { message: 'Une pause est en dehors des horaires du créneau ou invalide.', path: ['breaks'] };

const createShiftSchema = z.object({
  userId:    requiredString('L\'employé'),
  date:      requiredString('La date'),
  startTime: timeString('L\'heure de début'),
  endTime:   timeString('L\'heure de fin'),
  note:      optionalText(),
  breaks:    z.array(breakSchema).optional(),
  type:      z.enum(SHIFT_TYPES, { error: 'Type de créneau invalide.' }).optional(),
})
  .refine((d) => d.startTime < d.endTime, { message: "L'heure de début doit être avant l'heure de fin.", path: ['startTime'] })
  .refine(breaksWithinShift, BREAKS_ERROR);

const updateShiftSchema = z.object({
  startTime: timeString('L\'heure de début'),
  endTime:   timeString('L\'heure de fin'),
  note:      optionalText(),
  breaks:    z.array(breakSchema).optional(),
  type:      z.enum(SHIFT_TYPES, { error: 'Type de créneau invalide.' }).optional(),
})
  .refine((d) => d.startTime < d.endTime, { message: "L'heure de début doit être avant l'heure de fin.", path: ['startTime'] })
  .refine(breaksWithinShift, BREAKS_ERROR);

module.exports = { createShiftSchema, updateShiftSchema };
