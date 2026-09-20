// Reads grocery items out of a photo, so they can become Perishable timers.
//
// SHAPED AS A JOB, NOT A REQUEST — the architecture is Shelfie's, ported
// whole, because every piece of it failed once over there in a way that is
// now understood. Reading a dense photo takes 40-100+ seconds and API
// Gateway's integration timeout is a hard 30, so:
//
//   POST /scan          -> validates, stores a pending job, invokes ITSELF
//                          asynchronously, returns 202 { jobId }
//   (async invocation)  -> does the vision call, writes the result to S3
//   GET  /scan?job=ID   -> reports pending / done / failed
//
// One function rather than two because the worker shares every line of the
// reading logic. The async invocation is told apart by a marker the API
// can't forge: API Gateway events always carry requestContext.http, and this
// one doesn't. The photo goes to S3 rather than riding in the invoke payload
// (async invocations cap at 1MB; a real 1568px photo is ~1.16MB of base64).
//
// Runs on Lambda for one reason: the Anthropic key.
//
// AUTH IS THE HOUSEHOLD KEY, not a Firebase ID token — Perishable has no
// Firebase Auth (see src/lib/householdKey.js for why). The key is a bearer
// capability whose validity is checked against the database itself: a key
// under which a household actually exists is a real key. The endpoint spends
// money on every call and its URL ships in the public bundle, so it cannot
// be open; CORS only constrains browsers and this check is the actual gate.

const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

const client = new Anthropic();
const s3 = new S3Client({});
const lambda = new LambdaClient({});

const JOBS_BUCKET = process.env.JOBS_BUCKET;
const SELF = process.env.AWS_LAMBDA_FUNCTION_NAME;
const jobKey = (id) => `jobs/${id}.json`;
const inputKey = (id) => `jobs/${id}-input.json`;

const DATABASE_URL = 'https://meal-hat-default-rtdb.firebaseio.com';
const KEY_RE = /^[A-Za-z0-9_-]{32,}$/;

const putJob = async (id, body) => {
  await s3.send(new PutObjectCommand({
    Bucket: JOBS_BUCKET,
    Key: jobKey(id),
    Body: JSON.stringify(body),
    ContentType: 'application/json'
  }));
};

const putInput = async (id, payload) => {
  await s3.send(new PutObjectCommand({
    Bucket: JOBS_BUCKET,
    Key: inputKey(id),
    Body: JSON.stringify(payload),
    ContentType: 'application/json'
  }));
};

const getInput = async (id) => {
  const out = await s3.send(new GetObjectCommand({ Bucket: JOBS_BUCKET, Key: inputKey(id) }));
  return JSON.parse(await out.Body.transformToString());
};

const getJob = async (id) => {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: JOBS_BUCKET, Key: jobKey(id) }));
    return JSON.parse(await out.Body.transformToString());
  } catch (error) {
    // S3 answers a missing key with AccessDenied (403), NOT NoSuchKey, unless
    // the caller also holds s3:ListBucket — which this role deliberately does
    // not. Both mean "no such job" here.
    const status = error?.$metadata?.httpStatusCode;
    if (error?.name === 'NoSuchKey' || status === 404 || status === 403) return null;
    throw error;
  }
};

// Reading a printed best-by date off a carton, telling a shallot from a
// pearl onion, and matching "cheddar" to the household's own "Cheddar
// Cheese" all want the strong model. A wrong food with a wrong date is worse
// than no timer.
const MODEL = 'claude-opus-5';

const ALLOWED_ORIGINS = [
  'https://mealhat.com',
  'https://www.mealhat.com',
  // Vue CLI's dev server. 8087 is what the merge was driven against; 8080 is
  // the default. Perishable's Vite port (5173) is gone with perishable.
  'http://localhost:8087',
  'http://localhost:8080'
];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// The household's template names ride along so the model can answer in the
// household's own vocabulary. Bounded so the prompt can't be stuffed.
const MAX_KNOWN_FOODS = 200;
const MAX_KNOWN_FOOD_LENGTH = 60;

let activeOrigin = ALLOWED_ORIGINS[0];

