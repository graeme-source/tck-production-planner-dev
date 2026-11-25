/**
 * A plain-English map of what the Production Planner can already do.
 *
 * AI Jane uses it to answer "can the app do X?" with "yes, here's where"
 * instead of logging a feature request for something that exists.
 *
 * Rules for editing:
 *  - Describe only what the code shows. If unsure, leave it out.
 *  - `path` is a real page staff can open. Pages that need an id (a plan's
 *    station screen, a document) point at the nearest list page and say in
 *    canDo how to get there.
 *  - `who` is plain text for a human reader, taken from the role gates
 *    (page access levels, feature grants, server checks).
 *  - Nothing about pay, HR records or finance beyond a person's own
 *    Employee Hub. Founder-only pages are left out.
 */

export interface AppGuideEntry {
  path: string;
  title: string;
  who: string;
  canDo: string[];
  keywords: string[];
}

export const APP_GUIDE: AppGuideEntry[] = [
  // ── Home, stations and the day's plan ──────────────────────────────────
  {
    path: "/",
    title: "Dashboard",
    who: "everyone",
    canDo: [
      "Tap a station card under Today's Production to open that station for today's plan",
      "Pick Building Table 1 or 2 when you open building",
      "Open Morning Meeting, Front Door - Deliveries, Pack Report and the end-of-day meeting from Today's Admin",
      "See today's progress numbers (mixed, built, cooked, wrapped, fulfilled)",
    ],
    keywords: ["home", "start", "station picker", "stations", "today", "progress", "front page", "landing"],
  },
  {
    path: "/plans",
    title: "Production Plans",
    who: "everyone can view; managers and admins build and run plans",
    canDo: [
      "Open a plan to see its station list and tap a station (Dough Prep, Prep, Mixing & Cooking, Building, Ovens, Wrapping, Packing and so on) to open that station screen",
      "Create a plan for a production date and choose recipes and batches",
      "Use Raw Materials to see the ingredient totals for a plan",
      "Use View Orders to see the supplier orders for a plan, and Regenerate Orders to rebuild them",
      "Use Validate to check a plan before activating it",
      "Activate & Lock a draft plan, Mark Complete when finished, and Download Lock PDF",
      "Save a set of recipes as a collection and reuse it when building a plan",
    ],
    keywords: ["plan", "plans", "production plan", "create plan", "batches", "schedule", "production day", "activate", "lock", "raw materials", "collection"],
  },
  {
    path: "/plans",
    title: "Station screens (all stations)",
    who: "everyone signed in; some stations are assigned to one person at a time",
    canDo: [
      "Open the plan from Production Plans (or tap the station card on the Dashboard) and choose the station",
      "Switch between the station's production view, its Checklist (opening, cleaning, closing) and, where offered, a Prep sheet",
      "Use the Station menu next to Exit Station for contacts, the SOP library, attaching an SOP, and what has changed at this station",
      "Tap Messages in the station top bar to read or send a message",
    ],
    keywords: ["station", "stations", "exit station", "station menu", "checklist", "what's changed", "assigned", "screen"],
  },
  {
    path: "/plans",
    title: "Dough Prep and Dough Sheeting stations",
    who: "everyone signed in",
    canDo: [
      "Open the plan, then Dough Prep, to weigh up and mix dough and portion it into balls",
      "Open Dough Sheeting to tick off each ball or billet as it is sheeted, one recipe at a time with Prev/Next on the bottom dock",
      "Same-day doughs such as cinnamon bun dough appear in their own group on the day they are made",
    ],
    keywords: ["dough", "dough prep", "balling", "sheeting", "sheeter", "billet", "bun dough", "cinnamon"],
  },
  {
    path: "/plans",
    title: "Prep stations (bases, raw meat, main prep)",
    who: "everyone signed in",
    canDo: [
      "Open the plan, then Prep, to reach the prep sections: Sub-recipes (bases, sauces, marinades), Raw Meat and Main Prep",
      "Tick off prep items and tins as they are done; amounts are shown in whole grams or kg",
      "Tap a rub or marinade named on a meat row to make it in a pop-up without leaving the screen",
      "Print an ingredient or tin label from a prep row where the print button shows",
      "Use the Stock Check tab at prep to record what is left",
      "Open the SOP link on a row to see how to do it",
    ],
    keywords: ["prep", "preparation", "prep room", "raw meat", "marinade", "rub", "sauce", "base", "sub-recipe", "tin", "replenish", "make mix", "weights", "grams"],
  },
  {
    path: "/plans",
    title: "Mixing & Cooking station",
    who: "everyone signed in",
    canDo: [
      "Open the plan, then Mixing & Cooking, to see what to mix and cook for the day",
      "Record cooking details and temperature checks where the screen asks for them",
      "Look at the live mix timeline to see what is due when",
      "Find the prep oven timings in the Station menu",
    ],
    keywords: ["mixing", "cooking", "cook", "filling", "temperature", "probe", "timeline", "tray", "oven timings"],
  },
  {
    path: "/",
    title: "Building stations (Table 1 and Table 2)",
    who: "everyone signed in",
    canDo: [
      "Tap Building Table 1 or 2 on the Dashboard, or open the plan and choose it",
      "Work through recipes one at a time and mark batches built",
      "Tap Edit on a recipe to change batches or extra packs, then choose which line the change belongs to and Save",
      "See the On top section for toppings, and amber oven-change notes for recipes that bake differently",
    ],
    keywords: ["building", "builder", "build", "table 1", "table 2", "line 1", "line 2", "batch built", "extra batch", "amend batch", "toppings", "extra packs"],
  },
  {
    path: "/plans",
    title: "Ovens station",
    who: "everyone signed in",
    canDo: [
      "Open the plan, then Ovens, to see one recipe at a time with Prev/Next on the bottom dock",
      "Record wonky and dog bin counts with the two steppers on the recipe panel or in the end-of-recipe prompt",
      "Record weights for the recipe in the weight pop-up",
      "See amber oven-change notes for recipes that bake differently",
    ],
    keywords: ["ovens", "oven", "baking", "bake", "wonky", "dog bin", "reject", "weights", "blast", "tray"],
  },
  {
    path: "/plans",
    title: "Wrapping station",
    who: "everyone signed in",
    canDo: [
      "Open the plan, then Wrapping, to wrap and count packs per recipe",
      "Make back labels at the bench (only the approved live label prints)",
      "Use the reject rack to record wonkies and dog bins",
      "See how much topping goes on one pack",
      "Cinnamon buns can skip the ovens and go to the freezer route, with Shopify stock added per wrap",
    ],
    keywords: ["wrapping", "wrap", "wrapped", "back label", "label", "reject rack", "shrink wrap", "topping", "freezer", "buns"],
  },
  {
    path: "/plans",
    title: "Packing station",
    who: "everyone signed in",
    canDo: [
      "Open the plan, then Packing, to see today's dispatch quantities against fridge stock",
      "Yellow means today's production is needed to cover it; red means it cannot be covered even after production",
      "Print five-pack labels and despatch labels from the packing screen",
      "See the packing shelf-life batch check and the desserts report",
    ],
    keywords: ["packing", "pack", "fridge stock", "shortfall", "five pack", "5-pack", "despatch label", "dispatch label", "desserts", "shelf life"],
  },
  {
    path: "/plans",
    title: "Macaroni Cheese and Fried Chicken stations",
    who: "everyone signed in",
    canDo: [
      "Open the plan, then Mac Cheese, to work the macaroni cheese line on its own station with its own stock figure",
      "Open Fried Chicken to use the count sheet; what you count there is what goes to Shopify at the end of the day",
    ],
    keywords: ["mac cheese", "macaroni", "mac and cheese", "fried chicken", "chicken", "korean", "buttermilk", "count sheet"],
  },
  {
    path: "/",
    title: "Opening, cleaning and closing checklists",
    who: "everyone signed in",
    canDo: [
      "Open any station and switch to Checklist to see Opening Checks, Cleaning Checks and Closing Checks",
      "Tick items, enter temperature or other readings where asked, and open the SOP link on an item",
      "Add a checklist item with the Smart add box if you have permission",
    ],
    keywords: ["checklist", "checklists", "opening checks", "closing checks", "cleaning", "tick", "readings", "temperature check", "daily checks"],
  },
  {
    path: "/plans",
    title: "Stock checks at stations",
    who: "everyone signed in; the expected figure is never shown (blind counts)",
    canDo: [
      "Open a station that has a stock check (such as the Stock Check tab at Raw Meat prep) and enter what you count",
      "A Stock check required pop-up appears when a count is due",
    ],
    keywords: ["stock check", "count", "counting", "blind count", "forced stock check", "daily check", "stock take"],
  },
  {
    path: "/plans",
    title: "Breaks and lunches",
    who: "everyone signed in",
    canDo: [
      "Start and end a break from the break tracker in the station top bar",
      "Add an optional Anything to note? on the break",
    ],
    keywords: ["break", "breaks", "lunch", "tea break", "rest", "timer"],
  },
  {
    path: "/",
    title: "Station messages",
    who: "everyone signed in",
    canDo: [
      "Tap Messages in a station top bar (or the Messages button elsewhere) to read chats",
      "Send to one person or choose Everyone for an announcement to the whole team",
      "Add a photo or video, reply to a message, or delete your own",
      "A message sent to a station shows as a banner there until someone taps Got it",
    ],
    keywords: ["message", "messages", "chat", "tell everyone", "announce", "announcement", "note to station", "banner", "got it", "dm"],
  },
  {
    path: "/meeting",
    title: "Morning Meeting",
    who: "everyone signed in",
    canDo: [
      "Run the morning meeting as a full-screen slideshow (also reachable from Today's Admin on the Dashboard)",
      "Includes yesterday's numbers, the order of production slide and the 10-minute Two Second Lean",
    ],
    keywords: ["meeting", "morning meeting", "slides", "slideshow", "huddle", "two second lean", "tv"],
  },
  {
    path: "/end-of-day",
    title: "End-of-day meeting",
    who: "everyone signed in",
    canDo: [
      "Review today's builder, packing and wonky numbers on one bare, big-number screen",
    ],
    keywords: ["end of day", "end-of-day", "closing meeting", "today's numbers", "wonky", "how did today go"],
  },
  {
    path: "/pack-report",
    title: "Pack Report",
    who: "everyone signed in",
    canDo: [
      "See per recipe what is in the fridge against what the next dispatch needs (red is short, amber is tight)",
      "Switch between actual and predicted stock",
      "Open it from the Factory Number tile or Today's Admin without starting a meeting",
    ],
    keywords: ["pack report", "short", "shortage", "fridge", "what's in the fridge", "next dispatch", "order of production", "factory number"],
  },
  {
    path: "/short-on-the-pack",
    title: "Short on the pack",
    who: "everyone can view; managers and admins can message everyone",
    canDo: [
      "See what is short for the next pack day and a suggested order of production",
      "Tap Use this order to apply it to the plan (asks you to confirm first)",
      "Send a pre-written message to everyone, editable, after a confirm",
    ],
    keywords: ["short on the pack", "reorder production", "change order of production", "move around production", "shortage", "veg before meat"],
  },

  // ── Reporting things ───────────────────────────────────────────────────
  {
    path: "/",
    title: "Quick actions panel",
    who: "everyone signed in (accident / incident is for managers and admins)",
    canDo: [
      "Swipe left from the right edge of the screen, or tap the Quick actions tab, to open it",
      "Choose My to-dos, Improvement, Report issue, Report defect / waste, Add to Wish List, Pull kanban or Ask AI Jane",
      "Managers and admins also get Report accident / incident",
    ],
    keywords: ["quick actions", "swipe", "report button", "floating button", "side panel", "shortcut", "menu on right"],
  },
  {
    path: "/improvements",
    title: "Improvements",
    who: "everyone logs and shares; managers approve",
    canDo: [
      "Tap Log an improvement, add a Before photo or video, and say what it is and who did it",
      "Later add the After photo with Done it? Add the after photo",
      "Choose I've done it or It needs doing for an idea or a problem",
      "A manager checks and approves it; add comments in the thread",
      "Dictate your idea with the dictate button and have it tidied",
    ],
    keywords: ["improvement", "improvements", "idea", "suggestion", "before and after", "photo", "kaizen", "lean", "quick idea", "better way"],
  },
  {
    path: "/reports?tab=issues",
    title: "Report an issue / Issue Log",
    who: "everyone can report and see the Issue Log; managers and admins see the rest of Analytics",
    canDo: [
      "Tap Report issue in Quick actions for something wrong or unsafe, and attach a photo",
      "Open Issue Log to see issues that have been reported",
      "Reports on a station also show a badge on that station",
    ],
    keywords: ["issue", "issues", "problem", "broken", "unsafe", "fault", "report a problem", "issue log", "something's wrong", "bug"],
  },
  {
    path: "/analytics/defects",
    title: "Report defect / waste",
    who: "anyone can report from Quick actions; managers and admins see the Defects & waste page",
    canDo: [
      "Tap Report defect / waste in Quick actions for a mislabel, wrong item, damaged pack, binned ingredient or anything thrown away",
      "On Defects & waste see defect packs as a share of packs made, and the waste in pounds for today, this week, this month or any range",
    ],
    keywords: ["defect", "defects", "waste", "binned", "bin", "thrown away", "mislabel", "damaged", "wonky", "dog bin", "left out"],
  },
  {
    path: "/reports?tab=incidents",
    title: "Accidents and incidents diary",
    who: "managers and admins report; the diary is under Analytics",
    canDo: [
      "Tap Report accident / incident in Quick actions and choose whether it is an accident or an incident",
      "Add photos or video and sign it in the app",
      "Review the Accidents & Incidents tab in Analytics",
    ],
    keywords: ["accident", "incident", "injury", "hurt", "cut", "first aid", "diary", "near miss", "riddor"],
  },
  {
    path: "/visitor-check-in",
    title: "Visitor check-in",
    who: "visitors sign in on the kiosk; the Visitor Book log is in Analytics",
    canDo: [
      "Hand the iPad to a visitor: they enter name, company, who they are seeing and why, then answer the food-safety declarations",
      "A visitor who reports sickness is refused entry on screen",
      "Staff can see the Visitor Book tab under Analytics",
    ],
    keywords: ["visitor", "visitors", "sign in", "check in", "visitor book", "contractor", "guest", "kiosk"],
  },
  {
    path: "/wish-list",
    title: "Wish List (equipment and things we need)",
    who: "everyone can add and vote; founder and admins approve",
    canDo: [
      "Tap Add something, or Add to Wish List in Quick actions, and paste a link to ask for kit",
      "Plus-one anything once a day so the biggest pain point rises to the top",
      "Sort by votes, newest, oldest or price; filter by status; search",
      "Open the comments on an item; admins can Approve, Mark ordered, Mark received or Decline",
    ],
    keywords: ["wish list", "wishlist", "equipment", "kit", "need", "request", "buy", "ask for", "vote", "tools we need"],
  },
  {
    path: "/",
    title: "My to-dos",
    who: "everyone signed in",
    canDo: [
      "Open My to-dos from Quick actions or the Employee Hub",
      "It opens in a panel beside whatever page you're on (full screen on a phone and on stations) and stays open as you move round the app; Switch list swaps it for a team list, Full view makes it full screen",
      "Add your own tasks, and see a to-do takeover at the 8am review",
      "Use the smart add box to type a task in plain words",
    ],
    keywords: ["to-do", "todo", "to do", "task", "tasks", "reminder", "my list", "smart add"],
  },
  {
    path: "/lists",
    title: "Team lists",
    who: "admins, plus anyone ticked on that list; managers and admins with access can change a list",
    canDo: [
      "Open a shared recurring routine that belongs to a role (for example the Production Planner's daily list) and tick it as yourself when covering",
      "Reach it from the Dashboard Team lists card, Quick actions or My to-dos",
      "Not shown on station screens",
    ],
    keywords: ["team list", "team lists", "routine", "role list", "cover", "daily list", "weekly list", "shared checklist", "planner's list"],
  },

  // ── Stock, orders, deliveries ──────────────────────────────────────────
  {
    path: "/stock-control",
    title: "Stock Control",
    who: "everyone signed in can view and count; check the page for editing limits",
    canDo: [
      "See stock by location (fridge, freezer, ambient) for recipes and ingredients",
      "Tap Add Stock Entry and choose Recipe or Ingredient",
      "Expand a row to see its adjustment history",
      "Count 8-pack bags in the production fridge on their own row, separate from 2-packs",
      "Add or edit storage locations",
    ],
    keywords: ["stock", "stock control", "inventory count", "fridge stock", "freezer stock", "add stock", "adjust stock", "how many", "locations", "8-pack", "bags", "use by"],
  },
  {
    path: "/stock",
    title: "Stock Inventory (stock check log)",
    who: "everyone signed in",
    canDo: [
      "Choose an item, enter a quantity and storage location, and tap Log Stock Check",
      "Use Save All to save several counts together",
      "See when each item was Last Checked",
    ],
    keywords: ["stock check", "log stock", "count stock", "stock take", "last checked", "stocktake"],
  },
  {
    path: "/stock-accuracy",
    title: "Stock accuracy",
    who: "managers and admins",
    canDo: [
      "See expected stock (last count plus deliveries minus usage) against recent counts",
      "Spot big or repeated gaps: waste, miscounts or usage the app does not see",
    ],
    keywords: ["stock accuracy", "expected stock", "running stock", "discrepancy", "gap", "miscount", "variance"],
  },
  {
    path: "/orders",
    title: "Orders (supplier ordering)",
    who: "everyone signed in can view; managers and admins place and manage orders",
    canDo: [
      "See Items to order for a plan with Required, Surplus, In Stock and Quantity, grouped under Suppliers to order from",
      "Show stocked items to see ones that do not need ordering",
      "Add supplier order for a one-off, or Add to an existing order or Start a separate order",
      "Confirm Order Placement, and see what is Already on order",
      "Scanning a kanban card queues that item for today's order",
    ],
    keywords: ["order", "orders", "ordering", "purchase order", "po", "supplier order", "what to order", "shopping list", "reorder", "order list", "buy ingredients"],
  },
  {
    path: "/plans/queued",
    title: "Queued test production",
    who: "everyone signed in; planner screen",
    canDo: [
      "Decide batches for a future production date before the plan exists",
      "See which ingredients need ordering and raise the purchase orders early",
      "Batches are suggested from the delivery's sales; queued rows land on the plan when it is created",
    ],
    keywords: ["queued", "test production", "test box", "future production", "early order", "plan ahead", "advance order"],
  },
  {
    path: "/deliveries",
    title: "Deliveries and goods in",
    who: "everyone signed in to receive; managers and admins edit orders",
    canDo: [
      "See what is Expected for a day and tick off what has arrived",
      "Record Received quantities against Ordered, and add Delivery Notes",
      "Report a damaged or short line with photos; one email goes to the supplier's account manager",
      "Check minimum shelf life on receipt",
      "Receive an unexpected delivery by searching items and matching open orders",
      "Collections and visitor check-in are reached from the same Front Door card on the Dashboard",
    ],
    keywords: ["delivery", "deliveries", "goods in", "goods-in", "receive", "receiving", "front door", "damaged", "short", "delivery note", "supplier delivery", "unexpected delivery", "collection", "shelf life"],
  },
  {
    path: "/suppliers",
    title: "Suppliers",
    who: "everyone can view; managers and admins edit",
    canDo: [
      "See each supplier's lead time, order days and order cut-off time",
      "Open New Supplier or Edit Supplier to change details, account number and account manager",
    ],
    keywords: ["supplier", "suppliers", "lead time", "cut-off", "cutoff", "order days", "account manager", "vendor"],
  },
  {
    path: "/contacts",
    title: "Contacts",
    who: "everyone can view; managers and admins add and edit",
    canDo: [
      "Find emergency contacts, carriers, service engineers and supplier details with tap-to-call",
      "A contact can be shown on chosen stations as a pinned chip",
      "Tap Add contact to create one",
    ],
    keywords: ["contact", "contacts", "phone number", "number", "call", "engineer", "emergency", "carrier", "who to ring"],
  },
  {
    path: "/inventory?tab=ingredients",
    title: "Ingredients",
    who: "everyone can view; managers and admins add, import and delete",
    canDo: [
      "Search and filter ingredients by category, usage (used in recipes or not) and NOVA / UPF",
      "See cost per kg and per pack, supplier, pack size and pallet size",
      "Import ingredients from CSV and set kanban details on an ingredient (managers and admins)",
      "Open an ingredient to see where it is used",
    ],
    keywords: ["ingredient", "ingredients", "cost", "pack size", "allergen", "upf", "nova", "kanban", "import", "csv", "pallet", "price per kg"],
  },
  {
    path: "/inventory?tab=supplies",
    title: "Supplies",
    who: "everyone can view; managers and admins edit",
    canDo: [
      "Keep non-food supplies (packaging and similar) in a list of their own on the Supplies tab of Inventory",
    ],
    keywords: ["supplies", "packaging", "boxes", "non-food", "consumables", "ice packs"],
  },
  {
    path: "/inventory/tools",
    title: "Inventory tools",
    who: "everyone signed in",
    canDo: [
      "Open Label Stock Check, Label Printer or Barcodes from the tools page",
    ],
    keywords: ["tools", "label tools", "inventory tools"],
  },
  {
    path: "/inventory/tools/label-stock-check",
    title: "Label Stock Check",
    who: "everyone signed in",
    canDo: [
      "Enter the number of rolls and total weight per recipe and see how many labels are left",
      "See the suggested Order qty for each recipe's label",
      "Change the empty-roll weight, label weight and default order quantity",
    ],
    keywords: ["label stock", "label rolls", "roll", "label order", "how many labels", "running out of labels", "order labels"],
  },
  {
    path: "/inventory/tools/label-printer",
    title: "Label printer setup and test",
    who: "everyone signed in",
    canDo: [
      "Check whether the print bridge on the factory PC is online",
      "Pick the fitted printer (TSC or Zebra) and fire a test label",
      "See recent print jobs, which is the label audit trail",
    ],
    keywords: ["label printer", "printer", "zebra", "tsc", "print bridge", "test label", "not printing", "print job", "print queue"],
  },
  {
    path: "/locations",
    title: "Bin Locations (fridge map)",
    who: "admins by default (the page access level can be changed); also by individual grant",
    canDo: [
      "See the unit drawn as fridge and freezer doors with shelves A to E",
      "Drag a product chip onto a shelf; the card order sets the pick walk on Order Packing Live",
      "Re-file old free-text locations from the needs re-filing tray",
    ],
    keywords: ["bin", "bin locations", "fridge map", "shelf", "where is", "pick order", "door", "freezer door", "location of"],
  },
  {
    path: "/barcodes",
    title: "Barcodes",
    who: "everyone signed in can view; admins run the Shopify sync",
    canDo: [
      "See every recipe's barcodes in one place and where they disagree with Shopify",
      "See products that share a code and refused packing scans",
      "Admins preview and send barcodes to Shopify, and pull from Shopify with a dry run",
    ],
    keywords: ["barcode", "barcodes", "ean", "scan code", "refused scan", "shopify barcode", "gtin"],
  },
  {
    path: "/",
    title: "Pull a kanban",
    who: "everyone signed in",
    canDo: [
      "Tap Pull kanban in Quick actions, scan the card or pick the item, then confirm",
      "Scanning a kanban QR with a phone camera opens a page that asks before anything is ordered",
      "Nothing is ordered until you confirm",
    ],
    keywords: ["kanban", "pull kanban", "reorder card", "scan card", "qr", "running low", "need more"],
  },

  // ── Dispatch and packing orders ────────────────────────────────────────
  {
    path: "/dispatches",
    title: "Dispatches",
    who: "everyone can view",
    canDo: [
      "See the Dispatch Schedule with This Week, Upcoming, Packed and Remaining",
      "Look up orders by date tag and delivery date",
      "Check postcodes that the courier cannot serve",
      "See Session history",
    ],
    keywords: ["dispatch", "dispatches", "despatch", "delivery date", "date tag", "what's going out", "postcode", "week", "schedule"],
  },
  {
    path: "/fulfilment",
    title: "Order Packing Live",
    who: "managers and admins by default; others can be granted it; tagging and booking labels are separate grants",
    canDo: [
      "Pick and pack the day's orders, with wave filters and box-size tabs",
      "Scan the APC label first to verify it, then complete the order (label-scan mode)",
      "Tag orders for dispatch, book APC labels and reschedule orders (needs the matching grant)",
      "Add an extra box to an order; see fridge stock and where each product lives",
      "Check printer setup for kiosk printing",
      "Orders on a chargeback hold are hidden from packing",
    ],
    keywords: ["order packing", "packing live", "fulfilment", "fulfillment", "pack orders", "apc", "label", "courier", "consignment", "tracking", "book", "reschedule", "box size", "scan label", "wave", "customer order", "pick"],
  },
  {
    path: "/fulfilment/apc-check",
    title: "APC consignment check",
    who: "courier managers (managers and admins with Order Packing Live access)",
    canDo: [
      "See orders that went out on an old or cancelled APC booking",
    ],
    keywords: ["apc check", "cancelled booking", "wrong waybill", "consignment check", "courier problem", "dead consignment"],
  },
  {
    path: "/case-orders",
    title: "Case Orders",
    who: "everyone can view",
    canDo: [
      "Create a New case order for a bulk frozen 8-pack bag order",
      "See how many bags each recipe needs, how many are in the freezer and how many to make today",
      "Get a suggested spread across days respecting the daily batch limit, edit it, then apply it",
    ],
    keywords: ["case order", "case orders", "bulk", "wholesale", "8-pack", "bags", "frozen", "waterdean", "cases", "freezer bags"],
  },

  // ── Recipes, labels, products ──────────────────────────────────────────
  {
    path: "/recipes",
    title: "Recipes",
    who: "everyone can view; managers and admins edit",
    canDo: [
      "Browse recipes in Drafts, On the menu and Archived",
      "See costings: raw material cost, pack cost, gross profit, weights, allergens, nutrition and ingredient deck",
      "Open a recipe to edit ingredient lines, build time and Shopify listing fields (managers and admins)",
      "Create a draft recipe, or create the Shopify product from the recipe",
    ],
    keywords: ["recipe", "recipes", "costing", "cost", "margin", "profit", "allergen", "nutrition", "draft recipe", "archive", "menu", "new recipe", "build time", "ingredient deck"],
  },
  {
    path: "/sub-recipes",
    title: "Sub-Recipes",
    who: "everyone can view; managers and admins edit",
    canDo: [
      "See bases, sauces, marinades and rubs with their mix scale, yield, and cost summary",
      "Print a prep label from the sub-recipe where the print button shows",
      "Open one to see its yield analysis",
    ],
    keywords: ["sub-recipe", "sub recipe", "sub-recipes", "base", "sauce", "marinade", "rub", "mix", "yield", "batch of sauce"],
  },
  {
    path: "/labels",
    title: "Product Labels",
    who: "everyone can view; managers and admins edit; ingredient decks, nutrition and Data health follow the Product Labels page access level",
    canDo: [
      "Open a product's label page, and filter by Update needed, Doesn't fit, Never published, Live & up to date or Draft recipes",
      "Edit front and back labels, the ingredient deck, nutrition, may-contain and cooking instructions",
      "Use the Data health tab to find gaps",
      "Publish a label and see its history",
    ],
    keywords: ["label", "labels", "product label", "pack label", "front label", "back label", "ingredients list", "nutrition", "may contain", "cooking instructions", "data health", "publish"],
  },

  // ── Analytics ──────────────────────────────────────────────────────────
  {
    path: "/reports",
    title: "Analytics and reports",
    who: "managers and admins see everything; everyone else sees the Issue Log only",
    canDo: [
      "Use tabs: Production KPIs, Breaks & Lunches, HACCP, Documents, Improvements, Issue Log, Leftover Filling, Printables",
      "HACCP tabs include Evidence Log, Temperature Log, Cooling & Weights, Readings & Cook-Chill, Sensor History, Visitor Book and Accidents & Incidents",
      "Pick a date range such as Today, Yesterday, This Week or Last Month",
    ],
    keywords: ["report", "reports", "analytics", "kpi", "haccp", "temperature log", "sensor", "fridge temperature", "cooling", "breaks", "leftover", "printables", "evidence", "audit"],
  },
  {
    path: "/analytics/efficiency",
    title: "Team efficiency",
    who: "managers and admins",
    canDo: [
      "See one efficiency percentage against standard for the team",
    ],
    keywords: ["efficiency", "team efficiency", "productivity", "run rate", "performance", "standard"],
  },
  {
    path: "/test-requests",
    title: "Test requests",
    who: "managers and admins",
    canDo: [
      "See every change someone was asked to test, who was asked and what they said",
      "Tap Request a test to ask for a test of a specific fix or improvement",
    ],
    keywords: ["test request", "test requests", "please test", "try this", "check this fix", "testing"],
  },

  // ── Learning, SOPs, documents ──────────────────────────────────────────
  {
    path: "/training",
    title: "Training",
    who: "everyone sees station SOP matrices; onboarding sign-off matrices are for managers",
    canDo: [
      "See the station SOP training matrix and who is signed off on what",
      "Managers add training items and people to a matrix and sign them off",
      "Read and confirm a document from a training item with the I've read and understood flow",
    ],
    keywords: ["training", "matrix", "signed off", "trained", "competence", "induction", "onboarding", "sop training", "who is trained"],
  },
  {
    path: "/hub",
    title: "Employee Hub (your own area)",
    who: "everyone signed in, for their own record only",
    canDo: [
      "Tabs: My To-dos, My Record, My Contract, My Documents, Starter Forms, Mileage Claim, Expense Claim, Policies, My Improvements, My Issues, My SOPs",
      "Read and accept policies under Policies",
      "Sign your contract and starter forms in the app",
      "Find the SOPs you need to read under My SOPs",
    ],
    keywords: ["hub", "employee hub", "my record", "my contract", "policy", "policies", "starter forms", "mileage", "expenses", "expense claim", "my sops", "sign", "read and understood", "handbook"],
  },
  {
    path: "/settings?tab=profile",
    title: "My Profile, PIN and account",
    who: "everyone signed in",
    canDo: [
      "Change your name, photo and password under My Profile",
      "Set or change your station PIN under the PIN tab",
      "Add your emergency contact from the account menu",
    ],
    keywords: ["profile", "password", "pin", "photo", "avatar", "emergency contact", "change password", "my account", "forgot pin", "reset"],
  },
  {
    path: "/reports?tab=risk-assessments",
    title: "Documents and policies (SOPs, risk assessments)",
    who: "everyone can read; linked from wherever a document is named",
    canDo: [
      "Anything the app names (an SOP, policy or document) is a link: tap its label to read it in the app",
      "Open the Documents tab in Analytics to browse the repository",
      "Tap Show me how on a page, or the SOP chips on a station row, to see the steps",
      "Attach an SOP to a page with Add an SOP to this page, or to a station from the Station menu",
    ],
    keywords: ["document", "documents", "sop", "sops", "policy", "risk assessment", "procedure", "how to", "show me how", "instructions", "standard operating procedure"],
  },
  {
    path: "/lean-cave",
    title: "Lean Cave",
    who: "everyone signed in",
    canDo: [
      "Tabs: SOPs, Lean Learning, Improvements and Struggles",
      "Read the Lean lessons and find the SOP library",
    ],
    keywords: ["lean", "lean cave", "lean learning", "struggles", "lessons", "curriculum", "kaizen"],
  },
  {
    path: "/lean-start",
    title: "Self-paced Lean course",
    who: "everyone signed in",
    canDo: [
      "Work through the Lean curriculum at your own pace; completions count as real sign-offs",
    ],
    keywords: ["lean course", "lean start", "lean training", "catch up", "curriculum", "new starter lessons"],
  },
  {
    path: "/lean-review",
    title: "Weekly Lean review",
    who: "everyone signed in",
    canDo: [
      "Run the weekly Lean review cycle for the team",
    ],
    keywords: ["weekly review", "lean review", "review cycle", "weekly lean"],
  },

  // ── Assistant, settings visible to many ────────────────────────────────
  {
    path: "/",
    title: "Ask AI Jane",
    who: "everyone signed in",
    canDo: [
      "Tap Ask AI Jane in Quick actions to ask how something works",
      "Ask where a feature lives before reporting it as missing",
    ],
    keywords: ["jane", "ask jane", "assistant", "help", "chat", "ai", "how do i", "where is"],
  },
  {
    path: "/settings",
    title: "Settings",
    who: "everyone sees My Profile; the other tabs are for admins (individuals can be granted single tabs)",
    canDo: [
      "Admins use tabs: Team & Access, Production, Packing, Storage & Inventory, Standards & SOPs, Temperature Sensors, Features",
      "Admins set who can open each page under Team & Access, and hand out single abilities to one person",
    ],
    keywords: ["settings", "admin", "access", "permissions", "who can see", "can't see page", "roles", "grant", "feature flag", "sensors", "govee"],
  },
];

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "could", "do", "does", "for", "from",
  "get", "has", "have", "how", "i", "if", "in", "into", "is", "it", "its", "me", "my", "need", "of",
  "on", "or", "our", "should", "so", "that", "the", "their", "there", "this", "to", "up", "us", "want",
  "was", "we", "what", "when", "where", "which", "who", "will", "with", "would", "you", "your",
  "app", "please", "way", "able", "just", "like", "add", "make",
]);

