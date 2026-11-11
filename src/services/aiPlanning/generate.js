// ─────────────────────────────────────────────
// PLANNING PAR IA — appel à l'IA (Claude, d'Anthropic) et boucle de correction
// 1. Orgaly résume les faits (facts.js) et les demandes du gérant ;
// 2. l'IA propose les cases du mois (semaines entières) ;
// 3. Orgaly vérifie (rules.js) ; s'il reste une erreur bloquante, la
//    proposition repart à l'IA avec la liste des erreurs (2 fois au plus) ;
// 4. le résultat est montré au gérant, qui valide ou redemande.
// Rien n'est écrit dans le planning ici.
// Ce qui part chez Anthropic : prénoms, postes, horaires et règles. Jamais
// de nom de famille, salaire, e-mail, téléphone ni date de naissance.
// ─────────────────────────────────────────────
const Anthropic = require('@anthropic-ai/sdk');
const { z } = require('zod');
const { checkPlanning, PROTECTED_TYPES } = require('./rules');
const { DAY_NAMES } = require('./time');

const MODEL = process.env.AI_PLANNING_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.AI_PLANNING_EFFORT || 'high';
const MAX_CORRECTIONS = 2;
// Prix Anthropic (dollars par million de « jetons »), vérifiés le 11 nov. 2026
// pour Claude Opus 5.5 : sert seulement à estimer le coût de chaque génération.
const PRICE = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };
const REST = { startTime: '00:00', endTime: '23:59' }; // une case « repos » couvre la journée

class AiPlanningUnavailableError extends Error {}
class AiPlanningFailedError extends Error {}

let client = null;
const getClient = () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AiPlanningUnavailableError('La génération par IA n\'est pas encore activée.');
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 6 * 60 * 1000 });
  return client;
};

// ── Ce que l'IA doit savoir faire : toujours le même texte (mis en cache) ──
const SYSTEM_PROMPT = `Tu prépares le planning d'une petite entreprise (boutique, pharmacie, commerce) pour le logiciel Orgaly.
Tu reçois en JSON les faits calculés par Orgaly et les demandes écrites du gérant. Tu réponds uniquement avec le planning, au format demandé.

But : un planning que le gérant pourra garder tel quel, sans tout déplacer. Il doit ressembler à ce que l'entreprise fait d'habitude.

Ordre des priorités :
1. Règles strictes, jamais enfreintes (Orgaly les vérifie et te renverra le planning sinon) :
   - ne jamais toucher aux cases de "deja_poses" marquées "garder" (dont tous les congés et absences) ;
   - personne ne travaille un jour fermé, sauf demande du gérant ;
   - au plus 10 h de travail par jour (pauses déduites), au plus 48 h par semaine ;
   - au moins 11 h de repos entre la fin d'une journée et le début de la suivante (la veille de la période est dans "veille") ;
   - au moins 35 h de repos d'affilée chaque semaine (le dimanche seul suffit) ;
   - une pause d'au moins 20 minutes d'affilée dès 6 h de travail dans la journée ;
   - les règles de présence par poste ("regles_presence") : une personne de l'un des postes listés compte ;
     "à chaque heure d'ouverture" se vérifie à chaque quart d'heure, pauses comprises : décale les pauses pour qu'elles se relaient.
   Ces règles ne s'appliquent pas au gérant ("est_gerant"), sauf les cases à garder et les jours fermés.
2. Les demandes du gérant ("demandes_du_gerant"). Si une demande enfreint une règle stricte, ne la suis pas et explique-le dans "notes".
3. Les habitudes de chacun ("salaries[].jours") : jours travaillés, jours de repos, horaire habituel, et le rythme des heures
   ("heures_par_semaine") : garde ce rythme même s'il diffère du contrat (ex. 32 h puis 38 h pour un contrat de 35 h).
4. Le nombre habituel de personnes chaque jour et par quart d'heure ("boutique"), la composition habituelle par poste,
   et toujours quelqu'un à l'ouverture et à la fermeture habituelles.
5. Les horaires types ("horaires_types") plutôt que des horaires inventés, avec leur pause.
6. Les heures du contrat ("contrat_h") : seulement quand un ajustement est évident et ne casse aucune habitude.
   Si "contrat_confirme" est vrai, le contrat ne reflète pas le planning habituel : suis seulement l'habitude.
   "compteur_ecart_h" est informatif : ne rattrape des heures que si le gérant le demande.

Consignes :
- Remplis seulement les couples (salarié, date) de la période qui ne sont pas dans "deja_poses" avec "garder" : une case par salarié et par jour au plus.
- Mets une case "repos" là où l'habitude du jour est "repos" (le gérant les pose lui-même). Ne mets rien là où l'habitude est "vide".
- Une habitude "variable" : choisis selon le besoin de la boutique et le rythme des heures.
- Jour férié ("ferie") un jour d'ouverture : fais comme l'historique ("feries_passes") ; si la boutique n'y a jamais travaillé, ne mets personne, sauf demande du gérant.
- Le gérant ("est_gerant") se planifie selon ses habitudes, sans objectif d'heures.
- Heures au format HH:MM (24 h). Les pauses sont dans les horaires de la case. Pour un repos, debut "00:00", fin "23:59", pas de pause.
- Utilise le code des salariés ("s1", "s2"…) dans "salarie".
- "notes" : 0 à 6 phrases courtes en français, pour le gérant, avec les prénoms : ce que tu n'as pas pu respecter et pourquoi,
  ou un choix important. Pas de phrase pour dire que tout va bien.`;