const corsHeaders = () => ({
  'Access-Control-Allow-Origin': activeOrigin,
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Firebase-Token',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
});

const response = (statusCode, body) => ({
  statusCode,
  headers: corsHeaders(),
  body: JSON.stringify(body)
});

// --- Fridge key verification -------------------------------------------------
// A key is valid when a fridge actually exists under it. The shallow read is
// tiny regardless of how much the fridge holds. Verified keys are cached per
// container so polling doesn't hammer Firebase.
//
// THIS READ MUST BE AUTHENTICATED, and that is the bug this version fixes.
//
// It used to be a bare unauthenticated GET, which worked only while the rules
// left the node readable to anyone. When every path started requiring
// `auth != null` (perishable, 2026-08-29) the read began returning 401 for
// EVERY key — so verification failed for everyone and every scan was rejected
// before it ever reached the model. Nothing logged it as a fault; scans simply
// stopped working. Meal-hat's fridge rules require auth too, so the same trap
// is still here.
//
// The caller therefore sends its Firebase ID token alongside the capability
// key, and it rides on the verification read as `?auth=`. That is strictly
// STRONGER than the original: a caller now needs the 32-char secret AND a real
// session, where before the secret alone was enough.
//
// The token is never trusted on its own — it is anonymous and anyone can mint
// one. It only lets the read happen; the KEY is still what proves which fridge
// you may touch, because the key is the path.

const keyCache = new Map();
const KEY_CACHE_MS = 10 * 60 * 1000;

const verifyFridgeKey = async (authorization, idToken) => {
  const key = (authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!KEY_RE.test(key)) return null;
  if (!idToken) return null;

  // Cached per key AND token, so a stale token cannot ride in on a key someone
  // else verified a minute ago.
  const cacheKey = `${key}:${idToken.slice(-24)}`;
  const cached = keyCache.get(cacheKey);
  if (cached && Date.now() < cached) return { key };

  const res = await fetch(
    `${DATABASE_URL}/fridge/${key}.json?shallow=true&auth=${encodeURIComponent(idToken)}`
  );
  if (!res.ok) return null;
  const value = await res.json();
  if (value === null) return null; // well-formed key, but no fridge lives there

  keyCache.set(cacheKey, Date.now() + KEY_CACHE_MS);
  if (keyCache.size > 100) {
    for (const [k, expiresAt] of keyCache) {
      if (Date.now() >= expiresAt) keyCache.delete(k);
    }
  }
  return { key };
};

// --- Rate limiting ----------------------------------------------------------
// Per-container and in-memory — a speed bump against a looping client, not a
// guarantee. Same shape and reasoning as Shelfie's.
const RATE_LIMIT = { windowMs: 60_000, maxPerWindow: 8 };
const recentCalls = new Map();

const withinRateLimit = (key) => {
  const now = Date.now();
  const calls = (recentCalls.get(key) || []).filter((at) => now - at < RATE_LIMIT.windowMs);

  if (calls.length >= RATE_LIMIT.maxPerWindow) {
    recentCalls.set(key, calls);
    return false;
  }

  calls.push(now);
  recentCalls.set(key, calls);

  if (recentCalls.size > 500) {
    for (const [k, times] of recentCalls) {
      if (!times.some((at) => now - at < RATE_LIMIT.windowMs)) recentCalls.delete(k);
    }
  }

  return true;
};

// --- The read ---------------------------------------------------------------

