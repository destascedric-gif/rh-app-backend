const db = require('../config/db');
const { pickFreeColor } = require('../services/shiftColors');

const COLUMNS = 'id, name, start_time, end_time, break_start, break_end, color';

// GET /api/shift-templates — lisible par tous (les employés en ont besoin
// pour la légende des couleurs de leur planning)
const getShiftTemplates = async (req, res) => {
  const { companyId } = req.user;
  try {
    const result = await db.query(
      `SELECT ${COLUMNS}
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

// POST /api/shift-templates — couleur choisie, sinon la première libre
const createShiftTemplate = async (req, res) => {
  const { companyId } = req.user;
  const { name, startTime, endTime, breakStart, breakEnd, color } = req.body;

  try {
    let finalColor = color;
    if (!finalColor) {
      const used = await db.query('SELECT color FROM shift_templates WHERE company_id = $1', [companyId]);
      finalColor = pickFreeColor(used.rows.map((r) => r.color));
    }

    const result = await db.query(
      `INSERT INTO shift_templates (company_id, name, start_time, end_time, break_start, break_end, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${COLUMNS}`,
      [companyId, name, startTime, endTime, breakStart || null, breakEnd || null, finalColor]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// PUT /api/shift-templates/:id — couleur inchangée si non fournie
const updateShiftTemplate = async (req, res) => {
  const { companyId } = req.user;
  const { id } = req.params;
  const { name, startTime, endTime, breakStart, breakEnd, color } = req.body;

  try {
    const result = await db.query(
      `UPDATE shift_templates
       SET name = $1, start_time = $2, end_time = $3, break_start = $4, break_end = $5,
           color = COALESCE($6, color)
       WHERE id = $7 AND company_id = $8
       RETURNING ${COLUMNS}`,
      [name, startTime, endTime, breakStart || null, breakEnd || null, color || null, id, companyId]
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