// Format de réponse imposé à l'IA
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cases', 'notes'],
  properties: {
    cases: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['salarie', 'date', 'type', 'debut', 'fin', 'pauses'],
        properties: {
          salarie: { type: 'string' },
          date: { type: 'string' },
          type: { type: 'string', enum: ['travail', 'repos'] },
          debut: { type: 'string' },
          fin: { type: 'string' },
          pauses: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['debut', 'fin'],
              properties: { debut: { type: 'string' }, fin: { type: 'string' } },
            },
          },
        },
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

// Vérification de la réponse (on ne fait jamais confiance au texte reçu)
const answerSchema = z.object({
  cases: z.array(z.object({
    salarie: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    type: z.enum(['travail', 'repos']),
    debut: z.string(),
    fin: z.string(),
    pauses: z.array(z.object({ debut: z.string(), fin: z.string() })),
  })).max(2000),
  notes: z.array(z.string().max(500)).max(10),
});

// ── Les faits, mis en forme pour l'IA ──
const buildFactsForAi = (facts, { mode, requests }) => {
  const codeOf = new Map(facts.employees.map((e, i) => [e.id, `s${i + 1}`]));
  const keep = (s) => mode !== 'replace' || PROTECTED_TYPES.includes(s.type);
  const h = facts.habits;
  const round = (x) => (x == null ? null : Math.round(x * 10) / 10);
  const slot = (s) => ({
    salarie: codeOf.get(s.userId),
    date: s.date,
    type: s.type,
    ...(s.type === 'travail' ? { debut: s.startTime, fin: s.endTime, pauses: s.breaks.map((b) => `${b.start_time}-${b.end_time}`) } : {}),
  });

  return {
    periode: { du: facts.range.start, au: facts.range.end, mois: facts.month.first.slice(0, 7) },
    jours: facts.days.map((d) => ({
      date: d.date, jour: DAY_NAMES[d.weekday], ouvert: d.open, ferie: d.holiday, dans_le_mois: d.inMonth,
    })),
    horaires_types: facts.templates.map((t) => ({
      nom: t.name, debut: t.startTime, fin: t.endTime, pause: t.breakStart ? `${t.breakStart}-${t.breakEnd}` : null,
    })),
    regles_presence: facts.presenceRules.map((r) => ({
      postes: r.jobTitles, minimum: r.min, quand: r.when === 'toujours' ? 'à chaque heure d\'ouverture' : 'au moins une fois dans la journée',
    })),
    boutique: h.staffing.filter((s) => s.open && s.observed).map((s) => ({
      jour: s.day,
      personnes_habituelles: s.usualPeople,
      ouverture: s.usualOpening,
      fermeture: s.usualClosing,
      presents_par_creneau: s.presence.map((p) => `${p.from}-${p.to}: ${p.count}`),
      par_poste: s.byTitle.map((t) => ({ poste: t.jobTitle, par_jour: t.usualCount, present_toute_la_journee_pct: t.alwaysPresentShare })),
    })),
    feries_passes: facts.holidayHistory.map((x) => ({ date: x.date, personnes_au_travail: x.workers })),
    salaries: h.people.map((p) => ({
      code: codeOf.get(p.userId),
      prenom: p.firstName,
      poste: p.jobTitle,
      est_gerant: p.isManager,
      contrat_h: p.contractHours,
      contrat_confirme: p.contractConfirmed,
      heures_par_semaine: p.weekHours.map((x) => round(x.hours)),
      compteur_ecart_h: p.gapHours,
      jours: p.days.filter((d) => d.observed > 0).map((d) => ({
        jour: d.day, habitude: d.habit, frequence_pct: d.share, horaire_habituel: d.usualShift,
      })),
    })),
    deja_poses: facts.existing.map((s) => ({ ...slot(s), garder: keep(s) })),
    veille: facts.lastDayBefore.filter((s) => s.type === 'travail').map(slot),
    demandes_du_gerant: requests?.trim() || 'Aucune demande particulière.',
    _codes: codeOf, // retiré avant l'envoi
  };
};

