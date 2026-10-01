-- ============================================
-- APPLICATION RH - SCHEMA RÉUNIONS
-- ============================================
-- Une réunion réunit plusieurs employés sur un horaire donné. Elle
-- s'affiche dans la case de chaque participant, sous son créneau : le
-- créneau (un seul par employé et par jour) reste la base des heures
-- travaillées et de la paie.

CREATE TABLE IF NOT EXISTS meetings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  title       VARCHAR(120) NOT NULL DEFAULT 'Réunion',
  date        DATE NOT NULL,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  note        VARCHAR(255),
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meeting_participants (
  meeting_id  UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_meetings_company_date     ON meetings(company_id, date);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_user ON meeting_participants(user_id);
