-- ============================================
-- APPLICATION RH - HISTORIQUE DE SANTÉ TECHNIQUE (PILOTAGE)
-- ============================================

-- Compteurs du serveur heure par heure (15 nov. 2026), pour la page
-- « Santé technique » du pilotage. Seulement des nombres, aucune donnée
-- personnelle. Lignes effacées au bout de 13 mois.
CREATE TABLE IF NOT EXISTS health_hourly (
  hour      TIMESTAMPTZ PRIMARY KEY,      -- début de l'heure
  requests  INTEGER NOT NULL DEFAULT 0,   -- demandes reçues
  total_ms  BIGINT  NOT NULL DEFAULT 0,   -- temps de réponse cumulé (→ moyenne)
  slow      INTEGER NOT NULL DEFAULT 0,   -- demandes de 1,5 s ou plus
  errors    INTEGER NOT NULL DEFAULT 0,   -- réponses en erreur serveur (500 et plus)
  checks    INTEGER NOT NULL DEFAULT 0,   -- un contrôle toutes les 5 min tant que le serveur tourne
  restarts  INTEGER NOT NULL DEFAULT 0    -- démarrages du serveur (mises en ligne, plantages)
);
