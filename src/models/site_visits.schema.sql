-- ============================================
-- APPLICATION RH - VISITES DU SITE (PILOTAGE)
-- ============================================

-- Compteur de visites des pages publiques (11 nov. 2026), sans cookie ni
-- donnée personnelle : une ligne par page vue. « visitor » est une empreinte
-- du jour, calculée à partir de l'adresse IP et du navigateur avec un secret
-- qui change chaque jour : elle permet de compter les visiteurs différents
-- d'une journée, mais ne permet ni de retrouver l'adresse IP, ni de suivre
-- quelqu'un d'un jour à l'autre. Lignes effacées au bout de 13 mois.
CREATE TABLE IF NOT EXISTS site_visits (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  path        VARCHAR(60) NOT NULL,
  source      VARCHAR(20) NOT NULL,   -- instagram, google, bing, facebook, carte, direct, lien, autre
  device      VARCHAR(12) NOT NULL,   -- telephone | ordinateur
  visitor     CHAR(16) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_site_visits_created ON site_visits(created_at);
