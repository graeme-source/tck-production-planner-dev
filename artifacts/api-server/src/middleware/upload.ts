import type { Request, Response, NextFunction, RequestHandler } from "express";
import multer from "multer";

/**
 * A single-file multipart upload whose failures come back as plain-English
 * 400s. Bare multer errors (an over-limit video, a dropped connection) used
 * to surface as generic 500s that the recording modals then ignored — which
 * is how an improvement's "before" clip could vanish without a word
 * (improvement 33, 2026-08-27). The message here is shown to the person
 * verbatim, so it says what to do, not what went wrong internally.
 */
export function singleFileUpload(field: string, maxMb: number): RequestHandler {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxMb * 1024 * 1024 } });
  return (req: Request, res: Response, next: NextFunction) => {
    upload.single(field)(req, res, (err: unknown) => {
      if (!err) {
        next();
        return;
      }
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ error: `File too large (max ${maxMb}MB) — trim it or record a shorter clip.` });
        return;
      }
      console.error("[upload] multipart parse failed:", err);
      res.status(400).json({ error: "The upload didn't make it to the server — check the connection and try again." });
    });
  };
}
