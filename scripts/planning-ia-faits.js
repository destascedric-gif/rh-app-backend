// ─────────────────────────────────────────────
// PLANNING PAR IA — essai du calcul des habitudes, SANS IA et EN LECTURE SEULE
// Affiche ce qu'Orgaly enverrait à l'IA pour un mois, puis vérifie les règles
// strictes sur les cases déjà posées dans ce mois.
//
//   npm.cmd run planning-ia -- "nom de l'entreprise" 2027 1
//   npm.cmd run planning-ia -- "nom de l'entreprise" 2027 1 --json   (tout le détail)
//
// La connexion est mise en lecture seule : ce script ne peut rien modifier.
// ─────────────────────────────────────────────
require('dotenv').config();
const db = require('../src/config/db');
const { gatherFacts } = require('../src/services/aiPlanning/facts');
const { checkPlanning, frenchDate } = require('../src/services/aiPlanning/rules');

const [companyName, yearArg, monthArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const asJson = process.argv.includes('--json');

const LABELS = { travail: 'travaille', repos: 'repos', vide: 'rien de posé', variable: 'variable' };

(async () => {
  if (!companyName || !yearArg || !monthArg) {
    console.log('Usage : npm.cmd run planning-ia -- "nom de l\'entreprise" ANNÉE MOIS [--json]');
    process.exit(1);
  }
  const client = await db.connect();
  try {
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    const found = (await client.query('SELECT id, name FROM company WHERE name ILIKE $1', [`%${companyName}%`])).rows;
    if (found.length !== 1) {
      console.log(found.length === 0 ? 'Aucune entreprise trouvée.' : `Plusieurs entreprises : ${found.map((c) => c.name).join(', ')}`);
      process.exit(1);
    }

    const facts = await gatherFacts(client, found[0].id, { year: Number(yearArg), month: Number(monthArg) });
    const check = checkPlanning({ facts, proposal: [] });
    if (asJson) { console.log(JSON.stringify({ facts, check }, null, 2)); return; }

    const h = facts.habits;
    console.log(`\n=== ${facts.company.name} — génération de ${frenchDate(facts.month.first).split(' ').slice(2).join(' ')} ===`);
    console.log(`Période générée : du ${frenchDate(facts.range.start)} au ${frenchDate(facts.range.end)}`);
    console.log(`Historique étudié : ${h.weeksStudied.length} semaine(s) planifiée(s) (du ${facts.historyRange.start} au ${facts.historyRange.end})`);
    console.log(`Horaires types : ${facts.templates.map((t) => `${t.name} ${t.startTime}-${t.endTime}`).join(' ; ') || 'aucun'}`);
    console.log(`Cases déjà posées dans la période : ${facts.existing.length}`);

    console.log('\n--- Points à signaler au gérant ---');
    if (h.warnings.length === 0) console.log('Aucun.');
    h.warnings.forEach((w) => console.log(`• ${w.message}`));

    console.log('\n--- Habitudes de chacun ---');
    for (const p of h.people) {
      const contract = p.isManager ? 'gérant, sans objectif d\'heures' : `contrat ${p.contractHours} h`;
      console.log(`\n${p.firstName} (${p.jobTitle || 'poste non rempli'}, ${contract})`);
      for (const d of p.days) {
        if (d.observed === 0) continue;
        const shift = d.habit === 'travail' && d.usualShift ? `, en général ${d.usualShift}` : '';
        console.log(`   ${d.day.padEnd(9)} ${LABELS[d.habit]} (${d.share} %)${shift}`);
      }
      const rhythm = p.weekHours.map((x) => `${String(Math.round(x.hours * 10) / 10).replace('.', ',')}`).join(' / ');
      console.log(`   Heures par semaine : ${rhythm || '—'}${p.meanHours != null ? ` (moyenne ${String(p.meanHours).replace('.', ',')} h)` : ''}`);
      if (p.gapHours != null) console.log(`   Compteur d'écart : ${p.gapHours > 0 ? '+' : ''}${String(p.gapHours).replace('.', ',')} h sur ces semaines`);
      p.unusualWeeks.forEach((u) => console.log(`   (semaine du ${u.week} mise de côté : ${u.reason})`));
    }

    console.log('\n--- Habitudes de la boutique ---');
    for (const s of h.staffing) {
      if (!s.open) { console.log(`${s.day.padEnd(9)} fermé`); continue; }
      if (!s.observed) { console.log(`${s.day.padEnd(9)} pas d'historique`); continue; }
      console.log(`${s.day.padEnd(9)} ${s.usualPeople} personne(s) (${s.usualPeopleShare} %), ouverture ${s.usualOpening}, fermeture ${s.usualClosing}`);
      console.log(`          présents : ${s.presence.map((r) => `${r.from}-${r.to} : ${r.count}`).join(' ; ')}`);
      s.byTitle.forEach((t) => console.log(`          ${t.jobTitle} : ${t.usualCount} par jour, présent toute la journée ${t.alwaysPresentShare} % des jours`));
    }

    console.log('\n--- Vérification des règles strictes sur les cases déjà posées ---');
    console.log(`${check.counts.bloquant} bloquant(s), ${check.counts.avertissement} avertissement(s), ${check.counts.info} écart(s) à l'habitude`);
    check.problems.forEach((p) => console.log(`• [${p.level}] ${p.message}`));
  } finally {
    client.release();
    await db.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
