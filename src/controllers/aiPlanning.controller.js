const Anthropic = require('@anthropic-ai/sdk');
const db = require('../config/db');
const { gatherFacts } = require('../services/aiPlanning/facts');
const { checkPlanning, PROTECTED_TYPES } = require('../services/aiPlanning/rules');
const {
  generatePlanning, AiPlanningUnavailableError, AiPlanningFailedError,
} = require('../services/aiPlanning/generate');

// ─────────────────────────────────────────────
// PLANNING GÉNÉRÉ PAR IA (11 nov. 2026) — règles validées par Cédric :
// Notes/Planning par IA - règles.md
// ─────────────────────────────────────────────

// Mois demandé dans ?year=2027&month=1
const readMonth = (query) => {
  const year = Number(query.year);
  const month = Number(query.month);
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
};

// GET /api/ai-planning/facts?year=…&month=… — ce qu'Orgaly sait avant de
// générer : habitudes, compteur d'écart, points à signaler au gérant.
const getFacts = async (req, res) => {
  const period = readMonth(req.query);
  if (!period) return res.status(400).json({ message: 'Mois invalide.' });
  try {
    const facts = await gatherFacts(db, req.user.companyId, period);
    res.json({
      month: facts.month,
      range: facts.range,
      warnings: facts.habits.warnings,
      people: facts.habits.people.map((p) => ({
        userId: p.userId,
        firstName: p.firstName,
        jobTitle: p.jobTitle,
        isManager: p.isManager,
        contractHours: p.contractHours,
        meanHours: p.meanHours,
        gapHours: p.gapHours,
        contractConfirmed: p.contractConfirmed,
      })),
      existingCount: facts.existing.length,
      presenceRules: facts.presenceRules,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// POST /api/ai-planning/confirm-contract — { userId }
// « Oui, la fiche est juste » : on retient la durée du contrat confirmée,
// la question n'est plus posée (tant que le contrat ne change pas).
const confirmContract = async (req, res) => {
  const { companyId } = req.user;
  try {
    const result = await db.query(
      `UPDATE users SET planning_hours_confirmed = weekly_hours
       WHERE id = $1 AND company_id = $2 AND is_active = TRUE
       RETURNING id, planning_hours_confirmed`,
      [req.body.userId, companyId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Salarié introuvable.' });
    res.json({ message: 'C\'est noté : la question ne sera plus posée pour ce salarié.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// Garde-fou de coût : générations par entreprise et par jour (en mémoire,
// remis à zéro au redémarrage du serveur)
const DAILY_LIMIT = Number(process.env.AI_PLANNING_DAILY_LIMIT) || 15;
const usageToday = new Map(); // companyId → { day, count }
const takeQuota = (companyId) => {
  const day = new Date().toISOString().slice(0, 10);
  const u = usageToday.get(companyId);
  const count = u && u.day === day ? u.count : 0;
  if (count >= DAILY_LIMIT) return false;
  usageToday.set(companyId, { day, count: count + 1 });
  return true;
};

// POST /api/ai-planning/generate — { year, month, mode, requests, previous?, refinement? }
// Renvoie une proposition (rien n'est écrit) : { slots, problems, counts, notes, attempts }
const generate = async (req, res) => {
  const { companyId } = req.user;
  const { year, month, mode, requests, previous, refinement } = req.body;
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ message: 'La génération par IA n\'est pas encore activée.' });
  }
  if (!takeQuota(companyId)) {
    return res.status(429).json({ message: `Limite de ${DAILY_LIMIT} générations par jour atteinte. Réessayez demain.` });
  }
  try {
    const facts = await gatherFacts(db, companyId, { year, month });
    const result = await generatePlanning(facts, { mode, requests, previous, refinement });
    res.json({
      slots: result.slots,
      problems: result.problems,
      counts: result.counts,
      notes: result.notes,
      attempts: result.attempts,
      warnings: facts.habits.warnings,
    });
  } catch (err) {
    if (err instanceof AiPlanningUnavailableError) return res.status(503).json({ message: err.message });
    if (err instanceof AiPlanningFailedError) return res.status(502).json({ message: err.message });
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(503).json({ message: 'L\'IA est très demandée en ce moment. Réessayez dans une minute.' });
    }
    if (err instanceof Anthropic.APIError || err instanceof Anthropic.APIConnectionError) {
      console.error('[planning IA]', err.status, err.message);
      return res.status(502).json({ message: 'L\'IA n\'a pas pu répondre. Réessayez dans quelques instants.' });
    }
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// POST /api/ai-planning/apply — { year, month, mode, slots }
// Écrit la proposition validée par le gérant. Tout est revérifié ici : les
// congés et absences ne sont jamais touchés, les cases déjà posées sont
// gardées en mode « empty », et une erreur bloquante empêche l'écriture.
const apply = async (req, res) => {
  const { companyId, id: adminId } = req.user;
  const { year, month, mode, slots } = req.body;

  let toWrite;
  try {
    const facts = await gatherFacts(db, companyId, { year, month });
    const existing = new Map(facts.existing.map((s) => [`${s.userId}|${s.date}`, s]));
    toWrite = slots
      .filter((s) => {
        const current = existing.get(`${s.userId}|${s.date}`);
        return !current || (mode === 'replace' && !PROTECTED_TYPES.includes(current.type));
      })
      .map((s) => (s.type === 'repos' ? { ...s, startTime: '00:00', endTime: '23:59', breaks: [] } : s));
    const check = checkPlanning({ facts, proposal: toWrite });
    const blocking = check.problems.filter((p) => p.level === 'bloquant');
    if (blocking.length > 0) {
      return res.status(400).json({ message: 'Ce planning ne respecte pas toutes les règles : corrigez-le avant de l\'appliquer.', problems: blocking });
    }
    toWrite = toWrite.map((s) => ({ ...s, replaces: existing.has(`${s.userId}|${s.date}`) }));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const counts = { added: 0, replaced: 0 };
    for (const s of toWrite) {
      const shift = (await client.query(
        `INSERT INTO shifts (user_id, company_id, date, start_time, end_time, note, type, created_by)
         VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)
         ON CONFLICT (user_id, date)
         DO UPDATE SET start_time = $4, end_time = $5, note = NULL, type = $6, updated_at = NOW()
         WHERE shifts.type NOT IN ('conge', 'absence')
         RETURNING id`,
        [s.userId, companyId, s.date, s.startTime, s.endTime, s.type, adminId]
      )).rows[0];
      if (!shift) continue; // un congé posé entre-temps : on n'y touche pas
      await client.query('DELETE FROM shift_breaks WHERE shift_id = $1', [shift.id]);
      for (const b of s.type === 'travail' ? s.breaks : []) {
        await client.query(
          'INSERT INTO shift_breaks (shift_id, start_time, end_time, label) VALUES ($1, $2, $3, $4)',
          [shift.id, b.start_time, b.end_time, b.label || 'Pause']
        );
      }
      counts[s.replaces ? 'replaced' : 'added'] += 1;
    }
    await client.query('COMMIT');
    res.json(counts);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  } finally {
    client.release();
  }
};

module.exports = { getFacts, confirmContract, generate, apply, readMonth };
