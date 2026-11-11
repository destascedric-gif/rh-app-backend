-- ============================================
-- APPLICATION RH - DÉPENSES DE L'IA (PILOTAGE)
-- ============================================

-- Une ligne par génération de planning par IA (11 nov. 2026), réussie ou
-- non : jetons comptés par Anthropic dans chaque réponse et coût estimé
-- d'après les prix publics. Aucun contenu de planning n'est gardé ici.
CREATE TABLE IF NOT EXISTS ai_generations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID REFERENCES company(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  month              VARCHAR(7),                 -- mois généré, 'AAAA-MM'
  status             VARCHAR(12) NOT NULL,       -- 'proposee' | 'echec'
  model              VARCHAR(60),
  attempts           SMALLINT NOT NULL DEFAULT 0,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd           NUMERIC(10, 4) NOT NULL DEFAULT 0,
  duration_ms        INTEGER,
  refinement         BOOLEAN NOT NULL DEFAULT FALSE, -- « Redemander » (retouche)
  applied_at         TIMESTAMPTZ,                -- proposition appliquée au planning
  error              VARCHAR(200)                -- message court en cas d'échec
);

CREATE INDEX IF NOT EXISTS idx_ai_generations_created ON ai_generations(created_at);

-- Crédit prépayé Anthropic : Anthropic ne permet pas de lire le solde, donc
-- Cédric note ses recharges, et de temps en temps le solde réel lu sur la
-- Console (« relevé ») : le solde affiché repart alors de ce chiffre exact.
CREATE TABLE IF NOT EXISTS ai_credit_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         VARCHAR(10) NOT NULL CHECK (kind IN ('recharge', 'releve')),
  amount_usd   NUMERIC(10, 2) NOT NULL CHECK (amount_usd >= 0),
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
