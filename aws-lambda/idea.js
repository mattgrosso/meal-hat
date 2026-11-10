// TODAY'S IDEA (2026-11-09): one thing the house could cook today, from the
// food that is already in it.
//
// Carrie's idea, through Matt: the kitchen wall display should, "in a fairly
// subtle and quiet way", suggest a meal made from what the fridge tally says
// is in the house. What Matt settled, in his words:
//   - "the recipes should only ever be able to be made with what we already
//     have in the house."
//   - "we don't need three a day. I think one a day would be fine."
//   - "you can be a bit lax with what spices we have and stuff, and assume we
//     have a pretty comfortable spice collection."
//   - no photos, and none generated.
//
// So: ONE idea a day, written fresh from the tally. Water, salt, pepper and
// dried spices are assumed; everything else has to be on the tally, and that
// is CHECKED here in code (checkIdea) rather than left to the prompt. An idea
// that fails the check is asked for once more with the reasons, and if it
// fails again there is no idea today, which is the right answer: a wrong one
// sends somebody to a cupboard for an onion that isn't there.
//
// This file is the part that can be tested without AWS or a model; the job
// plumbing (and the once-a-day marker) is in perishable-vision.js.

// The day belongs to the house, not to whichever device asks: Eastern time,
// turning over at 4am so a late-night look at the wall still shows today's.
// src/store/fridge/idea.js carries the same function for the app, and
// tests/unit/fridge/idea.spec.js holds the two to the same answers.
const IDEA_DAY_STARTS_AT_HOUR = 4;
const ideaDay = (now = new Date()) => {
  const shifted = new Date(new Date(now).getTime() - IDEA_DAY_STARTS_AT_HOUR * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(shifted);
};

// A kitchen with four things in it cannot be cooked from, and asking would
// only buy a strained answer.
const MIN_TALLY = 8;
const MAX_TALLY = 400;
const MAX_TITLE = 80;
const MAX_RECENT = 30;
// One idea a day; the spare goes are for a day whose first try failed.
const MAX_TRIES_PER_DAY = 3;

const norm = (text) => String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');

// What arrives from the app, checked before it costs anything.
const ideaRequestError = (idea) => {
  if (!idea || typeof idea !== 'object' || Array.isArray(idea)) {
    return { status: 400, error: 'An idea request needs the tally' };
  }
  const { tally, recent } = idea;
  if (!Array.isArray(tally)) return { status: 400, error: 'An idea request needs the tally' };
  if (tally.length > MAX_TALLY) return { status: 413, error: 'That is too much food to read at once' };
  for (const row of tally) {
    if (!row || typeof row.title !== 'string' || !row.title.trim() || row.title.length > MAX_TITLE) {
      return { status: 400, error: 'Every food on the tally needs a name' };
    }
    if (row.quantity !== undefined && !(typeof row.quantity === 'number' && row.quantity >= 0 && row.quantity < 1000)) {
      return { status: 400, error: 'A quantity on the tally is not a number' };
    }
    if (row.daysLeft !== undefined && row.daysLeft !== null && !Number.isFinite(row.daysLeft)) {
      return { status: 400, error: 'A date on the tally is not a number' };
    }
  }
  if (tally.length < MIN_TALLY) {
    return { status: 400, error: 'There is not enough on the tally to cook from yet' };
  }
  if (recent !== undefined) {
    if (!Array.isArray(recent) || recent.length > MAX_RECENT ||
        recent.some((name) => typeof name !== 'string' || name.length > 120)) {
      return { status: 400, error: 'The recent ideas are not a list of names' };
    }
  }
  return null;
};

const IDEA_SCHEMA = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'What the dish is called, the way it would be chalked on a cafe board: "Orzo with spinach and sun-dried tomatoes". Plain words, no adjectives selling it, 60 characters at most.'
    },
    line: {
      type: 'string',
      description: 'One short plain sentence that makes somebody want it, or says why today. No exclamation marks.'
    },
    minutes: {
      type: 'integer',
      description: 'Minutes from starting to sitting down.'
    },
    ingredients: {
      type: 'array',
      description: 'Everything the dish needs, including water and every spice.',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The ingredient as a cook writes it: "spinach", "sun-dried tomatoes", "smoked paprika".'
          },
          amount: {
            type: 'string',
            description: 'How much, in kitchen terms: "2 cups", "a big handful", "1 clove", "half the jar".'
          },
          from: {
            type: 'string',
            enum: ['house', 'spice', 'water'],
            description: '"house" for a food on the list. "spice" ONLY for salt, pepper, and dried spices and dried herbs. "water" for water.'
          },
          listName: {
            type: 'string',
            description: 'For "house": the food\'s name EXACTLY as it appears on the list, character for character. Empty string for "spice" and "water".'
          }
        },
        required: ['name', 'amount', 'from', 'listName'],
        additionalProperties: false
      }
    },
    steps: {
      type: 'array',
      description: 'Three to seven short steps in plain kitchen English, each one thing to do.',
      items: { type: 'string' }
    }
  },
  required: ['name', 'line', 'minutes', 'ingredients', 'steps'],
  additionalProperties: false
};