/** Lowercase, split to words, drop stop words, and fold a plural "s" away. */
function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || STOP_WORDS.has(raw)) continue;
    out.push(raw.length > 3 && raw.endsWith("s") ? raw.slice(0, -1) : raw);
  }
  return out;
}

const TITLE_WEIGHT = 3;
const KEYWORD_WEIGHT = 3;
const CAN_DO_WEIGHT = 1;

interface Indexed {
  entry: AppGuideEntry;
  title: Set<string>;
  keywords: Set<string>;
  canDo: Set<string>;
}

let index: Indexed[] | null = null;

function getIndex(): Indexed[] {
  if (!index) {
    index = APP_GUIDE.map(entry => ({
      entry,
      title: new Set(tokens(entry.title)),
      keywords: new Set(entry.keywords.flatMap(tokens)),
      canDo: new Set(entry.canDo.flatMap(tokens)),
    }));
  }
  return index;
}

/**
 * Best-matching guide entries for a free-text request, best first.
 * Pure: lowercase word overlap, title and keyword hits weigh more than
 * canDo hits. Returns an empty array when nothing matches.
 */
export function searchAppGuide(query: string, limit = 6): AppGuideEntry[] {
  const words = [...new Set(tokens(query))];
  if (words.length === 0 || limit <= 0) return [];
  const scored: Array<{ entry: AppGuideEntry; score: number; order: number }> = [];
  getIndex().forEach((item, order) => {
    let score = 0;
    for (const w of words) {
      if (item.title.has(w)) score += TITLE_WEIGHT;
      if (item.keywords.has(w)) score += KEYWORD_WEIGHT;
      if (item.canDo.has(w)) score += CAN_DO_WEIGHT;
    }
    if (score > 0) scored.push({ entry: item.entry, score, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.slice(0, limit).map(s => s.entry);
}
