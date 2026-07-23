const db = require('../config/db');

// GET /api/shift-templates
const getShiftTemplates = async (req, res) => {
  const { companyId } = req.user;
  try {
    const result = await db.query(
      `SELECT id, name, start_time, end_time, break_start, break_end
       FROM shift_templates
       WHERE company_id = $1
       ORDER BY start_time`,
      [companyId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// POST /api/shift-templates
const createShiftTemplate = async (req, res) => {
  const { companyId } = req.user;
  const { name, startTime, endTime, breakStart, breakEnd } = req.body;

  if (!name || !startTime || !endTime) {
    return res.status(400).json({ message: 'Nom, heure de début et heure de fin sont requis.' });
  }
  if (startTime >= endTime) {
    return res.status(400).json({ message: "L'heure de début doit être avant l'heure de fin." });
  }

  try {
    const result = await db.query(
      `INSERT INTO shift_templates (company_id, name, start_time, end_time, break_start, break_end)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, start_time, end_time, break_start, break_end`,
      [companyId, name, startTime, endTime, breakStart || null, breakEnd || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// PUT /api/shift-templates/:id
const updateShiftTemplate = async (req, res) => {
  const { companyId } = req.user;
  const { id } = req.params;
  const { name, startTime, endTime, breakStart, breakEnd } = req.body;

  if (!name || !startTime || !endTime) {
    return res.status(400).json({ message: 'Nom, heure de début et heure de fin sont requis.' });
  }
  if (startTime >= endTime) {
    return res.status(400).json({ message: "L'heure de début doit être avant l'heure de fin." });
  }

  try {
    const result = await db.query(
      `UPDATE shift_templates
       SET name = $1, start_time = $2, end_time = $3, break_start = $4, break_end = $5
       WHERE id = $6 AND company_id = $7
       RETURNING id, name, start_time, end_time, break_start, break_end`,
      [name, startTime, endTime, breakStart || null, breakEnd || null, id, companyId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Modèle introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// DELETE /api/shift-templates/:id
const deleteShiftTemplate = async (req, res) => {
  const { companyId } = req.user;
  const { id } = req.params;
  try {
    const result = await db.query(
      'DELETE FROM shift_templates WHERE id = $1 AND company_id = $2 RETURNING id',
      [id, companyId]
    );
    if (!result.rows[0]) return res.status(404).json({ message: 'Modèle introuvable.' });
    res.json({ message: 'Modèle supprimé.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

module.exports = { getShiftTemplates, createShiftTemplate, updateShiftTemplate, deleteShiftTemplate };
