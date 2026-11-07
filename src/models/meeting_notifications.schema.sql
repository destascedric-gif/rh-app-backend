-- ============================================
-- NOTIFICATIONS DE RÉUNION (cloche des employés)
-- ============================================
-- Un participant est prévenu quand une réunion est créée, modifiée (date,
-- horaire, titre) ou annulée, et quand il y est ajouté ou en est retiré.
-- meeting_id devient vide si la réunion est supprimée : la notification
-- d'annulation reste lisible.
CREATE TABLE IF NOT EXISTS meeting_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meeting_id  UUID REFERENCES meetings(id) ON DELETE SET NULL,
  message     VARCHAR(500) NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_notifications_user ON meeting_notifications(user_id, is_read);