const tallyLine = (row) => {
  const parts = [row.title.trim()];
  const quantity = row.quantity === undefined ? 1 : row.quantity;
  if (quantity !== 1) parts.push(`${Math.round(quantity * 100) / 100} packages`);
  if (row.shelfStable) parts.push('keeps');
  else if (Number.isFinite(row.daysLeft)) {
    parts.push(row.daysLeft <= 0 ? 'goes off today' : `${row.daysLeft} day${row.daysLeft === 1 ? '' : 's'} left`);
  }
  return `- ${parts.join(' | ')}`;
};

const buildIdeaPrompt = ({ tally, recent = [] }) => `A family has a small screen on their kitchen wall. Each morning it shows one idea for something they could cook today out of the food that is already in the house. Somebody glances at it while the coffee brews; if it sounds good they tap it and cook from your steps that evening. Your job is to write today's idea.

Nobody is going to the shop for this. An idea that needs even one thing they don't have is worse than no idea, because they find out halfway through cooking. The list below is the whole kitchen.

<kitchen>
${tally.map(tallyLine).join('\n')}
</kitchen>

Each line is a food, then how many packages if it isn't one (a fraction is a part-used package: "0.2 packages" of garlic is a couple of cloves), then how long it has left. "keeps" means it is a pantry store with no date to worry about.

What the dish may use:
- Any food on the list. Mark it "house" and give its listName exactly as written above.
- Water.
- Salt, pepper, and dried spices and dried herbs. They keep a well-stocked spice rack, so assume the usual ones are there and mark them "spice".
- Nothing else. Oil, butter, flour, sugar, vinegar, stock, soy sauce, onions, garlic, lemons, fresh herbs, eggs, milk and cheese are all food, not spices: each one is available only if it is on the list. If the dish you have in mind needs something that isn't there, choose a different dish; don't leave it out and hope, and don't mention it in a step as optional.

List every ingredient the steps use, including the oil the pan needs and every spice. A step must not call for anything that isn't in the ingredients.

What makes it a good idea:
- It is a real dish that somebody would be glad to sit down to, not a way of using things up. If the honest best thing in this kitchen today is a very good grilled cheese with something sharp alongside, say that.
- This family mostly cooks easy pasta, cheese and bread dinners and is trying to enjoy cooking more. Aim a little past what they would have thought of themselves, but keep it something a relaxed home cook makes on a weeknight: about 45 minutes or less of actual work, ordinary pans, no technique that needs practice.
- Lean toward the food with the fewest days left when it makes a dish that is just as good. Never bend the dish out of shape to do it.
- Mind the amounts. Don't build dinner on a food there is only a scrap of.
- One of the family is vegetarian, so make it a vegetarian dish, unless the list has both a meat and its vegetarian twin (burger patties and veggie patties, hot dogs and veggie dogs), in which case a dish that works with either is fine: list both and say so in a step.
- A lot of this list is ready-made food (frozen meals, snack bars, cereal). Cook from the ingredients; reheating a ready meal is not an idea.
${recent.length ? `- Make it clearly different from the ideas of the last few days:\n${recent.map((name) => `  - ${name}`).join('\n')}` : ''}

How to write it: plain and warm, the way one friend tells another what to make. No salesmanship, no exclamation marks, no "delicious". Steps are short and say what to do and how to tell it's done.`;

// Staples a recipe reaches for without thinking. A step that names one must
// have it among the ingredients, because that is exactly how an idea ends up
// needing something the house does not have: "soften an onion in a little
// oil" with neither on the list. Word-boundary matches, so "boil" is not oil
// and "creamy" is not cream.
const STAPLES = [
  ['oil', /\boil\b/], ['butter', /\bbutter\b/], ['flour', /\bflour\b/], ['sugar', /\bsugar\b/],
  ['vinegar', /\bvinegar\b/], ['stock', /\b(stock|broth)\b/], ['onion', /\bonions?\b/],
  ['garlic', /\bgarlic\b/], ['lemon', /\blemons?\b/], ['lime', /\blimes?\b/], ['egg', /\beggs?\b/],
  ['milk', /\bmilk\b/], ['cream', /\bcream\b/], ['cheese', /\bcheese\b/], ['honey', /\bhoney\b/],
  ['soy sauce', /\bsoy sauce\b/], ['wine', /\bwine\b/], ['mustard', /\bmustard\b/]
];

