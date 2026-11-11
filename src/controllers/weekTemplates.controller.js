const db = require('../config/db');
const { toLocalDateString } = require('../utils/date');

// ─────────────────────────────────────────────
// SEMAINES TYPES (11 nov. 2026)
// Une semaine de planning enregistrée sous un nom, à recopier en un clic.
// Règles de sécurité (validées avec Cédric) :
// - les congés et absences ne sont jamais enregistrés ni écrasés ;
// - un salarié parti (désactivé) est ignoré ;
// - « empty » ne remplit que les cases vides ; « replace » remplace les
//   créneaux et repos déjà posés (jamais un congé ou une absence) ; les
//   cases que la semaine type laisse vides ne sont jamais vidées.
// ─────────────────────────────────────────────

const COLUMNS = 'id, name, slots, created_at, updated_at';
const PROTECTED_TYPES = ['conge', 'absence'];

// 'AAAA-MM-JJ' + n jours (calcul en UTC : pas de décalage d'heure d'été)
const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const isMonday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay() === 1;
const hhmm = (t) => String(t).slice(0, 5);

// Contenu d'une semaine (lundi → dimanche) : créneaux de travail et repos des
// salariés encore actifs, sans les congés ni les absences.
const readWeekSlots = async (companyId, weekStart) => {
  const shifts = (await db.query(
    `SELECT s.id, s.user_id, s.date, s.start_time, s.end_time, COALESCE(s.type, 'travail') AS type,
            (s.date - $2::date) AS weekday
     FROM shifts s
     JOIN users u ON u.id = s.user_id
     WHERE s.company_id = $1 AND s.date BETWEEN $2::date AND $3::date
       AND u.is_active = TRUE
       AND COALESCE(s.type, 'travail') IN ('travail', 'repos')
     ORDER BY s.date`,
    [companyId, weekStart, addDays(weekStart, 6)]
  )).rows;
  if (shifts.length === 0) return [];

  const breaks = (await db.query(
    'SELECT shift_id, start_time, end_time, label FROM shift_breaks WHERE shift_id = ANY($1) ORDER BY start_time',
    [shifts.map((s) => s.id)]
  )).rows;

  return shifts.map((s) => ({
    userId:    s.user_id,
    weekday:   Number(s.weekday),
    type:      s.type,
    startTime: hhmm(s.start_time),
    endTime:   hhmm(s.end_time),
    breaks:    s.type === 'travail'
      ? breaks.filter((b) => b.shift_id === s.id)
        .map((b) => ({ start_time: hhmm(b.start_time), end_time: hhmm(b.end_time), label: b.label || 'Pause' }))
      : [],
  }));
};