// Structured output so the response can't arrive as prose that needs
// regexing. `additionalProperties: false` throughout.
const GROCERY_SCHEMA = {
  type: 'object',
  properties: {
    photoKind: {
      type: 'string',
      enum: ['groceries', 'receipt', 'storage'],
      description: 'What this photo actually is: food just bought ("groceries"), a printed shop receipt ("receipt"), or the inside of a fridge, freezer, cupboard or pantry ("storage").'
    },
    purchaseDate: {
      type: 'string',
      description: 'RECEIPTS ONLY: the transaction date printed on the receipt, as YYYY-MM-DD. Empty string if this is not a receipt or the date is not legible. Never guess.'
    },
    items: {
      type: 'array',
      description: 'Every distinct perishable food item — visible in the photo, or listed on the receipt.',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The food, named the way a person writes a fridge list: "Cheddar Cheese", "Strawberries". Not a brand, size, or full product name. On a receipt this means expanding the abbreviation: "GV MLK 2% GAL" is "Milk".'
          },
          printedText: {
            type: 'string',
            description: 'RECEIPTS ONLY: the line exactly as printed, so a person can check the expansion. Empty string for a photo of food itself.'
          },
          knownFoodMatch: {
            type: 'string',
            description: 'If this is the same food as one of the known foods listed in the prompt, EXACTLY that known name, character for character. Empty string if none of them is this food.'
          },
          printedDate: {
            type: 'string',
            description: 'A use-by / best-by / sell-by date printed on the packaging and actually legible in the photo, as YYYY-MM-DD. Empty string if no date is legible. Never guess a date.'
          },
          estimatedShelfLifeDays: {
            type: 'integer',
            description: 'Typical days this food stays good at home, stored the normal way for that food (fridge for dairy and produce that needs it, counter or pantry otherwise), starting from today.'
          },
          box: {
            type: 'object',
            description: 'Where this item sits in the photo, as fractions of the image. Used to crop the photo so a person can see which item is being asked about.',
            properties: {
              x: { type: 'number', description: 'Left edge, 0 (far left) to 1 (far right).' },
              y: { type: 'number', description: 'Top edge, 0 (top) to 1 (bottom).' },
              width: { type: 'number', description: 'Width as a fraction of the image width.' },
              height: { type: 'number', description: 'Height as a fraction of the image height.' }
            },
            required: ['x', 'y', 'width', 'height'],
            additionalProperties: false
          }
        },
        required: ['name', 'printedText', 'knownFoodMatch', 'printedDate', 'estimatedShelfLifeDays', 'box'],
        additionalProperties: false
      }
    },
    skipped: {
      type: 'array',
      description: 'Things deliberately not listed as perishable food.',
      items: {
        type: 'object',
        properties: {
          what: { type: 'string' },
          why: { type: 'string' }
        },
        required: ['what', 'why'],
        additionalProperties: false
      }
    },
    obscured: {
      type: 'integer',
      description: 'Roughly how many items are visible but too hidden to identify at all.'
    }
  },
  required: ['photoKind', 'purchaseDate', 'items', 'skipped', 'obscured'],
  additionalProperties: false
};

