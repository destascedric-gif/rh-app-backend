const { z } = require('zod');
const { requiredString, optionalText } = require('./common');

const LEAVE_TYPES = [
  'Congés payés',
  'RTT',
  'Congé maladie',
  'Congé sans solde',
  'Congé maternité / paternité',
];

const submitRequestSchema = z.object({
  leaveType: z.enum(LEAVE_TYPES, { error: 'Type de congé invalide.' }),
  startDate: requiredString('La date de début'),
  endDate:   requiredString('La date de fin'),
  reason:    optionalText(),
}).refine((d) => new Date(d.startDate) <= new Date(d.endDate), {
  message: 'La date de début doit être avant la date de fin.',
  path: ['startDate'],
});

const reviewRequestSchema = z.object({
  status:    z.enum(['approuvé', 'refusé'], { error: 'Statut invalide. Valeurs : approuvé, refusé.' }),
  adminNote: optionalText(),
});

module.exports = { submitRequestSchema, reviewRequestSchema };
