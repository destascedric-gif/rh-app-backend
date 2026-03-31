const db = require('../config/db');

// ─────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────

// Calcule la durée nette travaillée (heures totales - pauses) en minutes
const computeNetMinutes = (startTime, endTime, breaks = []) => {
  const toMinutes = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const totalMinutes  = toMinutes(endTime) - toMinutes(startTime);
  const breakMinutes  = breaks.reduce((sum, b) => {
    return sum + (toMinutes(b.end_time) - toMinutes(b.start_time));
  }, 0);
  return Math.max(0, totalMinutes - breakMinutes);
};

// Enrichit les créneaux avec leurs pauses et la durée nette
const enrichShifts = async (shifts) => {
  if (shifts.length === 0) return [];

  const shiftIds    = shifts.map((s) => s.id);
  const breaksResult = await db.query(
    `SELECT * FROM shift_breaks WHERE shift_id = ANY($1) ORDER BY start_time`,
    [shiftIds]
  );

  const breaksByShift = {};
  breaksResult.rows.forEach((b) => {
    if (!breaksByShift[b.shift_id]) breaksByShift[b.shift_id] = [];
    breaksByShift[b.shift_id].push(b);
  });

  return shifts.map((s) => {
    const breaks     = breaksByShift[s.id] ?? [];
    const netMinutes = computeNetMinutes(s.start_time, s.end_time, breaks);
    return {
      ...s,
      breaks,
      net_hours:   parseFloat((netMinutes / 60).toFixed(2)),
      net_minutes: netMinutes,
    };
  });
};

// ─────────────────────────────────────────────
// LECTURE — ADMIN (tous les employés)
// ─────────────────────────────────────────────

// GET /api/schedule/admin?start=2025-06-01&end=2025-06-30&userId=xxx
// Retourne les créneaux de tous les employés (ou d'un seul si userId fourni)
const getAdminSchedule = async (req, res) => {
  const { companyId } = req.user;
  const { start, end, userId } = req.query;

  if (!start || !end) {
    return res.status(400).json({ message: 'Paramètres start et end requis.' });
  }

  try {
    let query = `
      SELECT s.*,
             u.first_name, u.last_name, u.photo_url, u.job_title
      FROM shifts s
      JOIN users u ON u.id = s.user_id
      WHERE s.company_id = $1
        AND s.date BETWEEN $2 AND $3`;

    const params = [companyId, start, end];

    if (userId) {
      query += ` AND s.user_id = $4`;
      params.push(userId);
    }

    query += ' ORDER BY s.date, u.last_name, u.first_name';

    const result = await db.query(query, params);
    const enriched = await enrichShifts(result.rows);

    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// LECTURE — EMPLOYÉ (son planning perso)
// ─────────────────────────────────────────────

// GET /api/schedule/my?start=2025-06-01&end=2025-06-30
const getMySchedule = async (req, res) => {
  const { id: userId, companyId } = req.user;
  const { start, end } = req.query;

  if (!start || !end) {
    return res.status(400).json({ message: 'Paramètres start et end requis.' });
  }

  try {
    const result = await db.query(
      `SELECT * FROM shifts
       WHERE user_id = $1 AND company_id = $2
         AND date BETWEEN $3 AND $4
       ORDER BY date`,
      [userId, companyId, start, end]
    );

    const enriched = await enrichShifts(result.rows);
    res.json(enriched);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// CRÉATION D'UN CRÉNEAU — ADMIN
// ─────────────────────────────────────────────

// POST /api/schedule
// Body: { userId, date, startTime, endTime, note, breaks: [{startTime, endTime, label}] }
const createShift = async (req, res) => {
  const { companyId, id: adminId } = req.user;
  const { userId, date, startTime, endTime, note, breaks = [] } = req.body;

  if (!userId || !date || !startTime || !endTime) {
    return res.status(400).json({ message: 'userId, date, startTime et endTime sont requis.' });
  }

  if (startTime >= endTime) {
    return res.status(400).json({ message: 'L\'heure de début doit être avant l\'heure de fin.' });
  }

  // Vérifie que les pauses sont dans les bornes du créneau
  for (const b of breaks) {
    if (b.start_time < startTime || b.end_time > endTime || b.start_time >= b.end_time) {
      return res.status(400).json({ message: `Pause invalide : ${b.start_time} → ${b.end_time}` });
    }
  }

  // Vérifie que l'employé appartient à l'entreprise
  const empCheck = await db.query(
    'SELECT id FROM users WHERE id = $1 AND company_id = $2',
    [userId, companyId]
  );
  if (empCheck.rows.length === 0) {
    return res.status(404).json({ message: 'Employé introuvable.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // Crée le créneau (ON CONFLICT remplace si même jour/employé)
    const shiftResult = await client.query(
      `INSERT INTO shifts (user_id, company_id, date, start_time, end_time, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, date)
       DO UPDATE SET start_time = $4, end_time = $5, note = $6, updated_at = NOW()
       RETURNING *`,
      [userId, companyId, date, startTime, endTime, note, adminId]
    );

    const shift = shiftResult.rows[0];

    // Supprime les anciennes pauses et recrée
    await client.query('DELETE FROM shift_breaks WHERE shift_id = $1', [shift.id]);

    for (const b of breaks) {
      await client.query(
        `INSERT INTO shift_breaks (shift_id, start_time, end_time, label)
         VALUES ($1, $2, $3, $4)`,
        [shift.id, b.start_time, b.end_time, b.label ?? 'Pause']
      );
    }

    await client.query('COMMIT');

    // Retourne le créneau enrichi
    const [enriched] = await enrichShifts([shift]);
    res.status(201).json(enriched);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────
// MODIFICATION D'UN CRÉNEAU — ADMIN
// ─────────────────────────────────────────────

// PUT /api/schedule/:id
const updateShift = async (req, res) => {
  const { companyId } = req.user;
  const { id }        = req.params;
  const { startTime, endTime, note, breaks = [] } = req.body;

  if (startTime >= endTime) {
    return res.status(400).json({ message: 'L\'heure de début doit être avant l\'heure de fin.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE shifts
       SET start_time = $1, end_time = $2, note = $3, updated_at = NOW()
       WHERE id = $4 AND company_id = $5
       RETURNING *`,
      [startTime, endTime, note, id, companyId]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Créneau introuvable.' });
    }

    // Recrée les pauses
    await client.query('DELETE FROM shift_breaks WHERE shift_id = $1', [id]);
    for (const b of breaks) {
      await client.query(
        `INSERT INTO shift_breaks (shift_id, start_time, end_time, label)
         VALUES ($1, $2, $3, $4)`,
        [id, b.start_time, b.end_time, b.label ?? 'Pause']
      );
    }

    await client.query('COMMIT');

    const [enriched] = await enrichShifts([result.rows[0]]);
    res.json(enriched);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────
// SUPPRESSION D'UN CRÉNEAU — ADMIN
// ─────────────────────────────────────────────

// DELETE /api/schedule/:id
const deleteShift = async (req, res) => {
  const { companyId } = req.user;
  const { id }        = req.params;

  try {
    const result = await db.query(
      'DELETE FROM shifts WHERE id = $1 AND company_id = $2 RETURNING id',
      [id, companyId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Créneau introuvable.' });
    }

    res.json({ message: 'Créneau supprimé.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = {
  getAdminSchedule,
  getMySchedule,
  createShift,
  updateShift,
  deleteShift,
};
