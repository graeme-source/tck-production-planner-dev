import { Router, type IRouter } from "express";
import { allowedFeatureKeys } from "../lib/feature-access";
import { db, usersTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { validatePassword } from "../lib/password-policy";
import multer from "multer";
import { hasPeopleAccessOrFalse, peopleGateFacts } from "../lib/people-access";
import { canClearPrivatePin } from "../lib/people-access-rules";
import {
  peoplePinHashFor, pinClashes, PRIVATE_PIN_REQUIRED_CODE,
  PRIVATE_PIN_SAME_AS_STATION, STATION_PIN_SAME_AS_PRIVATE,
} from "../lib/people-unlock";

const router: IRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, please try again in 10 minutes." },
  skipSuccessfulRequests: true,
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const FOUNDER_EMAIL = "graeme@thecalzonekitchen.co.uk";
const PASSWORD_RESET_GRACE_MS = 24 * 60 * 60 * 1000;

// Forced-reset deadline, stamped lazily: the 24h clock starts the first time
// the user authenticates after the policy ships (fresh login, PIN login, or an
// already-signed-in session's /me check) — i.e. the first time they can see
// the warning banner. Someone who first works Wednesday gets the same full
// 24 hours as someone who logged in Monday. Users who have already set a
// policy-compliant password (passwordChangedAt) are done; the founder is
// exempt. Returns the deadline to expose to the client, or null.
async function ensurePasswordResetDeadline(
  user: typeof usersTable.$inferSelect,
): Promise<Date | null> {
  if (user.email === FOUNDER_EMAIL) return null;
  if (user.passwordResetDeadline) return user.passwordResetDeadline;
  if (user.passwordChangedAt) return null;
  const deadline = new Date(Date.now() + PASSWORD_RESET_GRACE_MS);
  await db
    .update(usersTable)
    .set({ passwordResetDeadline: deadline })
    .where(eq(usersTable.id, user.id));
  return deadline;
}

// Returns true if the session needs PIN re-verification.
// PIN lock resets at 4am UTC (morning shift start) and 10pm UK time (evening shift end).
// Uses Europe/London timezone for the 10pm reset to handle BST/GMT automatically.
function isPinRequired(pinVerifiedAt: string | undefined): boolean {
  if (!pinVerifiedAt) return true;

  const verified = new Date(pinVerifiedAt);
  const now = new Date();

  // Calculate reset times and find the most recent one
  const resets: Date[] = [];

  // Reset 1: 4am UTC (always UTC, doesn't shift with BST)
  const morning = new Date();
  morning.setUTCHours(4, 0, 0, 0);
  if (now.getTime() < morning.getTime()) {
    morning.setUTCDate(morning.getUTCDate() - 1);
  }
  resets.push(morning);

  // Reset 2: 10pm UK time (Europe/London — automatically handles BST/GMT)
  // 10pm GMT = 22:00 UTC in winter, 10pm BST = 21:00 UTC in summer
  const evening = new Date();
  // Work out 10pm UK in UTC: subtract the UK offset
  const ukOffsetMs = getUKOffsetMs(now);
  evening.setTime(now.getTime());
  evening.setUTCHours(0, 0, 0, 0);
  evening.setTime(evening.getTime() + 22 * 60 * 60 * 1000 - ukOffsetMs); // 22:00 UK → UTC
  if (now.getTime() < evening.getTime()) {
    evening.setUTCDate(evening.getUTCDate() - 1);
  }
  resets.push(evening);

  // The most recent reset is the one we check against
  const latestReset = resets.reduce((a, b) => (a.getTime() > b.getTime() ? a : b));

  return verified.getTime() < latestReset.getTime();
}

/** Get the UK timezone offset in milliseconds (0 in winter, +3600000 in BST) */
function getUKOffsetMs(date: Date): number {
  const utcStr = date.toLocaleString("en-GB", { timeZone: "UTC" });
  const ukStr = date.toLocaleString("en-GB", { timeZone: "Europe/London" });
  const utcDate = new Date(utcStr.split(",").reverse().join(" "));
  const ukDate = new Date(ukStr.split(",").reverse().join(" "));
  return ukDate.getTime() - utcDate.getTime();
}

router.post("/login", loginLimiter, validate(LoginBody), async (req, res) => {
  const { email, password } = req.body as z.infer<typeof LoginBody>;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()));

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const resetDeadline = await ensurePasswordResetDeadline(user);

  req.session.userId = user.id;
  req.session.userRole = user.role as "admin" | "manager" | "viewer";
  req.session.pinVerifiedAt = new Date().toISOString();
  // A fresh sign-in never inherits an earlier People unlock on this browser.
  delete req.session.peopleUnlockedAt;
  const features = await allowedFeatureKeys(user.id);
  const hasPeopleAccess = await hasPeopleAccessOrFalse(user.id, "login");
  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      res.status(500).json({ error: "Failed to create session" });
      return;
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl ?? null,
      hasPin: !!user.pinHash,
      hasPrivatePin: !!user.privatePinHash,
      hasPeopleAccess,
      isProductionPlanner: user.isProductionPlanner ?? false,
      isBookkeeper: user.isBookkeeper ?? false,
      features,
      onboardingRequired: user.onboardingRequired ?? false,
      onboardingCompletedAt: user.onboardingCompletedAt ? user.onboardingCompletedAt.toISOString() : null,
      passwordResetDeadline: resetDeadline ? resetDeadline.toISOString() : null,
    });
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

