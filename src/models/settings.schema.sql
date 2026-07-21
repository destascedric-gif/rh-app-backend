-- ============================================
-- APPLICATION RH - SCHEMA PARAMÈTRES / POLITIQUE RH
-- ============================================

-- Heures hebdomadaires contractuelles par employé (35h / 39h / autre)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS weekly_hours NUMERIC(4,2) DEFAULT 35;

-- Type de créneau planning (travail / congé / repos / absence)
ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'travail'
    CHECK (type IN ('travail', 'conge', 'repos', 'absence'));

-- Politique RH et personnalisation, au niveau de l'entreprise
ALTER TABLE company
  ADD COLUMN IF NOT EXISTS default_weekly_hours          NUMERIC(4,2) DEFAULT 35,
  ADD COLUMN IF NOT EXISTS leave_accrual_per_month        NUMERIC(4,2) DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS overtime_tier1_rate            NUMERIC(3,2) DEFAULT 1.25,
  ADD COLUMN IF NOT EXISTS overtime_tier2_rate            NUMERIC(3,2) DEFAULT 1.50,
  ADD COLUMN IF NOT EXISTS overtime_tier2_threshold_hours NUMERIC(4,2) DEFAULT 43,
  ADD COLUMN IF NOT EXISTS primary_color                  VARCHAR(7)   DEFAULT '#1C4ED8';