const buildPrompt = (knownFoods) => {
  const known = (knownFoods || []).length
    ? `\nThis household already tracks these foods, in its own words:\n${knownFoods.map((f) => `- ${f}`).join('\n')}\n\nWhen an item in the photo is the same food as one of these, put that EXACT name in "knownFoodMatch" and prefer it as the item's "name" too — "cheddar" in the photo and "Cheddar Cheese" on this list are the same food. Structural matches count (singular/plural, brand vs. generic); different foods do not (Cucumber is not Cucumbers' pickle jar).\n`
    : '';

  return `This photo is ONE OF THREE THINGS. Work out which, and set "photoKind":

  "groceries" — food that was just bought: a haul spread on a counter, bags unpacked, items on a table.
  "receipt"   — a printed shop receipt listing what was bought.
  "storage"   — the inside of a fridge, freezer, cupboard or pantry: food sitting on shelves where it lives.

The difference between "groceries" and "storage" is where the food is, not what it is. Bags, boxes and loose items on a worktop are groceries. Food arranged on the shelves of an appliance or a cupboard is storage — expect shelf edges, door racks, jars and part-used packets.

Either way the job is the same: list every distinct perishable food so each can get a spoilage countdown timer.
${known}
Name items the way a person writes a fridge list: the food, not the brand or the package size. "Milk", not "Horizon Organic Whole Milk Half Gallon".

One entry per distinct FOOD, not per package — three yogurt cups of the same yogurt are one item, and "2 @ 3.49" on a receipt is still one item. Two clearly different foods that happen to share a word (cheddar block vs. shredded mozzarella) are two items.

Include only food that goes off on a timescale worth tracking: dairy, meat, produce, bread, leftovers, opened jars, fresh anything. Skip, and say so in "skipped": canned goods, dry pasta and rice, unopened shelf-stable items, drinks that keep for months, and anything that is not food.

IF THIS IS A RECEIPT, these extra rules apply:

- Receipts abbreviate brutally. Expand each line to the real food: "GV MLK 2% GAL" is Milk, "BNLS CHKN BRST" is Chicken Breast, "ORG BABY SPNCH" is Baby Spinach. Put the line EXACTLY as printed in "printedText" so a person can check your expansion — this is the only way they can catch a misread.
- A receipt lists plenty that does not belong here: paper goods, cleaning supplies, toiletries, tinned and dry food, bags, deposits, coupons, subtotals and tax. Leave them out of "items" and note the notable ones in "skipped".
- Read the transaction date into "purchaseDate" as YYYY-MM-DD. It matters: the shop may have been days ago, and the timers count from then, not from now. Leave it empty rather than guessing — an invented purchase date silently shifts every timer.
- If a line is too faint or too cryptic to expand confidently, leave it out and count it in "obscured". Do not invent a food to explain a line you cannot read.
- "printedDate" stays empty on a receipt; receipts do not carry use-by dates.

IF THIS IS A FRIDGE OR CUPBOARD ("storage"), these extra rules apply:

- This photo will be compared against what the household already tracks, and anything NOT in your list becomes a suggestion that the food is gone. So an item you miss reads as "eaten". List everything you can genuinely identify.
- But do NOT compensate by guessing. A container you cannot identify is not a reason to invent a food. Missing an item costs a suggestion the person will decline; inventing one costs a wrong timer.
- Occlusion is normal and expected here: food sits behind other food, in drawers, in opaque tubs. Count everything you can see but cannot identify in "obscured" — that number tells the person how much of the photo to distrust.
- Part-used and opened things count and are the whole point: a half-used jar, an open packet, leftovers in a tub.
- Leave "printedText" and "purchaseDate" empty.

IF THIS IS FOOD ITSELF OR STORAGE:

- If a use-by / best-by / sell-by date is printed on the packaging AND legible in this photo, report it in "printedDate" as YYYY-MM-DD. Never infer or guess a date — an invented date on a spoilage tracker is worse than none.
- For "groceries", leave "printedText" and "purchaseDate" empty.

For both kinds:

Give "estimatedShelfLifeDays" for every item: typical days it stays good at home, stored the normal way for that food, counting from when it was bought.

Give every item a "box": where it sits in the photo, as fractions of the image width and height, x and y being the top-left corner. For food, enclose the item. For a receipt, enclose that printed line. Keep it tight — this crop is shown to a person so they can see which item is being asked about.

If you cannot tell what something is, leave it out of "items" and count it in "obscured" instead. A wrong food with a confident timer is worse than a question.`;
};

// Shared by both kinds of submission: the household's own vocabulary rides
// along either way, and it is bounded so the prompt cannot be stuffed.
const knownFoodsError = (knownFoods) => {
  if (knownFoods === undefined) return null;
  const ok = Array.isArray(knownFoods) &&
    knownFoods.length <= MAX_KNOWN_FOODS &&
    knownFoods.every((f) => typeof f === 'string' && f.length > 0 && f.length <= MAX_KNOWN_FOOD_LENGTH);
  return ok ? null : { status: 400, error: 'knownFoods must be a short list of short names' };
};

// --- The spoken inventory ---------------------------------------------------
//
// Matt, 2026-09-20: he does not trust the camera, and a person opening the
// fridge and saying what is in it beats a model squinting at a photo of it.
// The photo flow could never solve occlusion; he can just move the milk.
//
// Same job as `readGroceries`, a different sense. Same pipeline too — this
// still runs as a job, because a five-minute ramble is a lot of text and
// API Gateway's integration timeout is a hard 30 seconds either way.

const MAX_TRANSCRIPT_LENGTH = 20000;

const TRANSCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: 'Every distinct food the speaker says is in the house right now.',
      items: {
        type: 'object',
        properties: {
          heard: {
            type: 'string',
            description: 'The speaker\'s own words for this item, quoted from the transcript, trimmed to the relevant phrase. This is shown back to them so they can catch a misreading, so it must be what they actually said, never a tidied version.'
          },
          name: {
            type: 'string',
            description: 'The food, named the way a person writes a fridge list: "Cheddar Cheese", "Baby Carrots". Not a brand or a package size.'
          },
          knownFoodMatch: {
            type: 'string',
            description: 'If this is the same food as one of the known foods listed in the prompt, EXACTLY that known name, character for character. Empty string if none of them is this food.'
          },
          quantity: {
            type: 'integer',
            description: 'How many separate packages, containers or units of this food the speaker describes. 1 unless they clearly said more ("two cartons of eggs" is 2). Use 1 for a vague amount ("some carrots").'
          },
          perishable: {
            type: 'boolean',
            description: 'True if this food goes off on a timescale worth a countdown — dairy, meat, produce, bread, leftovers, opened jars, frozen food. False for shelf-stable stores: tins, dry pasta and rice, flour, sugar, spices, unopened condiments, anything that keeps for years.'
          },
          estimatedShelfLifeDays: {
            type: 'integer',
            description: 'Typical days this food stays good from today, given how the speaker describes it. If they say it is nearly off, or opened, or has been there a while, say so with a SHORT number — that is the most useful thing you can contribute.'
          }
        },
        required: ['heard', 'name', 'knownFoodMatch', 'quantity', 'perishable', 'estimatedShelfLifeDays'],
        additionalProperties: false
      }
    },
    outOf: {
      type: 'array',
      description: 'Foods the speaker says they do NOT have, are out of, have finished, or need to buy. These are the opposite of a sighting and must never appear in "items".',
      items: {
        type: 'object',
        properties: {
          heard: { type: 'string', description: 'Their own words, quoted.' },
          name: { type: 'string', description: 'The food, named as above.' },
          knownFoodMatch: { type: 'string', description: 'The exact known-food name if it is one of them, else empty.' }
        },
        required: ['heard', 'name', 'knownFoodMatch'],
        additionalProperties: false
      }
    },
    unclear: {
      type: 'array',
      description: 'Phrases that sounded like they were about food but could not be turned into a specific item. Better surfaced than guessed at.',
      items: {
        type: 'object',
        properties: {
          heard: { type: 'string' },
          why: { type: 'string' }
        },
        required: ['heard', 'why'],
        additionalProperties: false
      }
    }
  },
  required: ['items', 'outOf', 'unclear'],
  additionalProperties: false
};