router.get("/me", async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId));

  if (!user || !user.isActive) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const pinRequired = isPinRequired(req.session.pinVerifiedAt);
  const resetDeadline = await ensurePasswordResetDeadline(user);

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl ?? null,
    hasPin: !!user.pinHash,
    hasPrivatePin: !!user.privatePinHash,
    // People access: the founder's per-person switch (lib/people-access.ts).
    // Drives the People nav and the "set your private PIN" prompt; the
    // server enforces it on every People request regardless.
    hasPeopleAccess: await hasPeopleAccessOrFalse(user.id, "/auth/me"),
    isProductionPlanner: user.isProductionPlanner ?? false,
    isBookkeeper: user.isBookkeeper ?? false,
    features: await allowedFeatureKeys(user.id),
    pinRequired,
    onboardingRequired: user.onboardingRequired ?? false,
    onboardingCompletedAt: user.onboardingCompletedAt ? user.onboardingCompletedAt.toISOString() : null,
    passwordResetDeadline: resetDeadline ? resetDeadline.toISOString() : null,
  });
});

const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

// In-app password change — used by the forced-reset banner/blocker and
// available any time from the profile. Requires the current password, applies
// the password policy, and clears any pending forced-reset deadline.
router.post("/password/change", loginLimiter, validate(ChangePasswordBody), async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const { currentPassword, newPassword } = req.body as z.infer<typeof ChangePasswordBody>;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId));

  if (!user || !user.isActive) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const policyError = validatePassword(newPassword);
  if (policyError) {
    res.status(400).json({ error: policyError });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db
    .update(usersTable)
    .set({
      passwordHash,
      passwordChangedAt: new Date(),
      passwordResetDeadline: null,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, user.id));

  res.json({ ok: true });
});

const PinSetBody = z.object({
  pin: z.string().length(4).regex(/^\d{4}$/, "PIN must be 4 digits"),
});

// Station-PIN changes are rare, so they're capped per person — every
// attempt counts, successful or not. Refusing a station PIN that equals the
// private People PIN (below) tells the caller "that's your private PIN"; the
// cap stops anyone at an unlocked iPad using that refusal to hunt for the
// private PIN by trying every 4-digit number.
const pinSetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `pin-set:${req.session.userId ?? "anon"}`,
  message: { error: "Too many PIN changes — try again in 15 minutes." },
});

