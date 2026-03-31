-- ============================================
-- APPLICATION RH - SCHEMA PLANNING
-- ============================================

-- Table : shifts (créneaux de travail)
CREATE TABLE IF NOT EXISTS shifts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id   UUID NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  start_time   TIME NOT NULL,             -- ex: 09:00
  end_time     TIME NOT NULL,             -- ex: 17:00
  note         VARCHAR(255),              -- commentaire optionnel
  created_by   UUID REFERENCES users(id), -- admin qui a créé
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, date)                  -- un seul créneau par employé par jour
);

-- Table : shift_breaks (pauses d'un créneau)
-- Un créneau peut avoir 1 ou plusieurs pauses
CREATE TABLE IF NOT EXISTS shift_breaks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id    UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  start_time  TIME NOT NULL,             -- ex: 12:00
  end_time    TIME NOT NULL,             -- ex: 13:00
  label       VARCHAR(100) DEFAULT 'Pause déjeuner',
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_shifts_user        ON shifts(user_id);
CREATE INDEX IF NOT EXISTS idx_shifts_company     ON shifts(company_id);
CREATE INDEX IF NOT EXISTS idx_shifts_date        ON shifts(date);
CREATE INDEX IF NOT EXISTS idx_shift_breaks_shift ON shift_breaks(shift_id);
