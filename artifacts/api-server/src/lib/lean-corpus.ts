/**
 * The Lean Made Simple corpus — TCK's single source of truth for lean
 * terminology and framing, so every AI-generated lesson speaks the same
 * language the team learned from.
 *
 * Source: "Lean Made Simple — 12 Proven Steps for Creating a Vibrant Lean
 * Culture" by Ryan Tierney (Seating Matters), which Graeme owns and teaches
 * from, plus Ryan's public Lean Made Simple material (podcast/site). The
 * canonical step titles and waste names below were transcribed from
 * Graeme's copy on 2026-08-02. Definitions and explanations are written in
 * our own words — we never reproduce passages from the book; lessons teach
 * the ideas in TCK's voice with kitchen examples.
 *
 * RULES FOR EDITING: this file is the terminology law. When Graeme corrects
 * a term, fix it HERE — every generator reads this module, so a fix here is
 * permanent. Don't add concepts we haven't verified against the book or
 * Ryan's own material; mark anything unverified with [UNVERIFIED].
 */

/** The book's 12 steps, in order, with our one-line framing of each. */
export const LMS_TWELVE_STEPS: Array<{ step: number; title: string; nutshell: string }> = [
  { step: 1, title: "It Starts With The Leaders", nutshell: "Leaders go first — the culture copies what leaders actually do, not what they say." },
  { step: 2, title: "Hold A Morning Meeting", nutshell: "A short daily meeting is the heartbeat of a lean culture — same time, every day." },
  { step: 3, title: "Create A Lean Leaders Group", nutshell: "A small group who keep the lean journey moving and support everyone else." },
  { step: 4, title: "Create An Example Area", nutshell: "Make one area world-class first, so everyone can see what good looks like." },
  { step: 5, title: "Teach Your People To See Waste", nutshell: "Train every person to spot waste — then empower them to remove it." },
  { step: 6, title: "Introduce Improvement Time", nutshell: "Set aside protected time for making improvements — improving is part of the job." },
  { step: 7, title: "Introduce Yokoten", nutshell: "Share improvements across the whole team so a good idea in one area spreads everywhere." },
  { step: 8, title: "Make Improving Easy", nutshell: "Remove the friction: tools, materials and permission close to hand so a 2-second improvement is easy." },
  { step: 9, title: "Solve Your Inventory Problems", nutshell: "Right-size and organise stock so nothing gathers dust and nothing runs out." },
  { step: 10, title: "Create Standard Operating Procedures", nutshell: "Capture the current best way so everyone does it that way — until someone improves it." },
  { step: 11, title: "Implement Total Ownership", nutshell: "Everything has one owner; every owner keeps their area world-class." },
  { step: 12, title: "Connect With Other Lean Enthusiasts", nutshell: "Visit, host and learn from other lean businesses — outside eyes keep you sharp." },
];

/** The Eight Wastes — canonical LMS names. NEVER substitute other lean
 *  literature's names (e.g. say "Waste of Skills", never "non-utilised
 *  talent" or "unused creativity"). Definitions are ours, kept short. */
export const LMS_EIGHT_WASTES: Array<{ name: string; definition: string; kitchenExample: string }> = [
  { name: "Overproduction", definition: "Making more than the customer demands.", kitchenExample: "Building more calzones than the day's orders need — they tie up fridge space and risk going to waste." },
  { name: "Transportation", definition: "Unnecessary movement of product or raw materials.", kitchenExample: "Carrying trays across the kitchen because the fridge is far from the station that uses it." },
  { name: "Inventory", definition: "Holding excess product or unprocessed materials.", kitchenExample: "Three unopened tubs of a marinade when one lasts the week — cash sitting on a shelf going out of date." },
  { name: "Defects", definition: "A product that fails to meet customer expectations.", kitchenExample: "A wonky calzone that can't be sold at full price — the time and ingredients are spent either way." },
  { name: "Motion", definition: "Unnecessary movement of people.", kitchenExample: "Walking to the far sink because the near one is blocked, fifty times a shift." },
  { name: "Overprocessing", definition: "Doing more work than the customer needs.", kitchenExample: "Double-weighing an ingredient the scale already confirmed — effort the customer never tastes." },
  { name: "Waiting", definition: "Time spent waiting for a process or stage to finish.", kitchenExample: "Standing idle while the mixer finishes because the next job isn't prepped." },
  { name: "Waste of Skills", definition: "Failing to make the best use of people's talents and abilities.", kitchenExample: "A team member who's brilliant at organising never being asked how the walk-in should be laid out." },
];

/** Core concepts and catchphrases the team should hear consistently. */
export const LMS_CONCEPTS: Array<{ term: string; nutshell: string }> = [
  { term: "Waste", nutshell: "Anything that doesn't add value to the customer. Ask: is what I'm doing right now adding value? Would the customer pay for it?" },
  { term: "Improve the process", nutshell: "Everyone has the same real job: not just doing the work, but improving how the work is done." },
  { term: "3S", nutshell: "Sweep, Sort, Standardise — the daily habit of leaving your area clean, organised and set up for tomorrow." },
  { term: "Leave it better than you found it", nutshell: "Every touchpoint is a chance for a small improvement — leave the station, tool or process a little better every time." },
  { term: "Total Ownership", nutshell: "Everything in the building has one named owner who keeps it world-class — no orphaned areas, no 'someone else's job'." },
  { term: "Improvement Time", nutshell: "Protected time set aside for making improvements — it isn't extra, it's the job." },
  { term: "Yokoten", nutshell: "Sharing an improvement across the team so it spreads — copy good ideas shamelessly." },
  { term: "Example Area", nutshell: "One area made world-class first, so everyone can see and copy the standard." },
  { term: "Two Second Lean", nutshell: "Paul Akers' idea the team already practises: make one tiny 2-second improvement every day and film/share it." },
  { term: "Everyone, every day", nutshell: "Lean is a mindset, not a project — small improvements from every person, every day, beat occasional big ones." },
];

/** House voice for lessons — how Ryan-style teaching sounds at TCK. */
export const LMS_VOICE = [
  "Simple, warm, plain British English. Short sentences. Zero corporate jargon.",
  "Lean is a mindset, not a toolkit — teach the thinking, not just the technique.",
  "People-first framing: improvements exist to get rid of the stuff that sucks the team's energy, not to squeeze more out of people.",
  "No blame, ever: waste is in the process, not the person.",
  "Always one concrete TCK kitchen example (calzones, dough, ovens, wrapping, packing, fridges, kanban cards, marinades).",
  "End with something the team can DO today — ideally a 2-second improvement.",
].join("\n");

/** Terminology guard injected into every lesson-generation prompt. */
export function leanCorpusPrompt(): string {
  return [
    "CANONICAL TERMINOLOGY — Lean Made Simple by Ryan Tierney (the book this team learned from).",
    "Use these exact names and framings. Never substitute names from other lean literature.",
    "",
    "THE 12 STEPS:",
    ...LMS_TWELVE_STEPS.map(s => `${s.step}. ${s.title} — ${s.nutshell}`),
    "",
    "THE 8 WASTES (use these exact names, in this order):",
    ...LMS_EIGHT_WASTES.map((w, i) => `${i + 1}. ${w.name} — ${w.definition}`),
    "",
    "CORE CONCEPTS:",
    ...LMS_CONCEPTS.map(c => `• ${c.term}: ${c.nutshell}`),
    "",
    "VOICE:",
    LMS_VOICE,
    "",
    "If the requested topic is NOT covered by the material above, do not invent Lean Made Simple positions for it — teach it plainly and say it sits outside the Lean Made Simple steps.",
  ].join("\n");
}