// Is this idea something the house can actually make? Returns the problems in
// words a person (and the model, on the second go) can act on. `idea` is
// normalised in the same pass: each house ingredient gets the tally's own
// spelling of its name.
const checkIdea = (idea, tally) => {
  const problems = [];
  const byName = new Map(tally.map((row) => [norm(row.title), row.title.trim()]));

  if (!idea || typeof idea.name !== 'string' || !idea.name.trim()) problems.push('The dish has no name.');
  const ingredients = Array.isArray(idea?.ingredients) ? idea.ingredients : [];
  const steps = Array.isArray(idea?.steps) ? idea.steps.filter((step) => typeof step === 'string' && step.trim()) : [];
  if (!steps.length) problems.push('There are no steps.');

  const checked = [];
  let fromHouse = 0;
  for (const item of ingredients) {
    if (!item || typeof item.name !== 'string' || !item.name.trim()) continue;
    const from = ['house', 'spice', 'water'].includes(item.from) ? item.from : 'house';
    if (from === 'house') {
      const listed = byName.get(norm(item.listName));
      if (!listed) {
        problems.push(`"${item.name}" is marked as in the house, but "${item.listName || ''}" is not a name on the list.`);
        continue;
      }
      fromHouse += 1;
      checked.push({ name: item.name.trim(), amount: String(item.amount || '').trim(), from, listName: listed });
    } else {
      // Something filed under spices that the tally knows as a food is fine
      // (salt is on Matt's tally); it just gets its tally name.
      const listed = byName.get(norm(item.name));
      checked.push({ name: item.name.trim(), amount: String(item.amount || '').trim(), from, listName: listed || '' });
    }
  }
  if (fromHouse < 2) problems.push('A dish needs at least two foods from the list.');

  const named = norm(checked.map((item) => `${item.name} ${item.listName}`).join(' | '));
  const said = norm(steps.join(' '));
  for (const [staple, pattern] of STAPLES) {
    if (pattern.test(said) && !pattern.test(named)) {
      problems.push(`A step uses ${staple}, which is not among the ingredients. If it is on the list, add it; if not, the dish cannot use it.`);
    }
  }

  const minutes = Number.isFinite(idea?.minutes) ? Math.max(1, Math.round(idea.minutes)) : null;
  return {
    ok: problems.length === 0,
    problems,
    idea: {
      name: String(idea?.name || '').trim(),
      line: String(idea?.line || '').trim(),
      minutes,
      ingredients: checked,
      steps: steps.map((step) => step.trim())
    }
  };
};

// The read. `readStructured` is perishable-vision.js's own (model, token
// budget, cut-off check), handed in so this file needs no SDK and a test can
// stand in for the model.
const NO_IDEA = 'Nothing came together from what is in the house today.';
const readIdea = async ({ idea: request }, { readStructured }) => {
  const prompt = buildIdeaPrompt(request);
  const ask = (messages) => readStructured({
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: IDEA_SCHEMA } },
    messages
  }, NO_IDEA);

  const first = await ask([{ role: 'user', content: prompt }]);
  let result = checkIdea(first, request.tally);
  if (!result.ok) {
    console.log('Idea failed its check, asking once more:', result.problems.join(' '));
    const second = await ask([
      { role: 'user', content: prompt },
      { role: 'assistant', content: JSON.stringify(first) },
      {
        role: 'user',
        content: `That one can't be made from this kitchen:\n${result.problems.map((p) => `- ${p}`).join('\n')}\n\nWrite today's idea again so that every ingredient is on the list (or is water, salt, pepper or a dried spice). Choose a different dish if this one needs the missing thing.`
      }
    ]);
    result = checkIdea(second, request.tally);
  }
  if (!result.ok) {
    const error = new Error(NO_IDEA);
    error.userFacing = true;
    error.problems = result.problems;
    throw error;
  }
  return { kind: 'idea', idea: result.idea };
};

module.exports = {
  IDEA_DAY_STARTS_AT_HOUR,
  IDEA_SCHEMA,
  MAX_TRIES_PER_DAY,
  MIN_TALLY,
  NO_IDEA,
  buildIdeaPrompt,
  checkIdea,
  ideaDay,
  ideaRequestError,
  readIdea
};
