const { z } = require('zod');
const { requiredString, optionalText, optionalEnum, optionalEmail, optionalTime, numberLike } = require('./common');

const CONTRACT_TYPES = ['CDI', 'CDD', 'Alternance', 'Stage', 'Freelance'];
const WORK_TIMES = ['Temps plein', 'Temps partiel'];
const DOCUMENT_TYPES = ['contrat', 'avenant', 'autre'];

// PUT /:id — mise à jour partielle (COALESCE côté SQL), donc tout est optionnel,
// mais un enum envoyé doit rester une valeur valide.
const updateEmployeeSchema = z.object({
  firstName:    optionalText(),
  lastName:     optionalText(),
  email:        optionalEmail(),
  phone:        optionalText(),
  jobTitle:     optionalText(),
  department:   optionalText(),
  contractType: optionalEnum(CONTRACT_TYPES, 'Le type de contrat'),
  workTime:     optionalEnum(WORK_TIMES, 'Le temps de travail'),
  weeklyHours:  numberLike(),
  hireDate:     optionalText(),
  grossSalary:  numberLike(),
  birthDate:    optionalText(),
});

const addDocumentSchema = z.object({
  name:    requiredString('Le nom du document'),
  type:    z.enum(DOCUMENT_TYPES, { error: 'Type de document invalide.' }),
  fileUrl: requiredString('Le fichier'),
  fileSize: numberLike(),
});

// POST .../timesheets — création (date obligatoire)
const timesheetSchema = z.object({
  date:         requiredString('La date'),
  clockIn:      optionalTime('L\'heure d\'arrivée'),
  clockOut:     optionalTime('L\'heure de départ'),
  breakMinutes: numberLike(),
  note:         optionalText(),
});

// PUT .../timesheets/:id — modification (la date ne change pas)
const updateTimesheetSchema = z.object({
  clockIn:      optionalTime('L\'heure d\'arrivée'),
  clockOut:     optionalTime('L\'heure de départ'),
  breakMinutes: numberLike(),
  note:         optionalText(),
});

const reviewTimesheetSchema = z.object({
  status: z.enum(['validé', 'refusé'], { error: 'Statut invalide. Valeurs : validé, refusé.' }),
});

module.exports = {
  updateEmployeeSchema,
  addDocumentSchema,
  timesheetSchema,
  updateTimesheetSchema,
  reviewTimesheetSchema,
};
