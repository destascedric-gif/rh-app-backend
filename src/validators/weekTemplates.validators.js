const { z } = require('zod');
const { requiredString } = require('./common');

// Lundi de la semaine visée, 'AAAA-MM-JJ'
const weekStart = () => z.string({ error: 'La semaine est obligatoire.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La semaine est invalide.');

const name = () => requiredString('Le nom').max(100, 'Le nom est trop long (100 caractères au plus).');

// Enregistrer la semaine affichée comme nouvelle semaine type
const createWeekTemplateSchema = z.object({
  name:      name(),
  weekStart: weekStart(),
});

// Renommer, et/ou remplacer le contenu par celui d'une autre semaine
const updateWeekTemplateSchema = z.object({
  name:      name().optional(),
  weekStart: weekStart().optional(),
}).refine((d) => d.name || d.weekStart, { message: 'Rien à modifier.' });

// Remplir une semaine avec une semaine type, ou avec la semaine précédente
const applyWeekTemplateSchema = z.object({
  weekStart:    weekStart(),
  mode:         z.enum(['empty', 'replace'], { error: 'Mode invalide.' }),
  templateId:   z.string().uuid('Semaine type invalide.').optional(),
  copyPrevious: z.boolean().optional(),
}).refine((d) => Boolean(d.templateId) !== Boolean(d.copyPrevious), {
  message: 'Choisissez une semaine type ou la semaine précédente.',
});

module.exports = { createWeekTemplateSchema, updateWeekTemplateSchema, applyWeekTemplateSchema };
