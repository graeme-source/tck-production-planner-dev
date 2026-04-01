import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
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

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

app.use("/api", generalLimiter);

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

app.use("/api", router);

// In production, serve the built frontend
if (process.env["NODE_ENV"] === "production") {
  const frontendDist = path.resolve(import.meta.dirname, "../../production-planner/dist/public");
  console.log("[static] Serving frontend from:", frontendDist);
  const fs = await import("fs");
  console.log("[static] Directory exists:", fs.existsSync(frontendDist));
  if (fs.existsSync(frontendDist)) {
    console.log("[static] Files:", fs.readdirSync(frontendDist).join(", "));
    const assetsDir = path.resolve(frontendDist, "assets");
    if (fs.existsSync(assetsDir)) {
      console.log("[static] Assets:", fs.readdirSync(assetsDir).slice(0, 5).join(", "));
    }
  }
  app.use(express.static(frontendDist));
  // SPA fallback — serve index.html for all non-API routes
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.resolve(frontendDist, "index.html"));
  });
}

export default app;
