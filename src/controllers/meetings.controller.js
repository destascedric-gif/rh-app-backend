const db = require('../config/db');
const { toLocalDateString } = require('../utils/date');

// ─────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────

// Ajoute à chaque réunion la liste de ses participants (id, prénom, nom)
const withParticipants = async (meetings) => {
  if (meetings.length === 0) return [];
  const result = await db.query(
    `SELECT mp.meeting_id, u.id, u.first_name, u.last_name
     FROM meeting_participants mp
     JOIN users u ON u.id = mp.user_id
     WHERE mp.meeting_id = ANY($1)
     ORDER BY u.first_name, u.last_name`,
    [meetings.map((m) => m.id)]
  );
  const byMeeting = {};
  for (const { meeting_id: meetingId, ...user } of result.rows) {
    (byMeeting[meetingId] ??= []).push(user);
  }
  return meetings.map((m) => ({
    ...m,
    date:         toLocalDateString(m.date),
    start_time:   String(m.start_time).slice(0, 5),
    end_time:     String(m.end_time).slice(0, 5),
    participants: byMeeting[m.id] ?? [],
  }));
};

// Les participants doivent tous être des employés actifs de l'entreprise
const checkParticipants = async (participantIds, companyId) => {
  const ids = [...new Set(participantIds)];
  const result = await db.query(
    'SELECT id FROM users WHERE id = ANY($1) AND company_id = $2 AND is_active = true',
    [ids, companyId]
  );
  return result.rows.length === ids.length ? ids : null;
};

const getMeeting = async (id, companyId) => {
  const result = await db.query('SELECT * FROM meetings WHERE id = $1 AND company_id = $2', [id, companyId]);
  return result.rows[0] ? (await withParticipants(result.rows))[0] : null;
};

// ─────────────────────────────────────────────
// LECTURE
// ─────────────────────────────────────────────

// GET /api/meetings?start=2026-10-01&end=2026-10-31
// Gérant : toutes les réunions de l'entreprise ; employé : les siennes.
const listMeetings = async (req, res) => {
  const { id: userId, companyId, role } = req.user;
  const { start, end } = req.query;

  if (!start || !end) {
    return res.status(400).json({ message: 'Paramètres start et end requis.' });
  }

  try {
    const params = [companyId, start, end];
    let query = `SELECT m.* FROM meetings m
                 WHERE m.company_id = $1 AND m.date BETWEEN $2 AND $3`;
    if (role !== 'admin') {
      query += ` AND EXISTS (SELECT 1 FROM meeting_participants mp
                             WHERE mp.meeting_id = m.id AND mp.user_id = $4)`;
      params.push(userId);
    }
    query += ' ORDER BY m.date, m.start_time';

    const result = await db.query(query, params);
    res.json(await withParticipants(result.rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// ─────────────────────────────────────────────
// ÉCRITURE — ADMIN
// ─────────────────────────────────────────────

// Enregistre la réunion et remplace sa liste de participants
const saveMeeting = async (req, res, meetingId = null) => {
  const { companyId, id: adminId } = req.user;
  const { title, date, startTime, endTime, note, participantIds } = req.body;

  const ids = await checkParticipants(participantIds, companyId);
  if (!ids) {
    return res.status(400).json({ message: 'Un des participants est introuvable ou n\'est plus actif.' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    let id = meetingId;
    if (id) {
      const updated = await client.query(
        `UPDATE meetings SET title = $1, date = $2, start_time = $3, end_time = $4, note = $5, updated_at = NOW()
         WHERE id = $6 AND company_id = $7 RETURNING id`,
        [title || 'Réunion', date, startTime, endTime, note || null, id, companyId]
      );
      if (updated.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Réunion introuvable.' });
      }
      await client.query('DELETE FROM meeting_participants WHERE meeting_id = $1', [id]);
    } else {
      const created = await client.query(
        `INSERT INTO meetings (company_id, title, date, start_time, end_time, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [companyId, title || 'Réunion', date, startTime, endTime, note || null, adminId]
      );
      id = created.rows[0].id;
    }

    await client.query(
      `INSERT INTO meeting_participants (meeting_id, user_id)
       SELECT $1, unnest($2::uuid[])`,
      [id, ids]
    );

    await client.query('COMMIT');
    res.status(meetingId ? 200 : 201).json(await getMeeting(id, companyId));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  } finally {
    client.release();
  }
};

// POST /api/meetings
const createMeeting = (req, res) => saveMeeting(req, res);

// PUT /api/meetings/:id
const updateMeeting = (req, res) => saveMeeting(req, res, req.params.id);

// DELETE /api/meetings/:id
const deleteMeeting = async (req, res) => {
  const { companyId } = req.user;
  try {
    const result = await db.query(
      'DELETE FROM meetings WHERE id = $1 AND company_id = $2 RETURNING id',
      [req.params.id, companyId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Réunion introuvable.' });
    }
    res.json({ message: 'Réunion supprimée.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = { listMeetings, createMeeting, updateMeeting, deleteMeeting };
