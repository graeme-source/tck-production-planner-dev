import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { validate } from "../middleware/validate";
import multer from "multer";
import { objectStorageClient } from "../lib/objectStorage";

const router: IRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, please try again in 15 minutes." },
  skipSuccessfulRequests: true,
});

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Returns true if the session needs PIN re-verification.
// PIN lock resets daily at 4am UTC. This maps to 4am GMT (winter) / 5am BST (summer),
// ensuring the reset always happens well before TCK's earliest shift start.
function isPinRequired(pinVerifiedAt: string | undefined): boolean {
  if (!pinVerifiedAt) return true;

  const verified = new Date(pinVerifiedAt);
  const now = new Date();

  // Most recent 4am UTC reset point
  const reset = new Date();
  reset.setUTCHours(4, 0, 0, 0);
  if (now.getTime() < reset.getTime()) {
    // Before today's 4am — use yesterday's 4am as the cutoff
    reset.setUTCDate(reset.getUTCDate() - 1);
  }

  return verified.getTime() < reset.getTime();
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

  req.session.userId = user.id;
  req.session.userRole = user.role as "admin" | "manager" | "viewer";
  req.session.pinVerifiedAt = new Date().toISOString();
  req.session.save((err) => {
    if (err) {
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

  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatarUrl: user.avatarUrl ?? null,
    hasPin: !!user.pinHash,
    pinRequired,
  });
});

const PinSetBody = z.object({
  pin: z.string().length(4).regex(/^\d{4}$/, "PIN must be 4 digits"),
});

router.post("/pin/set", async (req, res) => {
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

  req.session.userId = user.id;
  req.session.userRole = user.role as "admin" | "manager" | "viewer";
  req.session.pinVerifiedAt = new Date().toISOString();
  req.session.save((err) => {
    if (err) {
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
    });
  });
});

// In-session PIN verification — used by the daily PIN lock overlay.
// The user is already authenticated; this just confirms their identity and
// stamps pinVerifiedAt so they won't be prompted again until tomorrow's 5am.
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

// Manual PIN lock — clears pinVerifiedAt so the overlay appears on next render.
// Available to all authenticated users (e.g. "Lock station" button).
router.post("/pin/lock", (req, res) => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  req.session.pinVerifiedAt = undefined;
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
    const privateDir = process.env.PRIVATE_OBJECT_DIR;
    if (!privateDir) {
      res.status(500).json({ error: "Object storage not configured" });
      return;
    }

    const ext = file.mimetype.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
    const avatarEntityId = `avatars/${req.session.userId}-${Date.now()}.${ext}`;

    const privateDirNorm = privateDir.endsWith("/") ? privateDir : `${privateDir}/`;
    const fullGcsPath = `${privateDirNorm}${avatarEntityId}`;

    const pathParts = fullGcsPath.startsWith("/") ? fullGcsPath.slice(1).split("/") : fullGcsPath.split("/");
    const bucketName = pathParts[0];
    const objectName = pathParts.slice(1).join("/");

    const bucket = objectStorageClient.bucket(bucketName);
    const gcsFile = bucket.file(objectName);

    await gcsFile.save(file.buffer, {
      metadata: { contentType: file.mimetype },
      resumable: false,
    });

    const objectPath = `/objects/${avatarEntityId}`;

    await db
      .update(usersTable)
      .set({ avatarUrl: objectPath })
      .where(eq(usersTable.id, req.session.userId!));

    res.json({ avatarUrl: objectPath });
  } catch (err) {
    console.error("Avatar upload error:", err);
    res.status(500).json({ error: "Failed to upload avatar" });
  }
});

export default router;
