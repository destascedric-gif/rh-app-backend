const { z } = require('zod');

const time = () => z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horaire invalide.');
const month = () => z.coerce.number().int().min(1, 'Mois invalide.').max(12, 'Mois invalide.');
const year = () => z.coerce.number().int().min(2020, 'Année invalide.').max(2100, 'Année invalide.');

// Une case du planning proposé (même forme que dans Orgaly)
const slot = z.object({
  userId:    z.string().uuid('Salarié invalide.'),
  date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide.'),
  type:      z.enum(['travail', 'repos'], { error: 'Type de case invalide.' }),
  startTime: time(),
  endTime:   time(),
  breaks:    z.array(z.object({
    start_time: time(),
    end_time:   time(),
    label:      z.string().max(100).optional(),
  })).max(5).default([]),
});

// Le gérant confirme que la fiche (heures du contrat) est juste
const confirmContractSchema = z.object({
  userId: z.string({ error: 'Salarié invalide.' }).uuid('Salarié invalide.'),
});

// Générer (ou retoucher) une proposition pour un mois
const generateSchema = z.object({
  year:       year(),
  month:      month(),
  mode:       z.enum(['empty', 'replace']).default('empty'),
  requests:   z.string().max(2000, 'Demandes trop longues (2 000 caractères au plus).').optional().default(''),
  // Retouche d'une proposition déjà faite
  previous:   z.object({ slots: z.array(slot).max(3000) }).optional(),
  refinement: z.string().trim().max(1000, 'Retouche trop longue (1 000 caractères au plus).').optional(),
}).refine((d) => !d.refinement || d.previous, { message: 'Aucune proposition à retoucher.' });

// Appliquer une proposition au planning
const applySchema = z.object({
  year:  year(),
  month: month(),
  mode:  z.enum(['empty', 'replace']).default('empty'),
  slots: z.array(slot).min(1, 'Rien à appliquer.').max(3000),
});

module.exports = { confirmContractSchema, generateSchema, applySchema };