// Proposition de l'IA → cases Orgaly ; les cases à garder ne sont jamais remplacées
const toSlots = (answer, facts, { mode, userOfCode }) => {
  const existing = new Map(facts.existing.map((s) => [`${s.userId}|${s.date}`, s]));
  const slots = [];
  const dropped = [];
  for (const c of answer.cases) {
    const userId = userOfCode.get(c.salarie);
    if (!userId) { dropped.push(c); continue; }
    const current = existing.get(`${userId}|${c.date}`);
    if (current && (mode !== 'replace' || PROTECTED_TYPES.includes(current.type))) { dropped.push(c); continue; }
    slots.push(c.type === 'repos'
      ? { userId, date: c.date, type: 'repos', ...REST, breaks: [] }
      : {
        userId,
        date: c.date,
        type: 'travail',
        startTime: c.debut,
        endTime: c.fin,
        breaks: c.pauses.map((b) => ({ start_time: b.debut, end_time: b.fin, label: 'Pause' })),
      });
  }
  return { slots, dropped };
};

const estimateCost = (usage) => (
  (usage.input_tokens * PRICE.input
    + (usage.cache_creation_input_tokens || 0) * PRICE.cacheWrite
    + (usage.cache_read_input_tokens || 0) * PRICE.cacheRead
    + usage.output_tokens * PRICE.output) / 1e6
);

// Appel à l'IA (remplaçable dans les essais)
const callClaude = async (messages) => {
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    cache_control: { type: 'ephemeral' },
    system: SYSTEM_PROMPT,
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    messages,
  });
  return stream.finalMessage();
};

/**
 * Génère une proposition de planning pour le mois.
 * @param {object} facts     résultat de gatherFacts
 * @param {object} options   { mode: 'empty' | 'replace', requests, previous: { slots, requests }, refinement, call }
 * @returns {{ slots, problems, counts, notes, attempts, usage, costUsd, model }}
 */
const generatePlanning = async (facts, options = {}) => {
  const mode = options.mode === 'replace' ? 'replace' : 'empty';
  const call = options.call || callClaude;
  const aiFacts = buildFactsForAi(facts, { mode, requests: options.requests });
  const userOfCode = new Map([...aiFacts._codes].map(([id, code]) => [code, id]));
  delete aiFacts._codes;

  let intro = `Voici les faits pour générer le planning :\n${JSON.stringify(aiFacts)}`;
  // Retouche : la proposition précédente et la nouvelle demande du gérant
  if (options.previous && options.refinement) {
    const codeOf = new Map([...userOfCode].map(([code, id]) => [id, code]));
    const previous = options.previous.slots.map((s) => ({
      salarie: codeOf.get(s.userId), date: s.date, type: s.type,
      ...(s.type === 'travail' ? { debut: s.startTime, fin: s.endTime, pauses: (s.breaks || []).map((b) => `${b.start_time}-${b.end_time}`) } : {}),
    })).filter((s) => s.salarie);
    intro += `\n\nTu as déjà proposé ce planning :\n${JSON.stringify(previous)}`
      + `\n\nLe gérant demande une retouche : « ${options.refinement.trim()} »`
      + '\nGarde tout le reste à l\'identique autant que possible et renvoie le planning complet.';
  }

  const messages = [{ role: 'user', content: intro }];
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let result = null;
  let notes = [];

  for (let attempt = 0; attempt <= MAX_CORRECTIONS; attempt += 1) {
    const response = await call(messages);
    for (const k of Object.keys(usage)) usage[k] += response.usage?.[k] || 0;

    if (response.stop_reason === 'refusal') throw new AiPlanningFailedError('L\'IA a refusé de répondre. Réessayez en reformulant vos demandes.');
    if (response.stop_reason === 'max_tokens') throw new AiPlanningFailedError('La réponse de l\'IA était trop longue. Réessayez.');
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let answer;
    try {
      answer = answerSchema.parse(JSON.parse(text));
    } catch {
      throw new AiPlanningFailedError('La réponse de l\'IA est illisible. Réessayez.');
    }

    notes = answer.notes;
    const { slots } = toSlots(answer, facts, { mode, userOfCode });
    const check = checkPlanning({ facts, proposal: slots });
    result = { slots, check, attempts: attempt + 1 };
    const blocking = check.problems.filter((p) => p.level === 'bloquant');
    if (blocking.length === 0 || attempt === MAX_CORRECTIONS) break;

    // Correction : on renvoie la réponse telle quelle, puis la liste des erreurs
    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: `Orgaly a vérifié ton planning : ces règles strictes ne sont pas respectées.\n${blocking.map((p) => `- ${p.message}`).join('\n')}\nCorrige-les en changeant le moins de choses possible, et renvoie le planning complet.`,
    });
  }

  const costUsd = estimateCost(usage);
  console.log(`[planning IA] ${facts.company.name} ${facts.month.first.slice(0, 7)} : ${result.attempts} essai(s), ${usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens} jetons lus, ${usage.output_tokens} écrits, ~${costUsd.toFixed(3)} $`);

  return {
    slots: result.slots,
    problems: result.check.problems,
    counts: result.check.counts,
    notes,
    attempts: result.attempts,
    usage,
    costUsd,
    model: MODEL,
  };
};

module.exports = {
  generatePlanning, buildFactsForAi, toSlots, AiPlanningUnavailableError, AiPlanningFailedError,
  SYSTEM_PROMPT, OUTPUT_SCHEMA,
};
