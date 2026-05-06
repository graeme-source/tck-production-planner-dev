import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import path from "path";
import router from "./routes";

const sessionSecret = process.env["SESSION_SECRET"];
if (!sessionSecret) {
  throw new Error("SESSION_SECRET environment variable is required but not set. Refusing to start.");
}

const PgSession = connectPgSimple(session);

const app: Express = express();

app.set("trust proxy", 1);

const allowedOrigin = process.env["ALLOWED_ORIGIN"] ?? `https://${process.env["REPLIT_DEV_DOMAIN"]}`;

app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }
    const devDomain = process.env["REPLIT_DEV_DOMAIN"];
    const extraOrigins = (process.env["ALLOWED_ORIGIN"] ?? "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    const allowed = [
      allowedOrigin,
      ...(devDomain ? [`https://${devDomain}`] : []),
      ...extraOrigins,
    ];
    // Also allow any *.replit.app or *.railway.app domain
    const isReplitApp = /^https:\/\/[a-z0-9-]+\.replit\.app$/.test(origin);
    const isRailwayApp = /^https:\/\/[a-z0-9-]+\.up\.railway\.app$/.test(origin);
    if (allowed.includes(origin) || isReplitApp || isRailwayApp) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    }
  },
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
    },
  },
}));

app.use(express.json({ limit: "1mb" }));
app.use(express.text({ limit: "10mb", type: "text/plain" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Session middleware runs BEFORE the rate limiter so each iPad's sessionID
// is available to the limiter's keyGenerator. Kitchens behind a single NATed
// public IP would otherwise pool all iPads against one IP-keyed bucket,
// which is what surfaced the 429 storms. Per-session keying gives every
// device its own budget.
app.use(
  session({
    store: new PgSession({
      conString: process.env["DATABASE_URL"],
      createTableIfMissing: true,
      tableName: "sessions",
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: process.env["NODE_ENV"] === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  }),
);

// Rate limit per-session (with IP fallback for unauthenticated traffic).
// Reads (GET / HEAD / OPTIONS) skip the limiter entirely — they're the bulk
// of the traffic and idempotent. Mutations still fall under the cap so abuse
// protection stays where it matters. The cap is generous because legitimate
// kitchen usage at peak (multiple stations polling + manual actions) easily
// fans out to thousands of requests per session per 15 min.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS",
  // Prefer sessionID so each iPad/browser gets its own budget; fall back to
  // the library's IP key generator for pre-session traffic (login, health
  // checks) so IPv6 addresses are normalised correctly. The "rl:" prefix
  // keeps the namespace obvious in any future redis-backed store.
  keyGenerator: (req, res) => req.sessionID
    ? `rl:sess:${req.sessionID}`
    : `rl:ip:${ipKeyGenerator(req.ip ?? "")}`,
  message: { error: "Too many requests, please try again later." },
});

app.use("/api", generalLimiter);

// Desktop machines get a short-lived rolling session so shared PCs don't
// carry one user's login into the next shift. Mobile/tablet keeps the 30-day
// cookie (iPads are per-station, not shared between staff). The client sets
// `tck_device=desktop|mobile` at boot based on touch capability; if the
// header is missing (first request of a brand-new session), we fall back to
// the 30-day default, and the next request self-corrects once the client has
// set the cookie.
const DESKTOP_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
app.use((req, _res, next) => {
  const cookieHeader = req.headers.cookie ?? "";
  const isDesktop = /(?:^|;\s*)tck_device=desktop(?:;|$)/.test(cookieHeader);
  if (isDesktop && req.session?.cookie) {
    req.session.cookie.maxAge = DESKTOP_SESSION_MAX_AGE_MS;
  }
  next();
});

app.use("/api", router);

// In production, serve the built frontend
if (process.env["NODE_ENV"] === "production") {
  const frontendDist = path.resolve(import.meta.dirname, "../../production-planner/dist/public");
  app.use(express.static(frontendDist));
  // SPA fallback — serve index.html for all non-API routes
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.resolve(frontendDist, "index.html"));
  });
}

export default app;
