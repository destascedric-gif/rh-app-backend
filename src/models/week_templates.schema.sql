-- ============================================
-- APPLICATION RH - SCHEMA SEMAINES TYPES (PLANNING)
-- ============================================

-- Semaines types (11 nov. 2026, demande de Cédric) : une semaine de planning
-- complète, enregistrée depuis le planning sous un nom (« Semaine A »,
-- « Vacances scolaires »…), à recopier en un clic sur une autre semaine.
-- Contenu dans slots (JSON), une entrée par salarié et par jour :
--   { userId, weekday (0 = lundi … 6 = dimanche), type ('travail' | 'repos'),
--     startTime 'HH:MM', endTime 'HH:MM', breaks: [{ start_time, end_time, label }] }
-- Les congés et absences ne sont jamais enregistrés.
CREATE TABLE IF NOT EXISTS week_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  slots       JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_week_templates_company ON week_templates(company_id);
