-- ============================================
-- APPLICATION RH - PLANNING DANS L'AGENDA DU TÉLÉPHONE
-- ============================================

-- Lien personnel et secret (24 nov. 2026) vers le fichier d'agenda (.ics)
-- de chaque personne : créé la première fois qu'elle ouvre « Ajouter à mon
-- agenda », remplacé par « Changer mon lien ». Vide = pas de lien.
ALTER TABLE users ADD COLUMN IF NOT EXISTS calendar_token VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_calendar_token ON users(calendar_token);