const buildTranscriptPrompt = (knownFoods) => {
  const known = (knownFoods || []).length
    ? `\nThis household already tracks these foods, in its own words:\n${knownFoods.map((f) => `- ${f}`).join('\n')}\n\nWhen the speaker names one of these foods, put that EXACT name in "knownFoodMatch" and use it as "name" too — "cheddar" spoken and "Cheddar Cheese" on this list are the same food. Structural matches count (singular/plural, brand vs. generic, an everyday word for a formal one); genuinely different foods do not.\n`
    : '';

  return `Below is a transcript of somebody walking around their kitchen — opening the fridge, the freezer and the cupboards — and saying out loud what they see, so it can be turned into a list of what the house actually holds.

It is dictated speech, not writing. Expect it to be messy: false starts, repetition, self-correction, thinking out loud, asides that are not about food at all, and transcription errors on food names. Read it the way a person would.
${known}
YOUR JOB IS TO SEPARATE THREE KINDS OF STATEMENT.

1. "items" — food they say IS THERE. This is the main list.

2. "outOf" — food they say is NOT there: "we're out of milk", "no more eggs", "the butter's gone", "I need to get more rice", "we finished the yogurt". THIS IS THE ONE THING YOU MUST NOT GET BACKWARDS. A food mentioned because it is missing, read as a sighting, creates a timer for food that is not in the house and takes it off their shopping list. Say it once more: an absence is not a sighting.

3. "unclear" — they said something food-shaped that you cannot turn into a specific item: an inaudible word, "some kind of sauce in a jar, no idea what it is", a half-finished sentence. Put it here rather than guessing. A wrong food on this list costs them a real ingredient at the shop; a listed uncertainty costs them a glance.

SELF-CORRECTION IS NORMAL AND THE LAST WORD WINS. "There's milk — no wait, that's gone" is an "outOf", not an item. "Two peppers, actually three" is a quantity of three.

NAMING:

- One entry per distinct FOOD, not per container. "Three yogurts" is one item with quantity 3.
- Name the food, not the brand or the size: "Milk", not "Horizon Organic Whole Half Gallon".
- Two foods that share a word are two items: a cheddar block and shredded mozzarella are not one cheese.
- "heard" must quote THEIR words for the item. It is shown back to them as the check on your reading, so it has to be recognisably what they said. Do not tidy it, do not paraphrase it.

PERISHABLE OR NOT:

Set "perishable" true for anything that goes off on a timescale worth counting down: dairy, meat, fish, produce, bread, leftovers, opened jars and sauces, frozen food. Set it false for the pantry: tins, dry pasta, rice, flour, sugar, spices, unopened shelf-stable condiments, drinks that keep for years. Both kinds belong in "items" — the shelf-stable ones still matter, because they are things this household does not need to buy — but only the perishable ones get a countdown.

SHELF LIFE:

Give "estimatedShelfLifeDays" for everything: typical days from TODAY that this food stays good, stored the normal way for that food.

Listen for what they say about condition, because it is the most valuable thing in the transcript and no photo could ever provide it. "The lettuce is starting to go" is two days, not ten. "I just bought this" is the full shelf life. "This has been open a while" is short. An opened jar is much shorter than a sealed one. When they tell you how old something is, USE IT.

WHAT NOT TO DO:

- Do not invent food to round out a shelf. If they did not say it, it is not there.
- Do not include non-food: cleaning supplies, foil, bin bags, the dog's toys.
- Do not include things they say they are GOING to buy.
- Do not merge two foods you are unsure about. Two rows they can decline beats one row that is wrong.`;
};

const readTranscript = async ({ transcript, knownFoods }) => {
  const message = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: TRANSCRIPT_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildTranscriptPrompt(knownFoods) },
          { type: 'text', text: `\n\nHere is the transcript:\n\n<transcript>\n${transcript}\n</transcript>` }
        ]
      }
    ]
  });

  if (message?.stop_reason === 'max_tokens') {
    const error = new Error('That was a lot to take in at once. Try it in two goes.');
    error.userFacing = true;
    throw error;
  }

  const parsed = message.parsed_output;
  if (!parsed) throw new Error(`No parsed output (stop_reason: ${message?.stop_reason})`);

  return {
    kind: 'transcript',
    items: parsed.items ?? [],
    outOf: parsed.outOf ?? [],
    unclear: parsed.unclear ?? []
  };
};

const validationError = ({ image, mediaType, knownFoods, transcript }) => {
  // A transcript submission carries no image, and vice versa. Which one it is
  // decides everything downstream, so it is settled once, here.
  if (transcript !== undefined) {
    if (typeof transcript !== 'string' || !transcript.trim()) {
      return { status: 400, error: 'Nothing was said' };
    }
    if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
      return { status: 413, error: 'That is more than one go can hold. Try it in two.' };
    }
    return knownFoodsError(knownFoods);
  }

  if (!image) return { status: 400, error: 'An image is required' };
  if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
    return { status: 400, error: `mediaType must be one of ${ALLOWED_MEDIA_TYPES.join(', ')}` };
  }
  if (Math.floor(image.length * 0.75) > MAX_IMAGE_BYTES) {
    return { status: 413, error: 'That photo is too large. Try a smaller one.' };
  }
  return knownFoodsError(knownFoods);
};

const readGroceries = async ({ image, mediaType, knownFoods }) => {
  const message = await client.messages.parse({
    model: MODEL,
    // A big haul is far smaller than a 76-game shelf, but the cap that
    // truncated Shelfie mid-JSON is not worth re-discovering here.
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: GROCERY_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: buildPrompt(knownFoods) }
        ]
      }
    ]
  });

  if (message?.stop_reason === 'max_tokens') {
    const error = new Error('That photo has more on it than one scan can hold. Try photographing half of it.');
    error.userFacing = true;
    throw error;
  }

  const parsed = message.parsed_output;
  if (!parsed) {
    throw new Error(`No parsed output (stop_reason: ${message?.stop_reason})`);
  }

  return {
    photoKind: ['receipt', 'storage'].includes(parsed.photoKind) ? parsed.photoKind : 'groceries',
    purchaseDate: parsed.purchaseDate || '',
    items: parsed.items ?? [],
    skipped: parsed.skipped ?? [],
    obscured: parsed.obscured ?? 0
  };
};

