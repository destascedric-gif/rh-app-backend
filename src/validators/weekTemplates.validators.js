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

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Contenu d'une semaine (format des semaines types), renvoyé par « vider
// la semaine » et renvoyé tel quel pour l'annuler
const slotSchema = z.object({
  userId:    z.string().uuid(),
  weekday:   z.number().int().min(0).max(6),
  type:      z.enum(['travail', 'repos']),
  startTime: z.string().regex(HHMM),
  endTime:   z.string().regex(HHMM),
  breaks:    z.array(z.object({
    start_time: z.string().regex(HHMM),
    end_time:   z.string().regex(HHMM),
    label:      z.string().max(100).optional(),
  })).max(5).default([]),
});

// Remplir une semaine avec une semaine type, avec la semaine précédente,
// ou avec ce qui vient d'être effacé (« Annuler »)
const applyWeekTemplateSchema = z.object({
  weekStart:    weekStart(),
  mode:         z.enum(['empty', 'replace'], { error: 'Mode invalide.' }),
  templateId:   z.string().uuid('Semaine type invalide.').optional(),
  copyPrevious: z.boolean().optional(),
  slots:        z.array(slotSchema).max(700).optional(),
}).refine((d) => [d.templateId, d.copyPrevious, d.slots].filter(Boolean).length === 1, {
  message: 'Choisissez une semaine type ou la semaine précédente.',
});

// Vider une semaine pour les salariés affichés
const clearWeekSchema = z.object({
  weekStart: weekStart(),
  userIds:   z.array(z.string().uuid()).min(1, 'Aucun salarié affiché.').max(200),
});

module.exports = { createWeekTemplateSchema, updateWeekTemplateSchema, applyWeekTemplateSchema, clearWeekSchema };
