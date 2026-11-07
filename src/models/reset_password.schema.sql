-- ============================================
-- RÉINITIALISATION DU MOT DE PASSE (lien envoyé par email)
-- ============================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMP;