// GET /api/week-templates — avec leur contenu (pour l'aperçu)
const getWeekTemplates = async (req, res) => {
  const { companyId } = req.user;
  try {
    const result = await db.query(
      `SELECT ${COLUMNS} FROM week_templates WHERE company_id = $1 ORDER BY name`,
      [companyId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// POST /api/week-templates — enregistre la semaine qui commence à weekStart
const createWeekTemplate = async (req, res) => {
  const { companyId } = req.user;
  const { name, weekStart } = req.body;
  if (!isMonday(weekStart)) return res.status(400).json({ message: 'La semaine doit commencer un lundi.' });

  try {
    const slots = await readWeekSlots(companyId, weekStart);
    if (slots.length === 0) {
      return res.status(400).json({ message: 'Cette semaine ne contient aucun créneau ni repos à enregistrer.' });
    }
    const result = await db.query(
      `INSERT INTO week_templates (company_id, name, slots) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
      [companyId, name, JSON.stringify(slots)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// PUT /api/week-templates/:id — renommer et/ou remplacer le contenu
const updateWeekTemplate = async (req, res) => {
  const { companyId } = req.user;
  const { id } = req.params;
  const { name, weekStart } = req.body;
  if (weekStart && !isMonday(weekStart)) return res.status(400).json({ message: 'La semaine doit commencer un lundi.' });

  try {
    let slots = null;
    if (weekStart) {
      slots = await readWeekSlots(companyId, weekStart);
      if (slots.length === 0) {
        return res.status(400).json({ message: 'Cette semaine ne contient aucun créneau ni repos à enregistrer.' });
      }
    }
    const result = await db.query(
      `UPDATE week_templates
       SET name = COALESCE($1, name), slots = COALESCE($2::jsonb, slots), updated_at = NOW()
       WHERE id = $3 AND company_id = $4
       RETURNING ${COLUMNS}`,
      [name || null, slots ? JSON.stringify(slots) : null, id, companyId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Semaine type introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// DELETE /api/week-templates/:id
const deleteWeekTemplate = async (req, res) => {
  const { companyId } = req.user;
  const { id } = req.params;
  try {
    const result = await db.query(
      'DELETE FROM week_templates WHERE id = $1 AND company_id = $2 RETURNING id',
      [id, companyId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Semaine type introuvable.' });
    res.json({ message: 'Semaine type supprimée.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// POST /api/week-templates/apply
// Body : { weekStart, mode: 'empty' | 'replace', templateId } ou { …, copyPrevious: true }
// Réponse : { added, replaced, kept, protected, ignored }
const applyWeekTemplate = async (req, res) => {
  const { companyId, id: adminId } = req.user;
  const { weekStart, mode, templateId, copyPrevious, slots: givenSlots } = req.body;
  if (!isMonday(weekStart)) return res.status(400).json({ message: 'La semaine doit commencer un lundi.' });

  let slots;
  try {
    if (givenSlots) {
      // « Annuler » après avoir vidé la semaine : on remet ce qui a été effacé
      slots = givenSlots;
    } else if (templateId) {
      const tpl = (await db.query(
        'SELECT slots FROM week_templates WHERE id = $1 AND company_id = $2',
        [templateId, companyId]
      )).rows[0];
      if (!tpl) return res.status(404).json({ message: 'Semaine type introuvable.' });
      slots = tpl.slots || [];
    } else {
      slots = await readWeekSlots(companyId, addDays(weekStart, -7));
      if (slots.length === 0) {
        return res.status(400).json({ message: 'La semaine précédente est vide : rien à copier.' });
      }
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }

  const client = await db.connect();
  try {
    const active = new Set((await client.query(
      'SELECT id FROM users WHERE company_id = $1 AND is_active = TRUE',
      [companyId]
    )).rows.map((r) => r.id));

    const existing = new Map((await client.query(
      `SELECT user_id, date, COALESCE(type, 'travail') AS type FROM shifts
       WHERE company_id = $1 AND date BETWEEN $2::date AND $3::date`,
      [companyId, weekStart, addDays(weekStart, 6)]
    )).rows.map((r) => [`${r.user_id}|${toLocalDateString(r.date)}`, r.type]));

    const counts = { added: 0, replaced: 0, kept: 0, protected: 0, ignored: 0 };
    await client.query('BEGIN');

    for (const slot of slots) {
      if (!active.has(slot.userId)) { counts.ignored += 1; continue; }
      const date = addDays(weekStart, slot.weekday);
      const current = existing.get(`${slot.userId}|${date}`);
      if (current && PROTECTED_TYPES.includes(current)) { counts.protected += 1; continue; }
      if (current && mode === 'empty') { counts.kept += 1; continue; }

      const shift = (await client.query(
        `INSERT INTO shifts (user_id, company_id, date, start_time, end_time, note, type, created_by)
         VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)
         ON CONFLICT (user_id, date)
         DO UPDATE SET start_time = $4, end_time = $5, note = NULL, type = $6, updated_at = NOW()
         RETURNING id`,
        [slot.userId, companyId, date, slot.startTime, slot.endTime, slot.type, adminId]
      )).rows[0];
      await client.query('DELETE FROM shift_breaks WHERE shift_id = $1', [shift.id]);
      for (const b of slot.type === 'travail' ? slot.breaks || [] : []) {
        await client.query(
          'INSERT INTO shift_breaks (shift_id, start_time, end_time, label) VALUES ($1, $2, $3, $4)',
          [shift.id, b.start_time, b.end_time, b.label || 'Pause']
        );
      }
      counts[current ? 'replaced' : 'added'] += 1;
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

// POST /api/week-templates/clear — { weekStart, userIds }
// Vide la semaine (12 nov. 2026, demande de Cédric) : supprime les créneaux
// et repos des salariés indiqués (ceux affichés dans le planning). Les
// congés et absences ne sont jamais effacés. Renvoie ce qui a été effacé,
// au format des semaines types, pour pouvoir l'annuler.
const clearWeek = async (req, res) => {
  const { companyId } = req.user;
  const { weekStart, userIds } = req.body;
  if (!isMonday(weekStart)) return res.status(400).json({ message: 'La semaine doit commencer un lundi.' });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const shifts = (await client.query(
      `SELECT s.id, s.user_id, s.start_time, s.end_time, COALESCE(s.type, 'travail') AS type,
              (s.date - $2::date) AS weekday
       FROM shifts s
       WHERE s.company_id = $1 AND s.date BETWEEN $2::date AND $3::date
         AND s.user_id = ANY($4::uuid[])
         AND COALESCE(s.type, 'travail') IN ('travail', 'repos')
       FOR UPDATE`,
      [companyId, weekStart, addDays(weekStart, 6), userIds]
    )).rows;
    const ids = shifts.map((s) => s.id);
    const breaks = ids.length ? (await client.query(
      'SELECT shift_id, start_time, end_time, label FROM shift_breaks WHERE shift_id = ANY($1) ORDER BY start_time',
      [ids]
    )).rows : [];
    if (ids.length) await client.query('DELETE FROM shifts WHERE id = ANY($1) AND company_id = $2', [ids, companyId]);
    await client.query('COMMIT');

    res.json({
      deleted: ids.length,
      slots: shifts.map((s) => ({
        userId: s.user_id,
        weekday: Number(s.weekday),
        type: s.type,
        startTime: hhmm(s.start_time),
        endTime: hhmm(s.end_time),
        breaks: s.type === 'travail'
          ? breaks.filter((b) => b.shift_id === s.id)
            .map((b) => ({ start_time: hhmm(b.start_time), end_time: hhmm(b.end_time), label: b.label || 'Pause' }))
          : [],
      })),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  } finally {
    client.release();
  }
};

module.exports = {
  getWeekTemplates, createWeekTemplate, updateWeekTemplate, deleteWeekTemplate, applyWeekTemplate, clearWeek,
};