router.post("/pin/set", pinSetLimiter, async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const parsed = PinSetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "PIN must be exactly 4 digits" });
    return;
  }

  const { pin } = parsed.data;

  // The station PIN and the private People PIN must never match — checked
  // here as well as when the private PIN is set (Graeme, 2026-09-25), so
  // neither can be changed into the other.
  const [current] = await db
    .select({ privatePinHash: usersTable.privatePinHash })
    .from(usersTable)
    .where(eq(usersTable.id, req.session.userId));
  if (await pinClashes(pin, current?.privatePinHash, bcrypt.compare)) {
    res.status(400).json({ error: STATION_PIN_SAME_AS_PRIVATE });
    return;
  }

  const pinHash = await bcrypt.hash(pin, 10);

  await db
    .update(usersTable)
    .set({ pinHash, pinAttempts: 0, pinLockedUntil: null })
    .where(eq(usersTable.id, req.session.userId));

  // Setting a new PIN counts as verification
  req.session.pinVerifiedAt = new Date().toISOString();
  await new Promise<void>((resolve) => req.session.save(() => resolve()));

  res.json({ ok: true });
});

const PinLoginBody = z.object({
  userId: z.number().int().positive(),
  pin: z.string().length(4).regex(/^\d{4}$/, "PIN must be 4 digits"),
});

const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000;

// Device picker PIN login — used when selecting a user from the device list.
router.post("/pin/login", loginLimiter, async (req, res) => {
  const parsed = PinLoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const { userId, pin } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user || !user.isActive) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  if (!user.pinHash) {
    res.status(400).json({ error: "No PIN set for this user" });
    return;
  }

  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    const remainingMs = user.pinLockedUntil.getTime() - Date.now();
    const remainingSec = Math.ceil(remainingMs / 1000);
    res.status(429).json({
      error: "Too many failed attempts. Try again later.",
      lockedUntil: user.pinLockedUntil.toISOString(),
      remainingSeconds: remainingSec,
    });
    return;
  }

  const valid = await bcrypt.compare(pin, user.pinHash);

  if (!valid) {
    const newAttempts = (user.pinAttempts ?? 0) + 1;
    const updates: Partial<typeof usersTable.$inferInsert> = { pinAttempts: newAttempts };

    if (newAttempts >= PIN_MAX_ATTEMPTS) {
      updates.pinLockedUntil = new Date(Date.now() + PIN_LOCKOUT_MS);
      updates.pinAttempts = 0;
    }

    await db.update(usersTable).set(updates).where(eq(usersTable.id, userId));

    const attemptsLeft = PIN_MAX_ATTEMPTS - newAttempts;
    if (attemptsLeft <= 0) {
      res.status(429).json({
        error: "Too many failed attempts. Account locked for 15 minutes.",
        lockedUntil: updates.pinLockedUntil?.toISOString(),
        remainingSeconds: Math.ceil(PIN_LOCKOUT_MS / 1000),
      });
    } else {
      res.status(401).json({
        error: `Incorrect PIN. ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} remaining.`,
        attemptsLeft,
      });
    }
    return;
  }

  await db
    .update(usersTable)
    .set({ pinAttempts: 0, pinLockedUntil: null })
    .where(eq(usersTable.id, userId));

  const resetDeadline = await ensurePasswordResetDeadline(user);
  const featuresForPinUnlock = await allowedFeatureKeys(user.id);
  const hasPeopleAccessForPinLogin = await hasPeopleAccessOrFalse(user.id, "pin/login");

  req.session.userId = user.id;
  req.session.userRole = user.role as "admin" | "manager" | "viewer";
  req.session.pinVerifiedAt = new Date().toISOString();
  // Station PCs are shared: switching person by PIN must never carry the
  // previous person's People unlock across to the next one.
  delete req.session.peopleUnlockedAt;
  req.session.save((err) => {
    if (err) {
      console.error("Session save error:", err);
      res.status(500).json({ error: "Failed to create session" });
      return;
    }
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl ?? null,
      hasPin: true,
      hasPrivatePin: !!user.privatePinHash,
      hasPeopleAccess: hasPeopleAccessForPinLogin,
      isProductionPlanner: user.isProductionPlanner ?? false,
      isBookkeeper: user.isBookkeeper ?? false,
      features: featuresForPinUnlock,
      onboardingRequired: user.onboardingRequired ?? false,
      onboardingCompletedAt: user.onboardingCompletedAt ? user.onboardingCompletedAt.toISOString() : null,
      passwordResetDeadline: resetDeadline ? resetDeadline.toISOString() : null,
    });
  });
});

