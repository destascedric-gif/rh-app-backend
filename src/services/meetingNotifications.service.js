const db = require('../config/db');

// ─────────────────────────────────────────────
// NOTIFICATIONS DE RÉUNION
// Prévient les participants (cloche de l'appli, pas d'e-mail) quand une
// réunion à venir est créée, modifiée ou annulée, ou quand ils y sont
// ajoutés ou en sont retirés. La personne qui fait le changement (le
// gérant, parfois lui-même participant) n'est pas prévenue.
// ─────────────────────────────────────────────

// Date du jour en France, 'YYYY-MM-DD' (le serveur tourne en UTC)
const todayInFrance = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

// '2026-11-10' → 'mardi 10 novembre'
const dayLabel = (date) => new Date(`${date}T12:00:00Z`)
  .toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

// '14:00' → '14h', '14:30' → '14h30'
const timeLabel = (t) => {
  const [h, m] = String(t).slice(0, 5).split(':');
  return `${Number(h)}h${m === '00' ? '' : m}`;
};

// Titre entre guillemets, sauf le titre par défaut « Réunion »
const titleLabel = (m) => (m.title && m.title !== 'Réunion' ? ` « ${m.title} »` : '');

const when = (m) => `le ${dayLabel(m.date)} de ${timeLabel(m.start_time)} à ${timeLabel(m.end_time)}`;

const insertNotifications = async (userIds, meetingId, message) => {
  if (userIds.length === 0) return;
  await db.query(
    `INSERT INTO meeting_notifications (user_id, meeting_id, message)
     SELECT unnest($1::uuid[]), $2, $3`,
    [userIds, meetingId, message]
  );
};

const participantIds = (m) => (m?.participants ?? []).map((p) => p.id);

/**
 * Prévient les participants concernés par un changement de réunion.
 * before / after : réunions au format de getMeeting (date 'YYYY-MM-DD',
 * heures 'HH:MM', participants [{ id }]) ; null = création / suppression.
 * Les réunions déjà passées ne donnent lieu à aucune notification.
 */
const notifyMeetingChange = async ({ before = null, after = null, actorId }) => {
  const today = todayInFrance();
  const upcoming = (m) => m && m.date >= today;
  if (!upcoming(before) && !upcoming(after)) return;

  const others = (ids) => ids.filter((id) => id !== actorId);
  const beforeIds = participantIds(before);
  const afterIds  = participantIds(after);

  // Annulation
  if (!after) {
    await insertNotifications(others(beforeIds), null,
      `❌ Réunion${titleLabel(before)} du ${dayLabel(before.date)} annulée.`);
    return;
  }

  // Nouveaux participants (ou création) : invitation
  const added = others(afterIds.filter((id) => !beforeIds.includes(id)));
  if (upcoming(after)) {
    await insertNotifications(added, after.id,
      `📅 Nouvelle réunion${titleLabel(after)} ${when(after)}.`);
  }

  if (!before) return;

  // Participants retirés
  const removed = others(beforeIds.filter((id) => !afterIds.includes(id)));
  if (upcoming(before)) {
    await insertNotifications(removed, after.id,
      `Vous ne participez plus à la réunion${titleLabel(before)} du ${dayLabel(before.date)}.`);
  }

  // Participants qui restent : seulement si la date, l'horaire ou le titre change
  const changed = before.date !== after.date || before.start_time !== after.start_time
    || before.end_time !== after.end_time || before.title !== after.title;
  if (changed && upcoming(after)) {
    const kept = others(afterIds.filter((id) => beforeIds.includes(id)));
    await insertNotifications(kept, after.id,
      `✏️ Réunion${titleLabel(after)} modifiée : ${when(after)}.`);
  }
};

module.exports = { notifyMeetingChange };
