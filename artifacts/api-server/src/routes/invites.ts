import { Router, type IRouter } from "express";
import { db, usersTable, userInvitesTable, passwordResetsTable } from "@workspace/db";
import { eq, and, gt, isNull } from "drizzle-orm";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { validate } from "../middleware/validate";
import { sendEmail, inviteEmailHtml, inviteEmailText, resetEmailHtml, resetEmailText } from "../lib/email";

const router: IRouter = Router();

const APP_URL = process.env["APP_URL"] ?? `https://${process.env["REPLIT_DEV_DOMAIN"]}/production-planner`;

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

function requireAdmin(req: any, res: any, next: any) {
  if (!req.session?.userId || req.session?.userRole !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

// --- INVITES ---

const CreateInviteBody = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "manager", "viewer"]).default("viewer"),
});

router.post("/invites", requireAdmin, validate(CreateInviteBody), async (req, res) => {
  const { email, role } = req.body as z.infer<typeof CreateInviteBody>;
  const adminId = req.session!.userId!;

  const [existingUser] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()));
  if (existingUser) {
    res.status(409).json({ error: "A user with that email already exists" });
    return;
  }

  const [admin] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, adminId));
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const [invite] = await db.insert(userInvitesTable).values({
    token,
    email: email.toLowerCase().trim(),
    role,
    invitedById: adminId,
    expiresAt,
  }).returning();

  const inviteUrl = `${APP_URL}/accept-invite?token=${token}`;

  try {
    await sendEmail({
      to: email,
      subject: "You've been invited to TCK Production Planner",
      html: inviteEmailHtml(inviteUrl, admin?.name ?? "An admin"),
      text: inviteEmailText(inviteUrl, admin?.name ?? "An admin"),
    });
  } catch (err) {
    console.error("Failed to send invite email:", err);
  }

  res.status(201).json({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    expiresAt: invite.expiresAt.toISOString(),
    inviteUrl,
  });
});

router.get("/invites/:token", async (req, res) => {
  const { token } = req.params;
  const [invite] = await db.select()
    .from(userInvitesTable)
    .where(and(
      eq(userInvitesTable.token, token),
      isNull(userInvitesTable.acceptedAt),
      gt(userInvitesTable.expiresAt, new Date()),
    ));

  if (!invite) {
    res.status(404).json({ error: "Invite not found or has expired" });
    return;
  }

  res.json({ email: invite.email, role: invite.role });
});

const AcceptInviteBody = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  password: passwordSchema,
});

router.post("/invites/:token/accept", validate(AcceptInviteBody), async (req, res) => {
  const { token } = req.params;
  const { name, password } = req.body as z.infer<typeof AcceptInviteBody>;

  const [invite] = await db.select()
    .from(userInvitesTable)
    .where(and(
      eq(userInvitesTable.token, token),
      isNull(userInvitesTable.acceptedAt),
      gt(userInvitesTable.expiresAt, new Date()),
    ));

  if (!invite) {
    res.status(404).json({ error: "Invite not found or has expired" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const [user] = await db.insert(usersTable).values({
      name,
      email: invite.email,
      passwordHash,
      role: invite.role as "admin" | "manager" | "viewer",
      isActive: true,
    }).returning();

    await db.update(userInvitesTable)
      .set({ acceptedAt: new Date() })
      .where(eq(userInvitesTable.id, invite.id));

    req.session!.userId = user.id;
    req.session!.userRole = user.role as "admin" | "manager" | "viewer";
    req.session!.save((err) => {
      if (err) { res.status(500).json({ error: "Session error" }); return; }
      res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
    });
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "An account with that email already exists" });
    } else {
      throw err;
    }
  }
});

// --- PASSWORD RESET ---

const ForgotPasswordBody = z.object({
  email: z.string().email(),
});

router.post("/forgot-password", validate(ForgotPasswordBody), async (req, res) => {
  const { email } = req.body as z.infer<typeof ForgotPasswordBody>;

  const [user] = await db.select({ id: usersTable.id, name: usersTable.name })
    .from(usersTable)
    .where(and(eq(usersTable.email, email.toLowerCase().trim()), eq(usersTable.isActive, true)));

  // Always respond success to prevent email enumeration
  res.json({ ok: true });

  if (!user) return;

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await db.insert(passwordResetsTable).values({ token, userId: user.id, expiresAt });

  const resetUrl = `${APP_URL}/reset-password?token=${token}`;

  try {
    await sendEmail({
      to: email,
      subject: "Reset your TCK Production Planner password",
      html: resetEmailHtml(resetUrl),
      text: resetEmailText(resetUrl),
    });
  } catch (err) {
    console.error("Failed to send reset email:", err);
  }
});

router.get("/reset-password/:token", async (req, res) => {
  const { token } = req.params;
  const [reset] = await db.select()
    .from(passwordResetsTable)
    .where(and(
      eq(passwordResetsTable.token, token),
      isNull(passwordResetsTable.usedAt),
      gt(passwordResetsTable.expiresAt, new Date()),
    ));

  if (!reset) {
    res.status(404).json({ error: "Reset link not found or has expired" });
    return;
  }

  res.json({ valid: true });
});

const ResetPasswordBody = z.object({
  password: passwordSchema,
});

router.post("/reset-password/:token", validate(ResetPasswordBody), async (req, res) => {
  const { token } = req.params;
  const { password } = req.body as z.infer<typeof ResetPasswordBody>;

  const [reset] = await db.select()
    .from(passwordResetsTable)
    .where(and(
      eq(passwordResetsTable.token, token),
      isNull(passwordResetsTable.usedAt),
      gt(passwordResetsTable.expiresAt, new Date()),
    ));

  if (!reset) {
    res.status(404).json({ error: "Reset link not found or has expired" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await db.update(usersTable).set({ passwordHash, updatedAt: new Date() }).where(eq(usersTable.id, reset.userId));
  await db.update(passwordResetsTable).set({ usedAt: new Date() }).where(eq(passwordResetsTable.id, reset.id));

  res.json({ ok: true });
});

export default router;