// In-session PIN verification — used by the daily PIN lock overlay.
// The user is already authenticated; this just confirms their identity and
// stamps pinVerifiedAt so they won't be prompted again until the next reset
// (10pm UK evening lock or 4am UTC morning lock, whichever comes first).
router.post("/pin/verify", loginLimiter, async (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const parsed = PinSetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "PIN must be exactly 4 digits" });
    return;
  }

  const { pin } = parsed.data;
  const userId = req.session.userId;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user || !user.isActive) {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  if (!user.pinHash) {
    res.status(400).json({ error: "No PIN set for this user" });
    return;
  }

  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
    const remainingMs = user.pinLockedUntil.getTime() - Date.now();
    res.status(429).json({
      error: "Too many failed attempts. Try again later.",
      lockedUntil: user.pinLockedUntil.toISOString(),
      remainingSeconds: Math.ceil(remainingMs / 1000),
    });
    return;
  }

  const valid = await bcrypt.compare(pin, user.pinHash);

  if (!valid) {
    const newAttempts = (user.pinAttempts ?? 0) + 1;
    const updates: Partial<typeof usersTable.$inferInsert> = { pinAttempts: newAttempts };

    if (newAttempts >= PIN_MAX_ATTEMPTS) {
      updates.pinLockedUntil = new Date(Date.now() + PIN_LOCKOUT_MS);
      updates.pinAttempts = 0;
    }

    await db.update(usersTable).set(updates).where(eq(usersTable.id, userId));

    const attemptsLeft = PIN_MAX_ATTEMPTS - newAttempts;
    if (attemptsLeft <= 0) {
      res.status(429).json({
        error: "Too many failed attempts. Account locked for 15 minutes.",
        lockedUntil: updates.pinLockedUntil?.toISOString(),
        remainingSeconds: Math.ceil(PIN_LOCKOUT_MS / 1000),
      });
    } else {
      res.status(401).json({
        error: `Incorrect PIN. ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} remaining.`,
        attemptsLeft,
      });
    }
    return;
  }

  await db
    .update(usersTable)
    .set({ pinAttempts: 0, pinLockedUntil: null })
    .where(eq(usersTable.id, userId));

  req.session.pinVerifiedAt = new Date().toISOString();
  req.session.save((err) => {
    if (err) {
      res.status(500).json({ error: "Failed to save session" });
      return;
    }
    res.json({ ok: true });
  });
});

// ── People section private PIN (Graeme, 2026-09-24; compulsory 2026-09-25) ──
// A second PIN, used only by the People gate, so the PIN someone types in
// front of others at a station can't open employee records. COMPULSORY for
// anyone with People access: there is no falling back to the station PIN —
// with no private PIN set, People answers 428 "private_pin_required" and the
// app sends them to set one. Separate attempt counter + lockout from the
// station PIN. See lib/people-unlock.ts and middleware/people-unlock.ts.

