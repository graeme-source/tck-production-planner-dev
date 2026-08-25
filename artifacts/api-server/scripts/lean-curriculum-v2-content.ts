/**
 * Lean curriculum v2 — "Seeing Waste": the 9-week foundation programme.
 *
 * Week 1 teaches what waste IS and how to see it; weeks 2–9 take one of the
 * Eight Wastes each, in the canonical Lean Made Simple order from
 * src/lib/lean-corpus.ts (the terminology law). Written 2026-08-25 to
 * Graeme's brief: the topic holds for a full week; each weekday takes a
 * different angle on it (Mon meet the idea → Tue/Wed see it at TCK →
 * Thu why it pays → Fri find one live); slides carry little text and a
 * big visual.
 *
 * Field voices — this is the contract that fixes the "host instructions
 * read out to the audience" problem:
 *   - whatToShowMd  → THE AUDIENCE SLIDE BODY. Short bullets speaking TO
 *     the team ("we", "you"). Never instructions to the host.
 *   - explanationMd → the host's teach (prep mode page 1). The host
 *     retells this; it never renders on the slide.
 *   - deliveryNotesMd → host directions — what to point at, what to ask
 *     (prep mode page 3). Never renders on the slide.
 *   - diagram → key into the LessonDiagram bank
 *     (production-planner/src/components/lesson-diagrams.tsx).
 *   - videoUrl → YouTube; verified against oembed before being added here.
 *
 * Content is ours: it teaches the book's ideas in TCK's own words and
 * examples, and never reproduces passages from the book.
 */

export interface LessonV2 {
  title: string;
  summary: string;
  explanationMd: string;
  whatToShowMd: string;
  deliveryNotesMd: string;
  diagram?: string;
  videoUrl?: string;
  imageUrl?: string;
}

export interface WeekV2 {
  title: string;
  summary: string;
  lessons: [LessonV2, LessonV2, LessonV2, LessonV2, LessonV2]; // Mon..Fri
}

