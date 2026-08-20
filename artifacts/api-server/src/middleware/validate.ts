import type { Request, Response, NextFunction, RequestHandler } from "express";

// This codebase constructs schemas with BOTH zod v3 ("zod") and zod v4
// ("zod/v4"). Their class types are incompatible, so the middleware types
// against the minimal structural surface it actually uses — safeParse plus an
// optional passthrough — instead of one version's classes.
type SafeParseResult =
  | { success: true; data: unknown }
  | { success: false; error: { flatten(): unknown } };

export interface ValidatableSchema {
  safeParse(data: unknown): SafeParseResult;
  /** Present on object schemas (both zod versions); absent on unions etc. */
  passthrough?: () => ValidatableSchema;
}

export function validate(schema: ValidatableSchema): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Use .passthrough() on object schemas so that fields not yet in the
    // spec are forwarded instead of silently stripped.  This prevents data
    // loss when the OpenAPI-generated Zod schema lags behind the actual DB
    // columns (e.g. color, isCoreMenu, ingredient flags, marinades).
    const safeSchema = typeof schema.passthrough === "function" ? schema.passthrough() : schema;
    const result = safeSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Validation failed",
        details: result.error.flatten(),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
