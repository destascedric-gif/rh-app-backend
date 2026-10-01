const express  = require('express');
const router   = express.Router();
const auth     = require('../middleware/auth');
const isAdmin  = require('../middleware/isAdmin');
const validate = require('../middleware/validate');
const { meetingSchema } = require('../validators/meetings.validators');
const ctrl     = require('../controllers/meetings.controller');

router.use(auth);

// Lecture : le gérant voit toutes les réunions, l'employé les siennes
router.get('/', ctrl.listMeetings);

// Écriture réservée au gérant
router.post  ('/',    isAdmin, validate(meetingSchema), ctrl.createMeeting);
router.put   ('/:id', isAdmin, validate(meetingSchema), ctrl.updateMeeting);
router.delete('/:id', isAdmin, ctrl.deleteMeeting);

module.exports = router;