export const LEAN_CURRICULUM_V2: WeekV2[] = [
  // ── Week 1 — Seeing Waste ─────────────────────────────────────────────
  {
    title: "Seeing Waste — What Waste Really Is",
    summary:
      "The foundation: waste is anything the customer wouldn't pay for — and seeing it is a skill anyone can build.",
    lessons: [
      {
        title: "The Big Idea: Value and Waste",
        videoUrl: "https://www.youtube.com/watch?v=2wq7yfwxfrc",
        summary: "Everything we do is one or the other — and one question tells them apart.",
        explanationMd: `Every minute of a shift goes into one of two buckets.

**Value** is anything our customer would happily pay for: dough stretched, filling folded in, a calzone wrapped, labelled and on the van.

**Waste** is everything else: walking, waiting, searching, re-doing, moving things around. The customer pays for a great calzone — not for the fifth trip to the fridge it took to make it.

The test is one question: **"Would the customer pay for what I'm doing right now?"** Not "am I busy?" — you can be flat out all day on waste. Lean starts when we can *see* the difference. Nobody is in trouble for finding waste; finding it is the win. Waste lives in the process, never the person.`,
        whatToShowMd: `- Everything we do is either **value** — what the customer pays for — or **waste**
- Busy isn't the same as valuable: you can work hard all day on waste
- The test: **"Would the customer pay for what I'm doing right now?"**

**This week we learn to see the difference.**`,
        diagram: "value-lens",
        deliveryNotesMd: `**How to land it:**
- Pick one real job — say wrapping — and walk it through the question out loud: stretching dough? Value. Walking to find the tape gun? Waste.
- Make the no-blame point early and clearly: spotting waste is a win, not a telling-off.
- Keep it light — everyone works hard; the point is where the hard work goes.

**Ask:** "Name one thing you did yesterday the customer would definitely pay for — and one thing they definitely wouldn't."`,
      },
      {
        title: "Through the Customer's Eyes",
        summary: "What actually makes the calzone worth paying for — value as the customer defines it.",
        explanationMd: `Yesterday we split work into value and waste. Today: who decides which is which? **The customer does — nobody else.**

Our customer pays for taste, quality, the right thing arriving on the right day, safe food, a box that opens nicely. That's the whole list. They don't know or care how far our fridges are from the prep bench, how many times we count stock, or how long the tape gun hunt took. Those costs are real — but they're ours, not theirs.

That's why "we've always done it this way" doesn't settle anything. The only question that settles it: does this step make the product better *for the customer*? If yes, protect it and do it brilliantly. If no, it's a candidate for the bin.`,
        whatToShowMd: `- The **customer** decides what's value — not habit, not "how we've always done it"
- They pay for: taste, quality, right order, right day, safe food
- They never see: our walking, searching, stacking, re-checking — that cost is ours

**If a step doesn't make the calzone better for them, why is it there?**`,
        diagram: "value-lens",
        deliveryNotesMd: `**How to land it:**
- Hold up a finished pack. Ask the team what the customer sees when it arrives — that short list is the value.
- Then list two or three real behind-the-scenes steps and ask, for each: does the customer taste this?
- No answers are wrong today — the goal is getting comfortable asking the question.

**Ask:** "What's one step in your day you suspect the customer wouldn't pay for?"`,
      },
      {
        title: "Waste Hides in Plain Sight",
        videoUrl: "https://www.youtube.com/watch?v=F7QUy7QEMRM",
        summary: "The most dangerous waste is the kind we've stopped noticing.",
        explanationMd: `Here's the uncomfortable bit: most waste is invisible — not because it's small, but because it's **familiar**.

The walk to the far fridge. The tub with no label you open to check. The pile that gets moved twice a day. On day one, each of these would bug you. By month three, they're just "how the kitchen is". Your brain files them under *normal* and stops showing them to you.

That's why seeing waste is a skill and not just an attitude. The trick is to look at your own station like a visitor would: fresh eyes, slightly nosy, asking "why is that there?" and "why do we do it twice?". Nothing is exempt because it's old. The longer something's been annoying, the bigger the prize for finally seeing it.`,
        whatToShowMd: `- The biggest wastes aren't hidden — they're **familiar**
- Day one it bugs you; month three it's just "how the kitchen is"
- Fresh eyes are a skill: look at your own station like a visitor would

**What have you stopped noticing?**`,
        diagram: "hidden-waste",
        deliveryNotesMd: `**How to land it:**
- Tell one on yourself first — something that bugged you when you started here and that you've since gone blind to. Going first makes it safe.
- Invite one example from the team; resist fixing it on the spot — today is only about seeing.
- Connect back to yesterday: familiar ≠ valuable. The customer never went blind to it, because they never saw it.

**Ask:** "What did this place do that surprised you in your first week — that now feels normal?"`,
      },
      {
        title: "What's In It For You",
        videoUrl: "https://www.youtube.com/watch?v=rY7FTXU8UXI",
        summary: "Removing waste isn't about working harder — it's about getting the annoying stuff out of your day.",
        explanationMd: `Let's be straight about why we're doing this, because lean has a bad cousin: the version where "efficiency" means squeeze people harder. **That is not what this is.**

Waste isn't just a cost to the business — it's the part of your day that sucks your energy. The hunt for the thing that's never where it should be. The job you redo. The trek you make forty times. Remove those and the day isn't faster-and-sweatier — it's *calmer*. Same effort, less friction, home on time, fewer "where is it?" moments.

So the deal is: you spot the waste, we kill the waste, **you keep the winnings** — in easier shifts and in your ideas visibly changing the workplace. If it ever starts feeling like "run faster", say so out loud, because we've lost the plot.`,
        whatToShowMd: `- This is **not** about working harder or faster
- Waste is the annoying part of your day: the hunting, the re-doing, the trekking
- Kill the waste and the day gets **calmer** — same effort, less friction
- You spot it, we fix it, **you keep the winnings**`,
        diagram: "energy-drain",
        deliveryNotesMd: `**How to land it:**
- This is the trust-building day — deliver it like a promise, because it is one.
- Be explicit about the bad cousin: if anyone's met "lean = speed-up" at another job, name it and bin it.
- If you can, mention a past fix that genuinely made a job nicer, and who suggested it.

**Ask:** "What's the single most annoying, energy-sucking part of your day? Don't fix it — just name it."`,
      },
      {
        title: "Your First Waste Walk",
        videoUrl: "https://www.youtube.com/watch?v=ykVGi5dlb2k",
        summary: "Five minutes, fresh eyes, one find each — waste-spotting becomes something we do, not just know.",
        explanationMd: `Time to use the week. A **waste walk** is exactly what it sounds like: walk the kitchen slowly, fresh eyes on, and look for work the customer wouldn't pay for. Not to judge — to notice.

You're looking for the stuff from this week: busy-but-not-valuable moments, familiar annoyances, things that would make a visitor ask "why?". Walking, waiting, searching, stacks, re-doing, unlabelled anything.

One find per person is a great first walk. Say it out loud, plainly: *"I spotted X — the customer wouldn't pay for it."* No solving today, no blame ever — the process owns the waste, we just shine the light. Next week we start giving wastes their proper names, one a week, starting with the biggest troublemaker of the lot.`,
        whatToShowMd: `- **Waste walk:** walk slowly, look with fresh eyes, find work the customer wouldn't pay for
- One find each is a win — say it plainly, no fixing, no blame
- Everything you spot goes on the list

**Next week: the eight wastes get names — one a week.**`,
        diagram: "eight-wastes",
        deliveryNotesMd: `**How to land it:**
- Do the walk NOW if the meeting allows — two minutes, everyone scans their own station from where they stand. It beats talking about it.
- Collect finds out loud; log the good ones with the Quick Idea button so they aren't lost.
- Close the week strong: seeing waste is now everyone's skill. The names come next.

**Ask:** "From where you're standing, right now — what can you see that the customer wouldn't pay for?"`,
      },
    ],
  },

  // ── Week 2 — Overproduction ───────────────────────────────────────────
  {
    title: "The 8 Wastes — Overproduction",
    summary:
      "Making more than the customer demands — the first waste to learn because it quietly feeds most of the others.",
    lessons: [
      {
        title: "Meet Overproduction",
        videoUrl: "https://www.youtube.com/watch?v=MOtIQazaliY",
        summary: "Making more than ordered, or earlier than needed — the waste that breeds other wastes.",
        explanationMd: `The first of the Eight Wastes, and the one lean thinking treats as the biggest troublemaker: **Overproduction — making more than the customer demands.** More calzones than the orders need. More sauce than the plan calls for. Making it *earlier* than needed counts too.

Why is it such a villain? Because it never travels alone. Extra product needs somewhere to live (Inventory), needs carrying there (Transportation), sits going out of date (Defects waiting to happen), and hides the real numbers so planning gets harder. Kill overproduction and you starve several other wastes at once.

The sneaky part: overproduction *feels* virtuous. "Better safe than sorry." "May as well do the whole tub." A full fridge looks like success. This week we learn to see past that feeling to what the order actually asked for.`,
        whatToShowMd: `- **Overproduction = making more than the customer demands** — or earlier than needed
- It feels safe: "may as well make extra" — a full fridge *looks* like success
- It's the waste that **feeds the others**: extra needs storing, moving, and often binning

**This week: spot where "extra" hides.**`,
        diagram: "waste-overproduction",
        deliveryNotesMd: `**How to land it:**
- Anchor it to our numbers: the plan exists precisely so we make what's ordered, not what feels safe.
- Stress the "feels virtuous" trap — this waste hides behind good intentions, so nobody's being daft when they overproduce.
- Trail the week: four more days on this one waste, ending with a hunt.

**Ask:** "Where in this kitchen does 'may as well make a bit extra' happen most?"`,
      },
      {
        title: "Overproduction at the Prep Bench",
        summary: "Where 'do the whole tub' beats 'do what the plan says' — and what it costs later.",
        explanationMd: `Prep is where overproduction is born, because prep is where rounding up feels natural. The plan says 6kg; the tub holds 8; washing up twice is annoying — so 8 it is. The recipe makes 40 portions of filling; today needs 32; the other 8 go in the fridge "for tomorrow".

Each decision is tiny and reasonable. But follow the extra 8 portions: they take fridge space today, they're the older stock tomorrow, someone has to remember they exist, check their date, and use them first — or bin them. The plan for tomorrow was built not knowing about them, so tomorrow overproduces too. One rounding-up quietly becomes a system.

The lean habit is trusting the plan's number: it already contains the buffer we agreed. When the number seems wrong, the fix is to challenge the *plan* — not to pad it privately at the bench.`,
        whatToShowMd: `- Prep is where extra is born: "may as well do the whole tub"
- Every extra portion needs space, a date check, a memory — and often a bin
- The plan's number **already includes the buffer** — trust it
- If the number seems wrong, challenge the plan, don't pad it quietly`,
        diagram: "waste-overproduction",
        deliveryNotesMd: `**How to land it:**
- Use a real prep item from today's plan as the worked example — plan number vs tub size.
- Make it safe to admit rounding up; everyone does it, and the reasons (less washing up!) are genuinely sensible. The process should make the right amount the easy amount.
- If someone says a plan number is regularly wrong — that's gold. Log it; that's a planning fix, not a bench fix.

**Ask:** "Which prep job most tempts you to round up, and why?"`,
      },
      {
        title: "The Fridge Doesn't Lie",
        summary: "A walk through where extra product actually ends up — and what the shelves can tell us.",
        explanationMd: `If overproduction is invisible at the bench, it's very visible somewhere else: **the fridges.** Every "bit extra" ends up on a shelf, and the shelves keep the receipts.

Read a fridge like a detective. Stock older than it should be? Something was made before it was needed. The same item in three part-used containers? Three "may as well" moments. Things pushed to the back with a short date? That's yesterday's overproduction becoming tomorrow's waste — and the *newest-first* grab makes it worse, because extra stock at the back never gets its turn.

The fridge is where overproduction converts into other wastes before your eyes: space gone (Inventory), shuffling and double-handling (Transportation and Motion), and eventually the bin (the purest Defect there is). One glance at a shelf tells you more truth than any spreadsheet.`,
        whatToShowMd: `- Every "bit extra" ends up here — **the fridge keeps the receipts**
- Old dates, part-used tubs, stock hiding at the back = overproduction, converted
- Extra at the back never gets its turn — then it meets the bin

**Read the shelves like a detective.**`,
        diagram: "waste-overproduction",
        deliveryNotesMd: `**How to land it:**
- If the meeting can move, take it to a fridge for two minutes — point at real shelves. If not, describe what was in there this morning; be specific.
- Frame the fridge as evidence, never as blame — the shelves show what the *process* produced.
- Link to the packing closing check we already do (short-dated packs → Wonky) as the system catching this downstream; the goal is needing it less.

**Ask:** "What's the oldest thing in our fridges right now — and does anyone know why it was made?"`,
      },
      {
        title: "What Killing Overproduction Wins Us",
        summary: "Fridge space, fresher food, truer numbers, calmer days — the payoff for making just enough.",
        explanationMd: `So what do we actually get if we make **just enough, just in time?**

**Fresher product.** Everything the customer gets was made closer to when they wanted it. That's a taste and quality win nobody argues with.

**Space and calm.** Fridges with room in them. No shuffling towers of tubs to find things. Stock counts that take minutes because there's less to count.

**Truer numbers.** When we make what the plan says, the plan learns. Suggestions get sharper, orders get sharper, and the whole system gets easier to trust — which is exactly what makes "trust the number" possible at the bench.

**Less binning.** Almost everything we throw away was, at some point, made without a customer. Stop making it and the bin goes quiet.

Notice none of these are "work faster". Making *less* — exactly enough — is the win.`,
        whatToShowMd: `- **Fresher food** — made closer to when the customer wants it
- **Space and calm** — fridges with room, counts that take minutes
- **Truer numbers** — the plan learns when we follow it
- **A quieter bin** — most of what we bin was made without a customer`,
        diagram: "waste-overproduction",
        deliveryNotesMd: `**How to land it:**
- Pick the benefit your team feels most — for most people it's space and calm — and lead with that one.
- The bin line lands hard: almost everything binned was overproduced first. Pause on it.
- Reinforce yesterday and Tuesday: bench decisions → fridge evidence → these payoffs. The week should feel like one story.

**Ask:** "Which of these four would make YOUR day better — and what would we have to stop over-making to get it?"`,
      },
      {
        title: "The Overproduction Hunt",
        videoUrl: "https://www.youtube.com/watch?v=B9vUA-tjceQ",
        summary: "Find one live example of more-than-ordered before the meeting ends.",
        explanationMd: `Hunt day. This week we met Overproduction at the bench, followed it to the fridge, and counted the winnings for killing it. Now: find it live.

The quarry: anything being made, or already made, **beyond what an order or the plan asked for**. A batch bigger than the plan. A tub of prep with no home in today's production. Stock made "for tomorrow" that tomorrow didn't ask for. The part-used duplicates.

One find per person, said plainly and without blame: *"That's overproduction — we made more than was ordered."* Then, for the best finds, one more question: **what's the smallest change that would stop it happening again?** Smaller tub, clearer plan number, a kanban card, a label. Log the good ones with the Quick Idea button — that's how a spot becomes a fix.`,
        whatToShowMd: `- Find one live example: **more made than ordered**, or earlier than needed
- Big batches, homeless prep, "for tomorrow" stock, part-used duplicates
- Name it plainly, no blame — then ask: **what's the smallest change that stops it?**

**Log the best finds — that's how a spot becomes a fix.**`,
        diagram: "waste-overproduction",
        deliveryNotesMd: `**How to land it:**
- Give it real time — three quiet minutes of looking beats ten of talking.
- Push finds to the "smallest change" question; the fix is the point, and small fixes actually happen.
- Celebrate the first find loudly and log it in the app before the meeting closes. Next week: Transportation — product on pointless journeys.

**Ask:** "What did you find — and what's the two-second version of the fix?"`,
      },
    ],
  },

  // ── Week 3 — Transportation ───────────────────────────────────────────
  {
    title: "The 8 Wastes — Transportation",
    summary:
      "Unnecessary movement of product and materials — every pointless journey adds cost and risk, never taste.",
    lessons: [
      {
        title: "Meet Transportation",
        videoUrl: "https://www.youtube.com/watch?v=MTYqZHMzW5M",
        summary: "Product on a journey the customer never asked for.",
        explanationMd: `Waste number two: **Transportation — unnecessary movement of product or raw materials.** Not people (that's Motion, coming later) — *stuff*. Trays, tubs, boxes, ingredients, finished packs.

Some moving is unavoidable: goods arrive, calzones must reach the van. Transportation the *waste* is every journey beyond that. The tray carried across the kitchen because the fridge is far from the station using it. The delivery unloaded onto one shelf, then moved to another, then to a third. The same box handled four times before anything comes out of it.

Every journey costs twice: someone's time to carry it, and **risk to the product** — every move is a chance to drop, dent, squash or warm something. A calzone never got tastier by being carried around. This week: see the journeys.`,
        whatToShowMd: `- **Transportation = product and materials moving more than they need to**
- Every journey costs twice: someone carries it, and every move risks the product
- A calzone never got tastier by being carried around

**This week: follow the journeys.**`,
        diagram: "waste-transportation",
        deliveryNotesMd: `**How to land it:**
- Draw the line to next week's cousin early: things moving = Transportation, people moving = Motion. Keeps the vocabulary clean.
- Use this morning's most-travelled item as the example — where did it wake up, where will it sleep?
- The double cost (time + product risk) is the teach; damage from handling is a defect we paid to cause.

**Ask:** "What's the most-travelled item in this kitchen — and who's carrying it?"`,
      },
      {
        title: "The Journey of a Calzone",
        summary: "Trace one product from ingredients to the van — every leg of the trip is a question.",
        explanationMd: `Today we follow one calzone through the building, and count the legs of its journey.

Ingredients out of the walk-in → prep bench. Prep → mixing. Dough → sheeting → building table. Built calzone → oven area. Cooked → cooling → wrapping. Wrapped → fridge or freezer. Out again → packing. Packed → despatch → van. And between the official stops, the unofficial ones: the tray parked "just for now", the shelf swap, the move-it-to-reach-the-other-thing.

For each leg, one question: **does this move change the product, or just its address?** Cooking changes it. Wrapping changes it. Moving it from shelf A to shelf B changes nothing — that leg is a candidate: could the two stops be closer? Could it go straight to where it's needed? Could it arrive already there?

Nobody redesigns the kitchen today. Today we just see the map honestly.`,
        whatToShowMd: `- Follow one calzone: walk-in → prep → dough → build → oven → wrap → fridge → pack → van
- Count the *unofficial* stops too: "just for now" trays, shelf swaps
- Each leg, one question: **does this move change the product — or just its address?**`,
        diagram: "waste-transportation",
        deliveryNotesMd: `**How to land it:**
- Trace the route out loud with the team filling in the legs — they know the unofficial stops better than any diagram.
- Keep score: how many address-only moves did we count? That number is the week's baseline.
- If one leg gets groans, mark it — that's Friday's hunt half-done.

**Ask:** "Which leg of the journey would look silliest to a visitor watching us for a day?"`,
      },
      {
        title: "Double-Handling: Touched Twice, Improved Never",
        summary: "Put-downs that need a second pick-up — the clearest transportation waste to kill.",
        explanationMd: `The easiest transportation waste to spot has a name: **double-handling.** Anything put down somewhere it can't stay — because that guarantees a second journey.

The delivery stacked by the door, then carried to the walk-in later. The tray parked on the side "for a minute" that becomes an obstacle, then gets moved again. Product staged in the wrong fridge because the right one was full — retrieved and re-shelved tomorrow.

Each of these doubles the carrying and doubles the risk, and adds a third cost: **the parked thing is in the way**, so other work bends around it. The test is beautifully simple — when you put something down, ask: *"is this its home, or will someone have to touch it again?"* If it'll be touched again, you've just seen the waste, mid-air, before it even lands. Straight-to-home beats park-and-move every single time it's possible.`,
        whatToShowMd: `- **Double-handling:** put down somewhere it can't stay = a guaranteed second journey
- Deliveries by the door, "just for a minute" trays, wrong-fridge staging
- The mid-air test: **"is this its home — or will someone touch it again?"**`,
        diagram: "waste-transportation",
        deliveryNotesMd: `**How to land it:**
- Point at today's most likely parking spot — every kitchen has one; name ours.
- The mid-air test is the takeaway. It works in real time and needs no equipment.
- Acknowledge the honest cause: things get parked when the proper home is full or far — which links this waste to Inventory (next week) and to why we care about full fridges.

**Ask:** "Where's our favourite 'just for now' spot — and what's the real home of the stuff that lands there?"`,
      },
      {
        title: "Shorter Journeys, Better Days",
        videoUrl: "https://www.youtube.com/watch?v=J1hrOlV-CS0",
        summary: "What we win when product moves less: time back, fewer knocks, clearer floors.",
        explanationMd: `Payday. What do shorter journeys actually buy us?

**Time, in lumps we can feel.** A journey that takes ninety seconds, made ten times a day, is fifteen minutes — every day, forever. Kill the journey and the time comes back without anyone working faster.

**Fewer knocks.** Every carry is a chance to squash a calzone, dent a pack, or warm something that should stay cold. Product that moves less arrives in better shape — that's a straight quality win the customer tastes.

**Clearer floors and calmer traffic.** Fewer trays in transit means fewer near-misses, fewer "behind you!"s, less weaving. The kitchen literally gets safer and quieter.

And the fixes are usually small: move the thing closer to where it's used, or use it where it lands. Store it at the station. Unload straight to the right shelf. The product's journey should look boring — the shortest possible line, walked once.`,
        whatToShowMd: `- A 90-second journey × 10 times a day = **15 minutes back, every day, forever**
- Product that moves less arrives in better shape — fewer squashed packs
- Fewer trays in transit = clearer floors, calmer traffic
- Best fix is usually: **keep it where it's used**`,
        diagram: "waste-transportation",
        deliveryNotesMd: `**How to land it:**
- Do the multiplication live with a real journey the team named on Tuesday — their journey, their fifteen minutes.
- "The journey should look boring" is the keeper phrase — shortest line, walked once.
- Seed Friday: tomorrow we pick one journey and actually shorten it.

**Ask:** "If you got fifteen minutes of your shift back, where would it come from — which journey dies first?"`,
      },
      {
        title: "The Transportation Hunt",
        summary: "Find one pointless journey and name the smallest change that shortens it.",
        explanationMd: `Hunt day. The quarry: **one journey product makes that it doesn't need to** — an address-only move, a double-handle, a park-and-shift.

This week gave you the tools. The journey map from Tuesday: which legs change the product's address but not the product? The mid-air test from Wednesday: what gets put down where it can't stay? Yesterday's maths: which journey, times how-many-a-day, is quietly eating a chunk of someone's shift?

Find one each. Name it plainly: *"That's transportation — it moves without changing."* Then the money question: **what's the smallest change that shortens or kills the journey?** Move the storage nearer. Unload straight to home. Give the parked thing a real home. Log the best ones with the Quick Idea button — a shortened journey is one of the most satisfying fixes there is, because it's gone *forever*.`,
        whatToShowMd: `- Find one journey product makes that it **doesn't need to make**
- Address-only moves, double-handles, park-and-shifts
- Name it, no blame — then: **what's the smallest change that kills the journey?**

**A journey killed is killed forever.**`,
        diagram: "waste-transportation",
        deliveryNotesMd: `**How to land it:**
- Aim for one fix agreed before the meeting ends — transportation fixes are often genuinely two-second (move a shelf's contents, change where the van trolley waits).
- "Killed forever" is the motivator: this isn't a tidy-up that decays, it's a route change that sticks.
- Log finds in the app. Next week: Inventory — cash sitting on a shelf.

**Ask:** "What did you find — and can we kill that journey before lunch?"`,
      },
    ],
  },

  // ── Week 4 — Inventory ────────────────────────────────────────────────
  {
    title: "The 8 Wastes — Inventory",
    summary:
      "Holding more product or materials than we need — cash on a shelf, going out of date, hiding problems.",
    lessons: [
      {
        title: "Meet Inventory",
        videoUrl: "https://www.youtube.com/watch?v=HRQgQGcsPn4",
        summary: "Excess stock is money parked on a shelf — with a use-by date.",
        explanationMd: `Waste number three: **Inventory — holding excess product or unprocessed materials.** Not stock itself; we need stock to cook. The waste is the *excess*: the third unopened tub of marinade when one lasts the week. The over-full freezer. The "just in case" pile that never gets its case.

See it as money, because it is: every tub on a shelf is cash we've already spent, sitting there earning nothing. In a food business it's worse — our cash has a **use-by date**. Money in a bank account keeps; money shaped like fresh ingredients quietly counts down to the bin.

And excess stock is a bully: it fills fridges (making Transportation's parking problem worse), demands counting and shuffling, and buries the short-dated stuff at the back. Last week's journeys often exist *because* the shelves are too full. The wastes hold hands.`,
        whatToShowMd: `- **Inventory waste = holding more than we need** — the excess, not the stock
- Every extra tub is **cash on a shelf** — and our cash has a use-by date
- Full shelves bully the kitchen: more counting, more shuffling, short dates buried

**This week: how much is enough?**`,
        diagram: "waste-inventory",
        deliveryNotesMd: `**How to land it:**
- The "cash with a use-by date" image is the teach — spend time on it. Guess the £ value of one over-stocked shelf out loud.
- Be clear this isn't "run the kitchen empty" — it's right-sizing. Too little stock stops production; the waste is the excess beyond the buffer we've agreed.
- Link back: last week's parking and journeys are often symptoms of this week's over-full shelves.

**Ask:** "Which shelf in this building holds the most money — and how much of it will we actually use this week?"`,
      },
      {
        title: "Why We Over-Stock",
        summary: "Excess stock is fear made visible — and the fears have better answers.",
        explanationMd: `Nobody orders too much on purpose. Excess stock is **fear made visible**, and it's worth naming the fears, because each has a better answer than a bigger pile.

**"What if we run out?"** Fair — running out stops production. But the answer is a *reliable* buffer, agreed and visible, not a private mountain. Our order suggestions already do this maths: required plus surplus, minus what's coming.

**"The bigger box was cheaper."** Per unit, yes. But add what we bin when it dies before we use it, and the space it hogs, and cheap gets expensive fast.

**"Ordering is a faff, so order lots, rarely."** Real — and the right fix is making ordering easier (that's exactly what the system's for), not making the shelves suffer.

The pattern: every over-stock is a signal about trust — in the numbers, the suppliers, the process. Fix the trust and the pile shrinks on its own.`,
        whatToShowMd: `- Nobody over-stocks on purpose — **excess stock is fear made visible**
- "What if we run out?" → the answer is a reliable, visible buffer, not a private mountain
- "Bigger box was cheaper" → not once the bin takes its share
- Fix the trust in the numbers and the pile shrinks itself`,
        diagram: "waste-inventory",
        deliveryNotesMd: `**How to land it:**
- No blame, doubly so today — every fear listed is reasonable. The point is that each has a better answer than hoarding.
- If someone doesn't trust an order suggestion or a par level, that's the most valuable thing you'll hear all week. Log it — distrusted numbers are how private mountains start.
- The one-liner to leave behind: a buffer is agreed and visible; a stash is private and forgotten.

**Ask:** "What do we keep 'just in case' — and when did the case last actually happen?"`,
      },
      {
        title: "Just Enough: Kanban and the Art of the Right Amount",
        videoUrl: "https://www.youtube.com/watch?v=9KgyYPdTqbI",
        summary: "How the kitchen already signals 'time to make more' — and why pull beats pile.",
        explanationMd: `If excess is the waste, what's the skill? **Letting what's *used* trigger what's *made or ordered*** — instead of guessing and padding. We already do this more than we might realise.

Our kanban cards are exactly this: a card surfacing when stock hits the reorder point *is* the signal. No guessing, no mountain — the shelf itself says "now". Our order suggestions do the same with maths: required plus the agreed surplus, minus stock we hold, minus what's already inbound. Both are ways of replacing fear with a signal.

The picture to keep is water level: lower the stock slowly and problems that were hiding under the surface show themselves — the supplier who's actually unreliable, the recipe that uses more than the sheet says. That's not the system failing; that's the system finally telling the truth, one fixable problem at a time.`,
        whatToShowMd: `- The skill: **what's used triggers what's made** — a signal, not a guess
- Our kanban cards ARE this: the shelf itself says "now"
- Lower the water level slowly and hidden problems surface — **then we fix them**
- Pull beats pile`,
        diagram: "water-level",
        deliveryNotesMd: `**How to land it:**
- Hold up a kanban card if one's to hand — the team uses them daily; today just names what they're really doing.
- The water-level picture is the classic for a reason: draw it in the air. Stock hides problems; lowering it *reveals* them, which feels worse before it feels better.
- Emphasise *slowly* — we lower levels a step at a time, and a surfaced problem is a win, not an emergency.

**Ask:** "If we halved the stock of one thing, what problem do you reckon would surface first?"`,
      },
      {
        title: "What Right-Sized Stock Wins Us",
        videoUrl: "https://www.youtube.com/watch?v=AaYHMEmCdQI",
        summary: "Space, fresher ingredients, faster counts, and money back in the business.",
        explanationMd: `The payoff day. Right-sized stock buys us:

**Space** — the scarcest thing in any kitchen. Room in the fridges means deliveries go straight to their homes (remember double-handling?), and nothing gets buried.

**Freshness** — less time between an ingredient arriving and being cooked. Shorter queues on the shelf mean younger dates on everything we use, which ends up in the product.

**Faster, truer counts** — counting three tubs takes seconds and the number's right. Counting thirty takes half an hour and the number's still wrong. Every count we do gets easier when there's less to count.

**Money moving again** — cash that was parked on shelves goes back to being cash. In a small business that's not an accounting nicety; that's what buys the next improvement.

None of this needs anyone to work harder. It needs the pile to get smaller — carefully, signal by signal.`,
        whatToShowMd: `- **Space back** — deliveries go straight home, nothing buried
- **Fresher everything** — shorter shelf queues, younger dates in the product
- **Counts in seconds** — and the number's actually right
- **Money moving again** — parked cash goes back to work`,
        diagram: "waste-inventory",
        deliveryNotesMd: `**How to land it:**
- Faster counts is the one the team feels personally — anyone who's done a long stock count will nod. Start there.
- Tie freshness to pride in the product: shelf queues end up on the plate.
- Recap the week's thread so far: cash on shelves → fears with better answers → signals not guesses → this. Tomorrow we hunt.

**Ask:** "Which stock count do you dread most — and what would make it a two-minute job?"`,
      },
      {
        title: "The Inventory Hunt",
        summary: "Find one thing we hold too much of — and name the signal that should replace the pile.",
        explanationMd: `Hunt day. The quarry: **one thing we hold more of than we need.** The extra tubs. The over-deep pile. The "just in case" that's outlived its case. The thing nobody remembers ordering that's still here.

Use the week's lenses: Where's money parked? (Monday.) Which pile is really a fear — and of what? (Tuesday.) What's used slower than it's bought? (Wednesday.) Which count takes ages because the pile is deep? (Thursday.)

One find each, named without blame: *"That's inventory — we're holding more than we use."* Then the fix question, which this week has a specific shape: **what signal should replace the pile?** A kanban card at the right level. A par written where the stock lives. A smaller order, more often. Log the best finds — and next week we meet the waste everyone already knows by its TCK name: Defects, home of the wonky.`,
        whatToShowMd: `- Find one thing we **hold more of than we use**
- Extra tubs, deep piles, "just in case" survivors
- Name it, no blame — then: **what signal should replace the pile?**

**A kanban card beats a mountain.**`,
        diagram: "waste-inventory",
        deliveryNotesMd: `**How to land it:**
- Steer fixes toward signals: the answer to excess is rarely "throw it away today", it's "change what triggers the next order".
- If a find traces back to a distrusted number, log that specifically — it's the root.
- Log finds with the Quick Idea button. Next week: Defects — and yes, wonkies are the star.

**Ask:** "What did you find — and what's the signal that should replace it?"`,
      },
    ],
  },

  // ── Week 5 — Defects ──────────────────────────────────────────────────
  {
    title: "The 8 Wastes — Defects",
    summary:
      "Product that fails to meet expectations — all the cost is spent either way, so the win is catching causes early.",
    lessons: [
      {
        title: "Meet Defects",
        videoUrl: "https://www.youtube.com/watch?v=Q7TrxEwYVEg",
        summary: "When work has to be done twice — or can't be sold at all.",
        explanationMd: `Waste number four, and the one with a TCK name of its own: **Defects — product that fails to meet customer expectations.** Here, that's the wonky. The burst calzone, the short-weight pack, the mislabelled box, the batch that cooked wrong.

Why defects hurt more than they look: **all the cost is spent either way.** A wonky calzone consumed the same dough, the same filling, the same oven time and the same skilled hands as a perfect one — and then can't earn full price. Worse, defects often demand *extra* work: re-making, re-packing, sorting, apologising.

The lean view, and the heart of this week: a defect is **evidence about the process, never a verdict on a person**. Every wonky carries information about where the process let it happen. Hide it and the information is lost. Hold it up and it teaches us something.`,
        whatToShowMd: `- **Defects = product that fails to meet expectations** — here, the wonky
- All the cost is spent either way: same dough, same filling, same oven, less money
- A defect is **evidence about the process — never a verdict on a person**

**Every wonky has a story. This week we read them.**`,
        diagram: "waste-defects",
        deliveryNotesMd: `**How to land it:**
- If there's a wonky from yesterday, hold it up — not hidden, not apologised for. That gesture IS the lesson: defects are evidence.
- Say the no-blame line word for word and mean it. This week dies instantly if anyone feels accused.
- We already track wonkies daily on the numbers slide — connect the two: the count is the "how many", this week is the "why".

**Ask:** "What was yesterday's wonky count — and can anyone tell the story of one of them?"`,
      },
      {
        title: "The Life Story of a Wonky",
        summary: "Trace one defect backwards — the flaw is usually born long before it's noticed.",
        explanationMd: `Today, one defect, told as a biography — because **where a defect is *noticed* is almost never where it was *born*.**

A calzone bursts in the oven. The oven gets the blame — it's where the evidence appeared. But walk backwards: was the seal thin at building? Was the dough over-proofed at sheeting? Was the filling wetter than spec at prep? Was the recipe sheet ambiguous about weight? The burst was *born* somewhere upstream and merely *revealed* by the heat.

This is why "be more careful" almost never fixes defects — the person at the oven was careful; the flaw arrived with the product. The useful question is always **"where did the process let this begin?"** — asked like a detective, not a judge. Trace it far enough back and you usually find something small and fixable: a wetter mix, a worn tool, an unclear standard. Fix that, and the whole family of future wonkies never gets born.`,
        whatToShowMd: `- Where a defect is **noticed** is rarely where it was **born**
- A burst in the oven may be born at building, sheeting, or prep
- "Be more careful" fixes nothing — **find where the process let it begin**
- Fix the birthplace and the whole family of future wonkies never arrives`,
        diagram: "defect-timeline",
        deliveryNotesMd: `**How to land it:**
- Walk one real recent defect backwards, station by station, with the team supplying the possibilities. They know the upstream suspects better than anyone.
- Keep the detective/judge distinction alive — the question is "where did it *begin*?", never "who?".
- If the trail leads to an unclear standard or recipe ambiguity, that's a jackpot: log it, because it's fixable in writing.

**Ask:** "Take one wonky you've seen this month — where do you reckon it was actually born?"`,
      },
      {
        title: "Catch It Early: Defects Grow Downstream",
        videoUrl: "https://www.youtube.com/watch?v=35SvBZO_z84",
        summary: "The same flaw costs pennies at prep and pounds at packing — quality checks are cheapest upstream.",
        explanationMd: `A defect isn't a fixed-size problem — **it grows as it travels.**

Catch a too-wet filling at prep: you've lost minutes and some ingredients. Miss it, and it goes into forty calzones: now it's forty seals under strain. Miss it again and they burst in the oven: now it's lost product, lost oven time, and a hole in today's orders. Let one reach a customer: now it's a refund, an apology, and a dent in trust that took years to build. Same flaw, four price tags.

That's why the lean rule is **quality at the source**: every station is the customer of the one before it, and the fastest possible "that's not right" is a gift to everyone downstream. Saying it isn't fussiness — it's the cheapest moment the problem will ever have. The two-second habit: before your work moves on, one look — *would I accept this from the station before me?*`,
        whatToShowMd: `- A defect **grows as it travels**: pennies at prep → pounds at packing → trust at the customer
- Every station is the **customer of the one before it**
- The fastest "that's not right" is a gift downstream
- Before it moves on: **would I accept this?**`,
        diagram: "defect-timeline",
        deliveryNotesMd: `**How to land it:**
- Price the journey out loud for one real product — rough numbers are fine; the growth curve is the point.
- Make "saying something early" explicitly welcome, from anyone, about anything — the culture only works if flagging is treated as a favour, not a criticism.
- The handover glance is today's takeaway habit: one look before it moves on.

**Ask:** "Where's the cheapest checkpoint on your station — the moment a flaw is easiest to catch?"`,
      },
      {
        title: "What Fewer Defects Wins Us",
        videoUrl: "https://www.youtube.com/watch?v=ryjVOGnO7uo",
        summary: "Full-price product, unbroken flow, and a team that trusts its own process.",
        explanationMd: `Payday. What do fewer defects actually buy?

**Full price for full effort.** Every avoided wonky is a product that earns what it cost to make. The work was going to be done anyway — now it all counts.

**Unbroken flow.** Defects don't queue politely; they barge in. A burst batch means re-planning, re-making, juggling orders. Fewer defects means days that go the way the plan said they would — which everyone feels as calm.

**Trust — in both directions.** Customers trust what arrives; just as important, *we* trust our own process. A kitchen that rarely produces wonkies is a kitchen where you can relax into the work instead of bracing for the next surprise.

And remember the week's maths: none of this comes from working more carefully under pressure. It comes from fixing birthplaces (Tuesday) and catching early (Wednesday) — process fixes that make the good outcome the easy outcome.`,
        whatToShowMd: `- **Full price for full effort** — the work happens either way; now it all earns
- **Unbroken flow** — days that go the way the plan said
- **Trust, both directions** — customers trust what arrives; we trust our process
- It comes from fixing birthplaces, not from bracing harder`,
        diagram: "waste-defects",
        deliveryNotesMd: `**How to land it:**
- "The work happens either way" is the line that makes the money real — a wonky costs exactly as much to make as a perfect one.
- Calm is the benefit the team feels: fewer surprise re-makes, fewer scrambles.
- Set up tomorrow: we're not hunting wonkies themselves, we're hunting *birthplaces* — the process moments where defects get born.

**Ask:** "What would a zero-wonky week feel like on your station — what would you stop bracing for?"`,
      },
      {
        title: "The Defect Detective",
        videoUrl: "https://www.youtube.com/watch?v=33TFwspsJ_0",
        summary: "Pick one recent defect and trace it to its birthplace — then fix the process, not the person.",
        explanationMd: `Hunt day — but this week it's detective day. Wonkies are already counted; the hunt is for **birthplaces**.

Pick one recent, real defect. Any will do: a burst, a short weight, a label error, a batch that came out wrong. As a group, walk it backwards like Tuesday taught: noticed where? Could it have been caught earlier — where, for how much less? Born where? What in the *process* — a wet mix, a vague standard, a worn tool, a missing check — let it begin?

Then the fix, aimed at the birthplace: **what's the smallest process change that stops this defect being born?** A clearer line on the recipe. A check at the cheap checkpoint. A better tool. Log it with the Quick Idea button.

One traced defect that leads to one process fix is worth more than a month of "be careful". Next week: Motion — the miles our feet walk that nobody ordered.`,
        whatToShowMd: `- Pick one real recent defect — and find its **birthplace**
- Noticed where? Catchable earlier? Born where? What let it begin?
- Fix the birthplace: **the smallest process change that stops it being born**

**One traced defect beats a month of "be careful".**`,
        diagram: "defect-timeline",
        deliveryNotesMd: `**How to land it:**
- Do the trace as a group on ONE defect — a real one, recent enough that people remember. Depth beats breadth today.
- Guard the no-blame line hardest today; the trail passes through people's stations. The quarry is the process moment, never the person.
- Land the fix in the app before the meeting ends. Next week: Motion.

**Ask:** "Which defect shall we put under the microscope — and who saw it first?"`,
      },
    ],
  },

  // ── Week 6 — Motion ───────────────────────────────────────────────────
  {
    title: "The 8 Wastes — Motion",
    summary:
      "Unnecessary movement of people — steps, reaches and searches that tire the team out without touching the product.",
    lessons: [
      {
        title: "Meet Motion",
        videoUrl: "https://www.youtube.com/watch?v=yCHPCtj3tUQ",
        summary: "The miles we walk that nobody ordered — people-movement that adds no value.",
        explanationMd: `Waste number five: **Motion — unnecessary movement of people.** Transportation's twin, but this one's personal: it's *your* legs, *your* reach, *your* search.

The walk to the far sink because the near one's blocked — fifty times a shift. The bend to the low shelf for the thing you use hourly. The rummage for the scoop that's never in the same place twice. The trip across the kitchen because the label printer lives nowhere near the labelling.

Two things make Motion special. First, **it's paid for in your energy** — every wasted step is tiredness that bought nothing. By the end of a shift, motion waste is the difference between pleasantly tired and knackered. Second, **it's invisible because it feels like work.** Walking briskly looks industrious. But the customer pays for calzones, not kilometres. This week: notice your feet.`,
        whatToShowMd: `- **Motion = people moving more than the work needs** — steps, reaches, searches
- Paid for in **your energy**: wasted steps are tiredness that bought nothing
- It hides because it *feels* like work — but the customer pays for calzones, not kilometres

**This week: notice your feet.**`,
        diagram: "waste-motion",
        deliveryNotesMd: `**How to land it:**
- Distinguish from Transportation in one line: last time things moved, this time people move.
- The energy framing is the hook — this is the waste whose removal the team feels in their legs by Friday.
- Ask people to just *notice* today: where do your feet go on autopilot?

**Ask:** "What's your most-repeated walk of the day — and what's waiting at the end of it?"`,
      },
      {
        title: "The Spaghetti Test",
        videoUrl: "https://www.youtube.com/watch?v=NY20p9GuGqY",
        summary: "If we drew your footsteps for one hour, what shape would they make?",
        explanationMd: `Imagine a pen tied to your shoes, drawing your path for one hour of a shift. Lean folk call the result a **spaghetti diagram** — because that's what it usually looks like: a tangled plate of crossings, loops and repeats.

The shape tells the truth about the *layout*, not about you. Loops back to the same drawer mean the drawer's in the wrong place. Long strands to the sink or the bin mean they're far from the action. A knot around two stations means those stations share something they shouldn't — or lack something one of them needs.

The dream shape is boring: short lines, few crossings, everything within a step or a reach. Today's skill is reading your own spaghetti honestly. Where would YOUR hour of string pile up? That knot is where your energy goes — and where the easiest wins are hiding.`,
        whatToShowMd: `- Pen on your shoes, one hour: what shape do your footsteps draw?
- Loops = something's in the wrong place. Long strands = the sink/bin/printer is far from the action
- The shape blames the **layout**, never the person
- Boring spaghetti — short lines, few crossings — is the dream`,
        diagram: "spaghetti-motion",
        deliveryNotesMd: `**How to land it:**
- Have everyone mentally draw their own busiest hour and name their biggest knot out loud.
- Keep hammering: spaghetti diagrams accuse layouts, not people. A messy path means the station fought you and you coped.
- Note the best knots for Friday — they're pre-qualified hunt targets.

**Ask:** "Where's the biggest knot in your spaghetti — and what's the magnet at the centre of it?"`,
      },
      {
        title: "A Home for Everything",
        summary: "Searching is motion's sneakiest form — and a labelled home kills it dead.",
        explanationMd: `The sneakiest motion waste doesn't look like walking at all. It looks like **searching** — and searching is just motion in a small space with rising blood pressure.

The scoop that lives "somewhere in that drawer". The tape gun that migrates. The pen that's never by the sheet that needs signing. Each hunt is seconds — but they're *frequent* seconds, they interrupt flow, and they add the special tiredness of low-grade frustration. (Fix What Bugs You? These are the bugs.)

The kill is total and cheap: **a home for everything, and everything in its home.** A labelled hook, a marked shelf, a shadow board where the tool's outline shows exactly what's missing. When something has an obvious home, three wastes die at once: the search (motion), the "where is it?" question (waiting, next week's guest), and the drift into clutter. Bonus: an empty outline instantly shows what's gone walkabout — the abnormal becomes visible at a glance.`,
        whatToShowMd: `- Searching = motion in a small space — seconds each, dozens a day, pure frustration
- The kill: **a home for everything, and everything in its home**
- Labelled hooks, marked shelves, shadow boards — the outline shows what's missing
- An obvious home makes the abnormal **visible at a glance**`,
        diagram: "waste-motion",
        deliveryNotesMd: `**How to land it:**
- Name the kitchen's most notorious wanderer (every kitchen has one — the tape gun, the good pen, the scoop) and get a laugh; then get it a home.
- If something near the meeting can be given a home in two seconds — do it live. A fix mid-meeting beats ten slides.
- This is 3S territory arriving early; no need to name it — just plant "labelled home = no search".

**Ask:** "What's this kitchen's most-hunted item — and where should its home be?"`,
      },
      {
        title: "Save Your Legs",
        summary: "Motion fixes are energy refunds — the same shift, less worn out.",
        explanationMd: `Payday — and Motion's payday is the most personal of all eight wastes.

Do the sums on one walk: twenty steps to the far shelf, forty times a shift, is around **half a mile a day** — for one item, for one person. Move the item next to where it's used and that half-mile comes back as energy still in your legs at four o'clock. Multiply by every knot on every station's spaghetti and the kitchen is quietly walking a marathon a week that nobody ordered.

The refund shows up three ways. **Your body:** less walking, bending, reaching — shifts that end pleasantly tired instead of wrecked. **Your focus:** no searches means no micro-interruptions; the work flows. **Your time:** steps are seconds, and they were *your* seconds.

And motion fixes are famously cheap: move the thing closer, give it a home, duplicate the £5 tool so both benches have one. Small moves, permanent refunds.`,
        whatToShowMd: `- One 20-step walk, 40× a shift ≈ **half a mile a day** — for one item
- Move the item, keep the energy: shifts that end tired, not wrecked
- No searches = no micro-interruptions = flow
- Motion fixes are cheap: move it closer, give it a home, buy the second £5 tool`,
        diagram: "waste-motion",
        deliveryNotesMd: `**How to land it:**
- Do the step-maths live on a walk the team named this week — their walk, their half-mile.
- "Pleasantly tired vs wrecked" is the line that lands; this waste's removal is felt in the body.
- The duplicate-tool point matters: sometimes the fix costs a fiver and we should just spend it.

**Ask:** "Which single item, moved closer to you, would save your legs the most?"`,
      },
      {
        title: "The Motion Hunt: Fix One Walk Today",
        videoUrl: "https://www.youtube.com/watch?v=6m7Z9wyrFBM",
        summary: "Find one pointless walk, reach or search — and make its fix happen before tomorrow.",
        explanationMd: `Hunt day. The quarry: **one movement of yours that the work doesn't need** — a walk, a reach, a search, a bend.

You've got the week's toolkit: your spaghetti knot (Tuesday), the most-hunted item (Wednesday), the step-maths (Thursday). This is the easiest hunt so far because the evidence is in your own legs — what did your feet do this morning that annoyed you?

One find each — and this week, push for **fixes that happen today**. Motion fixes are the natural home of the two-second improvement: slide the rack nearer, relabel the shelf, hang the hook, move the printer roll. Half of what we find can be fixed before lunch, and fixed-today is how this stops being a meeting topic and becomes how the kitchen works.

Log the finds and the fixes. Next week: Overprocessing — doing more work than the calzone needs.`,
        whatToShowMd: `- Find one movement the work doesn't need: a walk, a reach, a search
- Your legs already know — what annoyed your feet this morning?
- Push for **fixed-today**: slide it nearer, hang the hook, label the home

**Half of these can be fixed before lunch.**`,
        diagram: "spaghetti-motion",
        deliveryNotesMd: `**How to land it:**
- Set the expectation out loud: today's finds should mostly be DONE by end of day. Assign owners on the spot.
- Photograph a before/after if a fix happens — that's tomorrow's celebration and the improvement log's best content.
- Log everything with the Quick Idea button. Next week: Overprocessing.

**Ask:** "What's your find — and can it be fixed before lunch? Who's doing it?"`,
      },
    ],
  },

  // ── Week 7 — Overprocessing ───────────────────────────────────────────
  {
    title: "The 8 Wastes — Overprocessing",
    summary:
      "Doing more work than the customer needs — effort the customer never tastes, polishing what's already good enough.",
    lessons: [
      {
        title: "Meet Overprocessing",
        videoUrl: "https://www.youtube.com/watch?v=C-uo8z0hq_Q",
        summary: "Work beyond what the customer values — effort they'll never taste.",
        explanationMd: `Waste number six, and the strangest of the eight: **Overprocessing — doing more work than the customer needs.** Strange, because it's made entirely of effort. Good, honest, careful effort — aimed past the target.

Double-weighing what the scale already confirmed. Hand-finishing a surface the customer never sees. Writing the same number on two forms. Washing what's already clean because the routine says wash. A check on a check on a check.

The tricky part: overprocessing masquerades as **high standards**. "We're thorough here" — and thoroughness is a virtue, right up until the extra work adds nothing the customer values. The test cuts through it: *would the calzone be one bit worse if this step vanished?* If honestly no, the step is decoration. This week is about aiming our care — which is precious and finite — at the things the customer actually tastes.`,
        whatToShowMd: `- **Overprocessing = more work than the customer needs** — effort aimed past the target
- Double-weighs, double-forms, washing the clean, checks on checks
- It masquerades as high standards — but the test is: **would the calzone be worse without this step?**

**Aim our care where the customer can taste it.**`,
        diagram: "waste-overprocessing",
        deliveryNotesMd: `**How to land it:**
- Tone matters most this week: nobody's care is being mocked. The effort is real and admirable — it's the *aim* we're adjusting.
- Distinguish from corner-cutting immediately: food safety checks, HACCP records, allergen controls are VALUE, not overprocessing. We never trim those — sharpen the aim, never lower the bar.
- The vanish-test is the tool: if the step vanished, would the customer ever know?

**Ask:** "What's one step in this kitchen that we'd never miss if it quietly vanished?"`,
      },
      {
        title: "Where Extra Work Hides at TCK",
        summary: "Double entries, double checks, double handling of information — the paperwork has spaghetti too.",
        explanationMd: `Yesterday's definition; today, where it actually lives here. Overprocessing loves three homes:

**Double recording.** The same fact written twice — a number in a book AND a screen, a temperature noted on paper then typed in later. Every fact should live in exactly one place; the second entry adds risk (they can disagree) and zero value.

**Checks that check nothing.** A verification that hasn't caught a problem in living memory might be theatre. Real checks live at the cheap checkpoints we found in Defects week; ritual checks just live where they've always lived.

**Redoing what's done.** Re-wiping the clean, re-stacking the stacked, re-counting the counted "to be sure". Sureness is lovely; the second count that always matches the first is a habit, not a control.

Careful, though: some double-checks ARE the value — allergen checks, label checks, anything where a miss reaches a customer. The skill is telling the load-bearing checks from the ornamental ones. When in doubt, ask what the check has ever caught.`,
        whatToShowMd: `- **Double recording:** the same fact written twice — one should be the only home
- **Ritual checks:** if it's never caught anything, is it a control or a habit?
- **Redoing the done:** re-wiping the clean, re-counting the counted
- Load-bearing checks stay (allergens! labels!) — the ornamental ones are the waste`,
        diagram: "waste-overprocessing",
        deliveryNotesMd: `**How to land it:**
- Ask the team where they write the same thing twice — paperwork double-entry is the most common find and the app exists precisely to kill it. Log every instance named.
- Repeat the guardrail from yesterday: safety and allergen checks are sacred. Use the phrase "load-bearing" — it gives people a way to defend a check that matters.
- "What has this check ever caught?" is a genuine question, not a gotcha — sometimes the answer is "a disaster in 2024" and the check earns its keep.

**Ask:** "Where do you record the same thing twice — and which copy should win?"`,
      },
      {
        title: "Good Enough Is a Standard, Not a Shrug",
        summary: "The customer defines done — a clear standard protects both quality and effort.",
        explanationMd: `"Good enough" gets a bad name, as if it means settling. In lean it means something precise and rather liberating: **done is defined by the customer, and written down.**

Without a clear standard, every person invents their own finish line — and caring people set it too far. One builder crimps five folds because that's what the seal needs; another does nine to be safe. The extra four folds cost time and add nothing — but *nobody decided that*; it just grew. Where "done" is fuzzy, overprocessing breeds.

This is what our SOPs and specs are really for — not paperwork, but agreed finish lines: what weight, what look, what check, what counts as done. A good standard protects in both directions at once: it stops under-doing (defects) AND over-doing (this week's waste). And standards aren't stone — when someone finds a better "done", we change the standard, and then everyone's new finish line moves together.`,
        whatToShowMd: `- **The customer defines done — and we write it down**
- Fuzzy finish lines make caring people over-do: five folds vs nine, nobody decided
- A clear standard protects both ways: no under-doing, no over-doing
- Find a better "done"? Change the standard — everyone's line moves together`,
        diagram: "standard-line",
        deliveryNotesMd: `**How to land it:**
- The five-folds-vs-nine example works spoken with any real task: pick one where you know team members finish differently.
- Reframe SOPs as protection for the team's effort, not management paperwork — that's genuinely what they're for.
- If a finish line is fuzzy anywhere ("how clean is clean? how tight is tight?"), naming it today is the win — that's a standard waiting to be written. Log it.

**Ask:** "Which job's finish line is fuzziest — where do people honestly disagree on what 'done' looks like?"`,
      },
      {
        title: "What Trimming Extra Work Wins Us",
        videoUrl: "https://www.youtube.com/watch?v=refb1eGbo_Y",
        summary: "Care aimed where it counts, time back, and standards everyone can trust.",
        explanationMd: `Payday. Trimming overprocessing pays differently from the other wastes — it pays in **aim**.

**Your care goes further.** Attention is finite; every drop spent polishing the invisible is a drop not spent on what the customer tastes. Trim the ornamental work and the same care, redirected, makes the product genuinely better.

**Time appears from nowhere.** Overprocessing hides inside jobs, so trimming it shortens jobs without anyone hurrying. The double-entry that dies gives back its minutes every single day.

**Standards you can trust.** When "done" is defined, you can finish with confidence instead of doing one more pass "to be safe". That quiet confidence — knowing you've hit the standard, exactly — is a nicer way to work than endless private over-delivery.

And the discipline stays: we trim what the customer can't taste. Anything that protects safety, legality or the customer keeps every fold.`,
        whatToShowMd: `- **Care goes further** — attention off the invisible, onto what the customer tastes
- **Time from nowhere** — trimmed steps refund their minutes daily
- **Confidence at the finish line** — hit the standard, done, no "one more pass"
- Safety and legality keep every fold, always`,
        diagram: "waste-overprocessing",
        deliveryNotesMd: `**How to land it:**
- "Care is finite — aim it" is the week's core sentence; today's the day to say it plainly.
- The confidence point resonates with your most careful people — the standard *frees* them from endless private over-delivery.
- Recap the guardrail once more before hunt day so nobody trims a load-bearing check tomorrow.

**Ask:** "If you got ten minutes back from trimmed busywork, what would you aim that care at instead?"`,
      },
      {
        title: "The Overprocessing Hunt",
        summary: "Find one piece of work the customer would never miss — and check it's truly ornamental before it goes.",
        explanationMd: `Hunt day — with this week's special rule: **verify before you trim.**

The quarry: one piece of work the customer would never miss. A double entry. A ritual check that's never caught anything. A polish on the invisible. A "to be safe" pass on top of a passed standard.

The extra step this week: before anything gets trimmed, it faces two questions in front of the group. *Would the product, the customer, or safety be one bit worse without it?* and *What has this step ever caught?* If the answers are honestly "no" and "nothing", it's ornamental — trim it, and enjoy the rare pleasure of improving something by deleting it. If anyone can name what it protects, it stays, with new respect.

Log the trims AND the keeps — a check that survives the challenge is worth recording too. Next week: Waiting, the waste you can feel in your bones.`,
        whatToShowMd: `- Find one piece of work the **customer would never miss**
- Before it goes, two questions: *worse without it? what has it ever caught?*
- Honestly "no" and "nothing" → trim it. Someone names what it protects → it stays
- **Improving by deleting** — the rare pleasure`,
        diagram: "waste-overprocessing",
        deliveryNotesMd: `**How to land it:**
- Run the two-question challenge as a group ritual — it keeps trims safe and it's genuinely fun; steps get defended and acquitted.
- Any trim touching records, food safety or allergens gets checked with Graeme before it happens, full stop.
- Log both trims and acquittals. Next week: Waiting.

**Ask:** "Who's got a candidate — and can it survive the two questions?"`,
      },
    ],
  },

  // ── Week 8 — Waiting ──────────────────────────────────────────────────
  {
    title: "The 8 Wastes — Waiting",
    summary:
      "Time spent waiting on a process, a machine or each other — idle minutes the day never gives back.",
    lessons: [
      {
        title: "Meet Waiting",
        videoUrl: "https://www.youtube.com/watch?v=7U9tQCpkCv4",
        summary: "The waste you can feel — people ready, work not.",
        explanationMd: `Waste number seven: **Waiting — time spent waiting for a process or a stage to finish.** People ready, work not. Standing by the mixer as it runs its last two minutes. The station waiting for the trolley that hasn't arrived. Everything paused until the oven frees up. Waiting for a sign-off, a decision, a "you can start now".

Waiting is the easiest waste to *feel* — everyone knows the flat, fidgety sensation of being stood ready with nothing to do — but oddly hard to *count*, because it comes in crumbs: ninety seconds here, three minutes there, scattered through the day. Sweep the crumbs together and it's routinely the biggest time-waste in a kitchen.

Two truths for the week. First, **waiting is a symptom** — somewhere upstream, a sequence, a machine or a handover is out of step. Second, the person waiting is never the problem; they're the *evidence*. This week: notice the crumbs.`,
        whatToShowMd: `- **Waiting = people ready, work not** — mixers, ovens, trolleys, sign-offs
- It comes in crumbs: 90 seconds here, 3 minutes there — swept together, it's huge
- Waiting is a **symptom** of something upstream out of step
- The person waiting is never the problem — they're the evidence

**This week: notice the crumbs.**`,
        diagram: "waste-waiting",
        deliveryNotesMd: `**How to land it:**
- Everyone recognises the feeling — open by asking where people waited yesterday and watch the hands go up.
- Plant the symptom-framing early: we'll chase causes all week, not tut at idle people.
- Note the named waits — they're the raw material for Wednesday and Friday.

**Ask:** "Where did you wait yesterday — and for what?"`,
      },
      {
        title: "Waiting on Machines",
        summary: "The mixer doesn't need company — pair machine time with human work.",
        explanationMd: `First family of waits: **machine waits.** The mixer running, the oven cooking, the sheeter working through a batch — and a person stood watching.

Here's the reframe: machine time is *free* work. The mixer doesn't get lonely and doesn't cheat when unwatched. The waste isn't the machine taking eight minutes — that's its job — the waste is what the *human* does with those eight minutes. Watching them is spending your time to buy nothing.

The lean move is **pairing**: match every machine wait with a piece of human work that fits its window. Mixer runs eight minutes → that's exactly a station reset, the next batch weighed, labels prepped. Oven cycle → the wrap-down, the sweep, tomorrow's tubs. The skill is knowing your windows: how long each machine actually takes, and having a "wait work" list that fits each slot. Done well, machine time becomes the most productive time of the day — because two things are happening at once, and only one of them needed you.`,
        whatToShowMd: `- The mixer doesn't need company — **machine time is free work**
- The waste isn't the machine's eight minutes; it's what we do with them
- **Pair every machine window with work that fits it**: reset, weigh-up, labels
- Know your windows; keep a wait-work list that fits each slot`,
        diagram: "waste-waiting",
        deliveryNotesMd: `**How to land it:**
- Map one real machine window with the team: what runs unattended, for how long, and what genuinely fits inside it?
- Guard against the wrong lesson: this is NOT "never stand still" — it's that machine windows are perfect for the small jobs that otherwise crowd the busy moments.
- If a machine genuinely needs watching for safety or quality, that watching is value — say so.

**Ask:** "What's our longest unattended machine window — and what job fits inside it perfectly?"`,
      },
      {
        title: "Waiting on Each Other",
        videoUrl: "https://www.youtube.com/watch?v=_tSoUaXU_cg",
        summary: "Handovers and bottlenecks — when one station's pace sets everyone's day.",
        explanationMd: `Second family, the harder one: **waiting on each other.** Building waiting on dough. Wrapping waiting on the ovens. Packing waiting on wrapping. One station's hiccup arriving at the next station as dead time.

This is about **flow**. Stations in a chain are like traffic on a single-lane road: everyone ends up travelling at the pace of the slowest stretch — the *bottleneck*. Minutes gained anywhere else just become waiting at the bottleneck; minutes gained AT the bottleneck flow through the entire day. That's why "who's slowest?" is the wrong question and **"where does work pile up, and where do people run dry?"** is the right one. Piles form *before* a bottleneck; idle hands sit *after* it.

Two flow-savers cost nothing. **A heads-up beats a surprise:** "dough's running ten minutes late" lets the next station re-plan instead of stand about. **Sequence matters:** starting the long jobs first is often the whole fix. The plan's order of production exists for exactly this reason.`,
        whatToShowMd: `- Stations in a chain travel at the pace of the **bottleneck**
- Piles form *before* it; idle hands sit *after* it — look for both
- Minutes gained at the bottleneck flow through the **whole day**
- Free fixes: a heads-up beats a surprise; long jobs start first`,
        diagram: "bottleneck-flow",
        deliveryNotesMd: `**How to land it:**
- Map our own chain out loud (dough → build → oven → wrap → pack) and ask where piles form and who runs dry — the room will converge on the bottleneck fast.
- Handle it carefully: the bottleneck station is not the villain; it's where the whole team's help pays off most.
- The heads-up habit can start today; it costs one shouted sentence.

**Ask:** "Where does work pile up in our chain — and does that station know the queue is forming?"`,
      },
      {
        title: "What Killing Waits Wins Us",
        summary: "Days that flow — shorter in feel, smoother in fact, and less overtime at the edges.",
        explanationMd: `Payday. What does a low-waiting day actually feel like?

**It flows.** Work arrives as you're ready for it; you hand off and the next thing is there. Ask anyone about their best-ever shift and they describe exactly this — not an easy day, a *flowing* one. Waiting is what makes a shift drag; flow is what makes it fly.

**The day fits the day.** Waits scattered through the middle push real work to the edges — the scramble before the van, the late finish. Sweep the crumbs back and production lands inside the planned hours, calmly.

**Machines and people both earn.** Paired windows (Tuesday) mean the mixer's eight minutes and your eight minutes stop being the same eight minutes.

**And the fixes compound:** every heads-up given, every sequence corrected, every window paired shaves crumbs off tomorrow too. Time is the one ingredient we can't reorder — killing waits is how we stop binning it.`,
        whatToShowMd: `- Low-waiting days **flow** — everyone's best-ever shift was a flowing one
- Crumbs swept back = production fits the planned hours; no edge-of-day scramble
- Paired windows: the mixer's 8 minutes stop costing your 8 minutes
- **Time is the one ingredient we can't reorder**`,
        diagram: "waste-waiting",
        deliveryNotesMd: `**How to land it:**
- Open with "describe your best shift ever" — someone will describe flow unprompted, and the lesson teaches itself.
- The reorder line is the keeper: we can reorder mozzarella; we cannot reorder Tuesday afternoon.
- Set up tomorrow's hunt: today we felt the prize; tomorrow we clock the crumbs.

**Ask:** "What made your best-ever shift here flow — and what usually breaks that spell?"`,
      },
      {
        title: "The Waiting Hunt: Clock the Crumbs",
        videoUrl: "https://www.youtube.com/watch?v=ibBXtlco4ms",
        summary: "Catch one wait, time it honestly, and trace what upstream let it happen.",
        explanationMd: `Hunt day. The quarry: **one wait, caught and clocked.** Not remembered vaguely — witnessed: who was ready, what wasn't, and roughly how long the gap ran.

Then this week's detective move — waits are symptoms, so trace it: *what upstream let this happen?* A sequence that starts the short job before the long one? A machine window nobody's paired? A handover with no heads-up? A bottleneck queue everyone's stopped seeing? The wait names its own fix once you ask what caused it.

Fixes this week are mostly free: re-order the sequence, agree the heads-up, write the wait-work list for the mixer window. Log the best finds with the Quick Idea button — include the minutes, because clocked minutes make the case for any fix instantly.

Next week, the final waste — and the one Ryan's book treats as the saddest of all: the **Waste of Skills**.`,
        whatToShowMd: `- Catch one wait live: who was ready, what wasn't, **how long**
- Trace it upstream: sequence? unpaired window? no heads-up? bottleneck?
- The wait names its own fix — and most fixes are free
- **Clock the minutes** — clocked minutes make the case`,
        diagram: "waste-waiting",
        deliveryNotesMd: `**How to land it:**
- Insist on real timings today, even rough ones — "about four minutes" turns a moan into a case.
- Push every find one step upstream before accepting a fix; treating the symptom ("hurry up") is the trap.
- Log finds with minutes attached. Next week: the Waste of Skills — the ideas we never use.

**Ask:** "What did you clock — how many minutes, and what upstream let it happen?"`,
      },
    ],
  },

  // ── Week 9 — Waste of Skills ──────────────────────────────────────────
  {
    title: "The 8 Wastes — Waste of Skills",
    summary:
      "Failing to use people's talents and ideas — the eighth waste, and the one that makes all the others fixable.",
    lessons: [
      {
        title: "Meet the Waste of Skills",
        videoUrl: "https://www.youtube.com/watch?v=3kty-JyMZJA",
        summary: "The saddest waste: brains in the building whose ideas never get asked for.",
        explanationMd: `The eighth and final waste — and the one Lean Made Simple treats as the saddest: **the Waste of Skills — failing to make the best use of people's talents and abilities.**

It's the only waste made of *absence*. Nothing's binned, nothing's carried, nobody's stood idle — what's wasted is invisible: the improvement never suggested, the knack never shared, the talent never asked about. The person who's brilliant at organising who's never been asked how the walk-in should be laid out. The builder who's quietly worked out a better fold that stays at one bench. The new starter whose fresh eyes see everything — asked to keep quiet and learn "our way" instead.

Here's what makes this waste special: **it's the master waste.** Every other waste we've met — the seven before it — gets found and fixed by *people*. Waste the people's ideas and every other waste gets to stay. Use them, and the kitchen fixes itself. This week is about switching that on.`,
        whatToShowMd: `- **Waste of Skills = people's talents and ideas going unused**
- The only waste made of absence: the suggestion never made, the knack never shared
- It's the **master waste**: people fix the other seven — waste their ideas and every waste stays

**Eight brains beat one. This week we switch them all on.**`,
        diagram: "waste-skills",
        deliveryNotesMd: `**How to land it:**
- Use the canonical name — "Waste of Skills" — and treat it with the weight the book gives it: this is the finale of the whole programme.
- The master-waste framing is the teach: connect it back to every hunt we've run — every find this term came from a person noticing.
- Plant the week's arc: who knows what → why ideas stay unsaid → what asking wins → the harvest.

**Ask:** "Think of a workmate — what are they quietly brilliant at that the job never asks them for?"`,
      },
      {
        title: "The Person Doing the Job Knows the Job",
        videoUrl: "https://www.youtube.com/watch?v=Y60WQdJ9_nI",
        summary: "Nobody knows a task's waste like the hands that do it daily.",
        explanationMd: `A plain truth that whole management books take three hundred pages to say: **the person who does a job every day knows more about that job than anyone else in the building.**

Whoever wraps knows which pack sizes fight back. Whoever mixes knows which recipe's quantities run out first. Whoever packs the van knows which route order actually works. This isn't sentiment — it's about *where the information lives*. The friction, the workarounds, the "it always does that" — that knowledge exists in exactly one place: the hands doing the work.

Which means every improvement this system will ever log starts the same way: someone doing a job notices something. Not a manager with a clipboard — the doer, mid-task, thinking "this bit's daft". The whole apparatus — waste walks, hunts, the Quick Idea button — exists to catch what doers notice.

So today's shift is small but real: your observations aren't interruptions to the work. **Noticing is part of the job — the expert part.**`,
        whatToShowMd: `- **The person doing the job knows the job** — better than anyone in the building
- The friction, the workarounds, the "it always does that" — that knowledge lives in your hands only
- Every improvement ever logged starts with a doer noticing
- Noticing isn't interrupting the work — **it's the expert part of the work**`,
        diagram: "waste-skills",
        deliveryNotesMd: `**How to land it:**
- Prove it live: ask a specific person one real question about their station ("which pack size fights back?") and let the room hear expertise nobody else had.
- Say the reframe explicitly: when you flag something daft, you're not moaning — you're consulting.
- This is why hunt finds must never be brushed off; each one is a specialist's report.

**Ask:** "What's one thing about your station only YOU would know — the thing that never makes it into any instruction?"`,
      },
      {
        title: "Why Good Ideas Stay Unsaid",
        summary: "The barriers that keep ideas in heads — and how we take each one down.",
        explanationMd: `If everyone's an expert in their own job, why do so many ideas die unsaid? Because saying an idea has costs, and unless we remove them, silence is the rational choice. The barriers have names:

**"Nothing will happen anyway."** The killer. Suggest twice, watch both vanish, never suggest again. The only cure is *visible follow-through* — ideas logged, tracked, and seen to change things.

**"It'll sound like a complaint."** Naming waste can feel like criticising whoever set things up. That's why no-blame isn't a nicety — it's load-bearing. Waste lives in the process; saying so accuses nobody.

**"It's too small to mention."** Backwards, as this programme keeps showing: small is the good size. Two-second fixes are the ones that actually happen.

**"Not my place."** The oldest one. But the expertise argument from yesterday demolishes it: the doer is exactly whose place it is.

Every one of these is ours to remove — and the fix is the same for all four: make suggesting cheap, safe, and *visibly worth it*.`,
        whatToShowMd: `- Ideas stay unsaid for reasons: **"nothing happens" · "sounds like moaning" · "too small" · "not my place"**
- Every barrier is ours to remove — none of them is true here
- No-blame is load-bearing: waste lives in the process, so naming it accuses nobody
- Small is the GOOD size — and the doer is exactly whose place it is`,
        diagram: "idea-barriers",
        deliveryNotesMd: `**How to land it:**
- Read the four barriers slowly — people will recognise their own. No need to make anyone confess which is theirs.
- Own the first barrier honestly: if ideas have ever vanished into silence here, acknowledging that costs a little and buys a lot.
- Make the promise concrete: logged ideas get answers — visibly, with names, in this meeting.

**Ask:** "Which barrier is most real in this kitchen — and what would prove to you it's gone?"`,
      },
      {
        title: "What Using Every Brain Wins Us",
        videoUrl: "https://www.youtube.com/watch?v=YA2skNMrWGs",
        summary: "A kitchen that fixes itself — and work that's more interesting to do.",
        explanationMd: `Payday for the master waste — and it's the biggest of the programme.

**A kitchen that fixes itself.** One manager hunting waste finds some. Sixteen people noticing as they work find *all of it* — including the waste only visible from inside each job. Every hunt this term proved it: the finds came from everywhere.

**Improvements that stick.** Fixes invented by the person doing the job fit the job — they defend and improve their own idea, because it's theirs. Imposed fixes drift; owned fixes hold.

**More interesting work.** The same shift with your brain switched on beats the same shift on autopilot. Noticing, suggesting, seeing your fix become the standard — with your name on it — turns a job into *your* job. That's the point where lean stops being a Monday topic and becomes the culture.

**And the compounding:** sixteen people, one small improvement each per week, is eight hundred a year. No initiative buys what that habit builds.`,
        whatToShowMd: `- Sixteen people noticing beats any manager hunting: **the kitchen fixes itself**
- Fixes invented by the doer FIT — and hold, because they're owned
- A shift with your brain on beats autopilot — improvements with **your name on them**
- 16 people × 1 small fix a week = **hundreds a year**`,
        diagram: "compound-growth",
        deliveryNotesMd: `**How to land it:**
- Do the multiplication on the slide with our real headcount — the number lands hard.
- If any improvement this term already has someone's name on it, celebrate it here by name; that's the whole system working.
- Ownership is the deep point: "your fix, your name, the new standard" is a different job from "do it the way you found it".

**Ask:** "What improvement would you want your name on by Christmas?"`,
      },
      {
        title: "The Skills Harvest",
        videoUrl: "https://www.youtube.com/watch?v=LOvqtTyJRHk",
        summary: "The final hunt: every person contributes one idea — and the programme becomes the culture.",
        explanationMd: `The final hunt of the programme — and this one hunts the eighth waste directly. The quarry isn't a thing. It's **the unsaid idea.**

Everyone brings one to the surface today: one improvement you've thought about but never said. The walk that annoys you. The tool that should live somewhere else. The step that's daft. The thing you'd change on day one if this were your kitchen — because it is. Small is perfect; two-second is perfect. The only wrong answer is silence.

Nine weeks ago we learned to see waste. Since then: overproduction, journeys, piles, defects, steps, polish, waits — and today, the waste that hides the rest. You now share a language most workplaces never get. The hunts end; the habit doesn't. **See it, name it, log it, fix it** — that's just how this kitchen works now.

Every idea logged today. Every one gets an answer. That's the deal — and it starts the culture we keep.`,
        whatToShowMd: `- Final hunt: bring the **unsaid idea** to the surface — one each, today
- Small is perfect; two-second is perfect; silence is the only wrong answer
- Nine weeks: you now share a language most workplaces never get
- **See it, name it, log it, fix it — that's how this kitchen works now**`,
        diagram: "eight-wastes",
        deliveryNotesMd: `**How to land it:**
- Give this one room — it's the programme finale. Go round the room; every person contributes one idea, logged live with the Quick Idea button.
- Every idea gets acknowledged by name, today or tomorrow — this meeting is where the follow-through promise gets kept or broken.
- Close by naming the journey: nine weeks, eight wastes, one shared language. The morning lesson continues — the culture is the point.

**Ask:** "One idea each — what's the thing you've been meaning to say?"`,
      },
    ],
  },
];