const PeoplePinBody = z.object({ pin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits") });

router.post("/people-pin/verify", loginLimiter, validate(PeoplePinBody), async (req, res) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const { pin } = req.body as z.infer<typeof PeoplePinBody>;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || !user.isActive) { res.status(401).json({ error: "Not authenticated" }); return; }

  const { hasAccess } = await peopleGateFacts(userId);
  if (!hasAccess) { res.status(403).json({ error: "People access isn't switched on for your account" }); return; }

  // ONLY the private PIN — never the station PIN (regression-tested in
  // lib/people-unlock.test.ts, peoplePinHashFor).
  const hash = peoplePinHashFor(user);
  if (!hash) {
    res.status(428).json({ error: "Set your private PIN to open People", code: PRIVATE_PIN_REQUIRED_CODE });
    return;
  }
  const lockedUntil = user.privatePinLockedUntil;
  if (lockedUntil && lockedUntil > new Date()) {
    res.status(429).json({
      error: "Too many failed attempts. Try again in a few minutes.",
      lockedUntil: lockedUntil.toISOString(),
      remainingSeconds: Math.ceil((lockedUntil.getTime() - Date.now()) / 1000),
    });
    return;
  }

  if (!(await bcrypt.compare(pin, hash))) {
    const attempts = user.privatePinAttempts + 1;
    const lock = attempts >= PIN_MAX_ATTEMPTS ? new Date(Date.now() + PIN_LOCKOUT_MS) : null;
    await db.update(usersTable).set({ privatePinAttempts: attempts, privatePinLockedUntil: lock })
      .where(eq(usersTable.id, userId));
    const left = PIN_MAX_ATTEMPTS - attempts;
    if (left <= 0) {
      res.status(429).json({ error: "Too many failed attempts. Locked for 15 minutes.", lockedUntil: lock?.toISOString(), remainingSeconds: Math.ceil(PIN_LOCKOUT_MS / 1000) });
    } else {
      res.status(401).json({ error: `Incorrect PIN. ${left} attempt${left === 1 ? "" : "s"} remaining.`, attemptsLeft: left });
    }
    return;
  }

  await db.update(usersTable).set({ privatePinAttempts: 0, privatePinLockedUntil: null })
    .where(eq(usersTable.id, userId));
  req.session.peopleUnlockedAt = new Date().toISOString();
  req.session.save(err => {
    if (err) { res.status(500).json({ error: "Failed to save session" }); return; }
    res.json({ ok: true });
  });
});

const PrivatePinSetBody = z.object({
  currentPassword: z.string().min(1),
  pin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits"),
});

// Set or change the private PIN. Only for people with People access (it
// opens nothing else). Needs the account password, and must not be the same
// as the station PIN (that would defeat the point) — /pin/set checks the
// other direction.
router.post("/private-pin/set", loginLimiter, validate(PrivatePinSetBody), async (req, res) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const body = req.body as z.infer<typeof PrivatePinSetBody>;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!(await peopleGateFacts(userId)).hasAccess) {
    res.status(403).json({ error: "A private PIN is only for people with People access" }); return;
  }
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
    res.status(403).json({ error: "That password isn't right" }); return;
  }
  if (await pinClashes(body.pin, user.pinHash, bcrypt.compare)) {
    res.status(400).json({ error: PRIVATE_PIN_SAME_AS_STATION }); return;
  }
  await db.update(usersTable).set({
    privatePinHash: await bcrypt.hash(body.pin, 10),
    privatePinAttempts: 0,
    privatePinLockedUntil: null,
  }).where(eq(usersTable.id, userId));
  // A fresh private PIN re-locks People until it's used.
  delete req.session.peopleUnlockedAt;
  req.session.save(() => res.json({ ok: true, hasPrivatePin: true }));
});

const PrivatePinClearBody = z.object({ currentPassword: z.string().min(1) });