// The async self-invocation. Not reachable from the API: every API Gateway
// event carries requestContext.http, and this payload deliberately doesn't.
const runJob = async ({ jobId }) => {
  let input;
  try {
    input = await getInput(jobId);
    // A transcript and a photo are told apart by what was submitted, decided
    // once in validationError and re-read the same way here.
    const result = input.transcript !== undefined
      ? await readTranscript(input)
      : await readGroceries(input);
    await putJob(jobId, { status: 'done', result, finishedAt: Date.now() });
  } catch (error) {
    console.error(`Job ${jobId} failed`, error);
    await putJob(jobId, {
      status: 'failed',
      error: error?.userFacing
        ? error.message
        : (input?.transcript !== undefined
            ? 'Could not make sense of that. Try again.'
            : 'Could not read that photo. Try again.'),
      finishedAt: Date.now()
    });
  }
  return { ok: true };
};

const submitJob = async (event, auth) => {
  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { error: 'Body must be JSON' });
  }

  const problem = validationError(payload);
  if (problem) return response(problem.status, { error: problem.error });

  const jobId = crypto.randomUUID();
  // Photo first, then the marker: a pending job whose input is missing would
  // be a job that can only ever fail.
  await putInput(jobId, payload);
  await putJob(jobId, { status: 'pending', household: auth.key, startedAt: Date.now() });

  await lambda.send(new InvokeCommand({
    FunctionName: SELF,
    InvocationType: 'Event',
    Payload: Buffer.from(JSON.stringify({ jobId }))
  }));

  return response(202, { jobId, status: 'pending' });
};

const pollJob = async (event, auth) => {
  const jobId = event?.queryStringParameters?.job;
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    return response(400, { error: 'valid job id required' });
  }

  const job = await getJob(jobId);
  if (!job) return response(404, { error: 'No such scan. It may have expired.' });
  // A job id is a bearer token for its own result, but only within the
  // household that submitted it.
  if (job.household && job.household !== auth.key) return response(404, { error: 'No such scan.' });

  if (job.status === 'pending') return response(200, { status: 'pending' });
  if (job.status === 'failed') return response(200, { status: 'failed', error: job.error });
  return response(200, { status: 'done', ...job.result });
};

exports.handler = async (event) => {
  // Worker invocation — no HTTP context, so no CORS, no key check, no rate limit.
  if (event?.jobId && !event?.requestContext) return runJob(event);

  const origin = event?.headers?.origin || event?.headers?.Origin;
  activeOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  const method = event?.requestContext?.http?.method || event?.httpMethod;
  if (method === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
  if (method !== 'POST' && method !== 'GET') return response(405, { error: 'POST or GET only' });

  const authorization = event?.headers?.authorization || event?.headers?.Authorization;
  // Header names arrive lower-cased through API Gateway's HTTP API, but not
  // through every proxy, so check both.
  const idToken = event?.headers?.['x-firebase-token'] || event?.headers?.['X-Firebase-Token'];
  let auth;
  try {
    auth = await verifyFridgeKey(authorization, idToken);
  } catch (error) {
    console.error('Key verification failed', error);
    return response(503, { error: 'Could not verify this device right now' });
  }
  if (!auth) return response(401, { error: 'This device is not connected to a fridge' });

  try {
    // Polling is cheap and happens every few seconds; only the submit path —
    // the one that spends money — is rate limited.
    if (method === 'GET') return await pollJob(event, auth);

    if (!withinRateLimit(auth.key)) {
      return response(429, { error: 'That is a lot of photos at once. Give it a minute.' });
    }
    return await submitJob(event, auth);
  } catch (error) {
    console.error('Request failed', error);
    return response(502, { error: 'Something went wrong. Try again.' });
  }
};