// ── Weekly quizzes ────────────────────────────────────────────────────
// Three questions per week, indexed to LEAN_CURRICULUM_V2. The quiz is the
// last page of the weekly review module: it checks the week's idea actually
// landed ("they genuinely can't pass it without understanding" — Graeme,
// 2026-08-25). All questions must be answered correctly to complete;
// retries are free — the goal is understanding, not examination.

export interface QuizQuestionV2 {
  question: string;
  options: string[];
  /** Index into options. */
  answer: number;
}

export const LEAN_QUIZZES_V2: QuizQuestionV2[][] = [
  // Week 1 — Seeing Waste
  [
    {
      question: "What makes something \"waste\"?",
      options: [
        "It takes a long time",
        "The customer wouldn't pay for it",
        "It's hard work",
        "It happens away from the kitchen",
      ],
      answer: 1,
    },
    {
      question: "Who decides what counts as value?",
      options: ["The head chef", "Whoever's done the job longest", "The customer", "The plan"],
      answer: 2,
    },
    {
      question: "Why is familiar waste the most dangerous kind?",
      options: [
        "It's usually the biggest",
        "We stop noticing it — it just feels normal",
        "It only happens in the fridges",
        "It costs the most money",
      ],
      answer: 1,
    },
  ],
  // Week 2 — Overproduction
  [
    {
      question: "What is Overproduction?",
      options: [
        "Making food too fast",
        "Making more than the customer demands",
        "Using too many ingredients in a batch",
        "Cooking at too high a temperature",
      ],
      answer: 1,
    },
    {
      question: "Why is overproduction \"the waste that feeds the others\"?",
      options: [
        "It's the most common waste",
        "It always happens first in the day",
        "The extra needs storing, moving, counting — and often binning",
        "It uses the most electricity",
      ],
      answer: 2,
    },
    {
      question: "The plan says 6kg but the tub holds 8kg. The lean move is…",
      options: [
        "Prep 8kg and keep the extra for tomorrow",
        "Prep 6kg — the plan's number already includes the buffer",
        "Prep 8kg and bin the extra",
        "Split the difference at 7kg",
      ],
      answer: 1,
    },
  ],
  // Week 3 — Transportation
  [
    {
      question: "Transportation waste is…",
      options: [
        "People walking too much",
        "The delivery van's fuel costs",
        "Unnecessary movement of product and materials",
        "Moving things too slowly",
      ],
      answer: 2,
    },
    {
      question: "The \"mid-air test\" asks, before you put something down…",
      options: [
        "Is this heavy?",
        "Is this its home — or will someone have to touch it again?",
        "Is the fridge full?",
        "Who moved this last?",
      ],
      answer: 1,
    },
    {
      question: "Every extra journey costs twice because…",
      options: [
        "Two people have to carry it",
        "It uses fuel and time",
        "Someone's time is spent carrying AND every move risks the product",
        "It always happens twice a day",
      ],
      answer: 2,
    },
  ],
  // Week 4 — Inventory
  [
    {
      question: "Inventory waste is best described as…",
      options: [
        "Having any stock at all",
        "Cash sitting on a shelf — with a use-by date",
        "Food stored in the freezer",
        "A full order book",
      ],
      answer: 1,
    },
    {
      question: "Excess stock is usually caused by…",
      options: [
        "Laziness",
        "Fear — like \"what if we run out?\"",
        "Suppliers sending too much",
        "Having big fridges",
      ],
      answer: 1,
    },
    {
      question: "What happens when we lower the \"water level\" (stock) slowly?",
      options: [
        "We run out immediately",
        "Stock counts take longer",
        "Hidden problems surface — so we can finally fix them",
        "The kanban cards stop working",
      ],
      answer: 2,
    },
  ],
  // Week 5 — Defects
  [
    {
      question: "Why does a wonky calzone hurt more than it looks?",
      options: [
        "It looks unprofessional",
        "All the cost is spent either way — same dough, filling and oven time, less money back",
        "It takes longer to bin",
        "It upsets whoever built it",
      ],
      answer: 1,
    },
    {
      question: "Where is a defect usually BORN?",
      options: [
        "Exactly where it's noticed",
        "Upstream of where it's noticed",
        "In the oven",
        "At packing",
      ],
      answer: 1,
    },
    {
      question: "In lean thinking, a defect is…",
      options: [
        "Always someone's fault",
        "Bad luck",
        "Unavoidable in a kitchen",
        "Evidence about the process — never a verdict on a person",
      ],
      answer: 3,
    },
  ],
  // Week 6 — Motion
  [
    {
      question: "Motion waste is…",
      options: [
        "Unnecessary movement of PEOPLE — steps, reaches, searches",
        "Unnecessary movement of product",
        "Machines vibrating",
        "Walking too slowly",
      ],
      answer: 0,
    },
    {
      question: "A spaghetti diagram of your footsteps mostly tells you about…",
      options: [
        "Your fitness",
        "The layout — never the person",
        "How fast you walk",
        "Who's slowest on shift",
      ],
      answer: 1,
    },
    {
      question: "The cure for searching is…",
      options: [
        "A better memory",
        "More drawers",
        "A home for everything, and everything in its home",
        "Asking a manager",
      ],
      answer: 2,
    },
  ],
  // Week 7 — Overprocessing
  [
    {
      question: "Overprocessing means…",
      options: [
        "Processing food for too long",
        "Doing more work than the customer needs",
        "Working overtime",
        "Using machines instead of hands",
      ],
      answer: 1,
    },
    {
      question: "Which of these must NEVER be trimmed as overprocessing?",
      options: [
        "Writing the same number in two places",
        "Allergen and food-safety checks",
        "Re-counting a count that always matches",
        "Polishing a surface the customer never sees",
      ],
      answer: 1,
    },
    {
      question: "In lean, \"good enough\" means…",
      options: [
        "Settling for less",
        "Roughly right",
        "Whatever is fastest",
        "Done as the customer defines it — written down as the standard",
      ],
      answer: 3,
    },
  ],
  // Week 8 — Waiting
  [
    {
      question: "Waiting waste is…",
      options: [
        "People ready, work not",
        "Machines sitting idle overnight",
        "Customers waiting for delivery",
        "Walking slowly between stations",
      ],
      answer: 0,
    },
    {
      question: "The mixer runs for 8 minutes. The lean move is…",
      options: [
        "Watch it so nothing goes wrong",
        "Turn it up so it finishes faster",
        "Pair the window with work that fits it — reset the station, weigh up, prep labels",
        "Start it later in the day",
      ],
      answer: 2,
    },
    {
      question: "In a chain of stations, everyone ends up working at the pace of…",
      options: ["The fastest station", "The average", "The host", "The bottleneck"],
      answer: 3,
    },
  ],
  // Week 9 — Waste of Skills
  [
    {
      question: "The Waste of Skills is…",
      options: [
        "Hiring the wrong people",
        "Failing to use people's talents and ideas",
        "Forgetting your training",
        "Poor knife skills",
      ],
      answer: 1,
    },
    {
      question: "Who knows a job's waste best?",
      options: [
        "The manager",
        "The customer",
        "The person who does the job every day",
        "The supplier",
      ],
      answer: 2,
    },
    {
      question: "Why is the Waste of Skills called the master waste?",
      options: [
        "It's the biggest in kilograms",
        "It's the oldest of the eight",
        "It costs the most per week",
        "People find and fix the other seven — waste their ideas and every waste stays",
      ],
      answer: 3,
    },
  ],
];