// Removing the private PIN is refused while you have People access — it's
// compulsory for you (lib/people-access-rules.ts, canClearPrivatePin). Once
// access is removed, an old private PIN can be tidied away.
router.post("/private-pin/clear", loginLimiter, validate(PrivatePinClearBody), async (req, res) => {
  const userId = req.session.userId;
  if (!userId) { res.status(401).json({ error: "Not authenticated" }); return; }
  const body = req.body as z.infer<typeof PrivatePinClearBody>;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  if (!canClearPrivatePin(await peopleGateFacts(userId))) {
    res.status(409).json({ error: "You have People access, so your private PIN can't be removed — you can change it instead." });
    return;
  }
  if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
    res.status(403).json({ error: "That password isn't right" }); return;
  }
  await db.update(usersTable).set({ privatePinHash: null, privatePinAttempts: 0, privatePinLockedUntil: null })
    .where(eq(usersTable.id, userId));
  res.json({ ok: true, hasPrivatePin: false });
});

// Manual PIN lock — clears pinVerifiedAt so the overlay appears on next render.
// Available to all authenticated users (e.g. "Lock station" button).
router.post("/pin/lock", (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  req.session.pinVerifiedAt = undefined;
  // Locking the station locks People too.
  delete req.session.peopleUnlockedAt;
  req.session.save((err) => {
    if (err) {
      res.status(500).json({ error: "Failed to lock session" });
      return;
    }
    res.json({ ok: true });
  });
});

router.get("/devices/users", async (req, res) => {
  const idsParam = req.query["ids[]"];
  if (!idsParam) {
    res.json([]);
    return;
  }

  const rawIds = Array.isArray(idsParam) ? idsParam : [idsParam];
  const ids = rawIds.map(Number).filter(n => !isNaN(n) && n > 0);

  if (ids.length === 0) {
    res.json([]);
    return;
  }

  const users = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      role: usersTable.role,
      avatarUrl: usersTable.avatarUrl,
      pinHash: usersTable.pinHash,
      isActive: usersTable.isActive,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, ids));

  const result = users
    .filter(u => u.isActive)
    .map(u => ({
      id: u.id,
      name: u.name,
      role: u.role,
      avatarUrl: u.avatarUrl ?? null,
      hasPin: !!u.pinHash,
    }));

  res.json(result);
});

router.post("/avatar", async (req, res, next) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}, upload.single("avatar"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const file = req.file;
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(file.mimetype)) {
    res.status(400).json({ error: "Invalid file type. Use JPEG, PNG, WebP, or GIF." });
    return;
  }

  try {
    const userId = req.session.userId!;
    // Store the image bytes inline on the user row — no object storage
    // dependency. avatar_url points at the streaming endpoint with a
    // cache-bust query param so <img> refreshes immediately on upload.
    await db.execute(sql`
      UPDATE app_users
      SET avatar_mime = ${file.mimetype},
          avatar_data = ${file.buffer},
          avatar_url = ${`/api/auth/avatar/${userId}?v=${Date.now()}`},
          updated_at = NOW()
      WHERE id = ${userId}
    `);

    const [row] = await db
      .select({ avatarUrl: usersTable.avatarUrl })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    res.json({ avatarUrl: row?.avatarUrl ?? null });
  } catch (err) {
    console.error("Avatar upload error:", err);
    res.status(500).json({ error: "Failed to upload avatar" });
  }
});

// Stream the avatar bytes for a user — referenced by the avatar_url column
// (/api/auth/avatar/:id?v=<ts>). Publicly readable to keep <img> loads on
// login-adjacent pages simple; the content is non-sensitive.
router.get("/avatar/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isFinite(userId)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const rows = await db.execute<{ avatar_mime: string | null; avatar_data: Buffer | null }>(sql`
    SELECT avatar_mime, avatar_data FROM app_users WHERE id = ${userId}
  `);
  const row = ((rows.rows ?? rows) as { avatar_mime: string | null; avatar_data: Buffer | null }[])[0];
  if (!row || !row.avatar_data || !row.avatar_mime) {
    res.status(404).json({ error: "No avatar" });
    return;
  }
  res.setHeader("Content-Type", row.avatar_mime);
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(row.avatar_data);
});

export default router;
