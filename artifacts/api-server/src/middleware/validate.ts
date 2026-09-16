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

/** The request body exactly as the client sent it, BEFORE zod re-built it.
 *
 *  .passthrough() below only protects the TOP level: zod object schemas
 *  nested inside arrays still re-create each item and silently strip any
 *  key the generated spec doesn't know yet. That's how the sub-recipe
 *  marinade links vanished on save (found in the Philly restructure
 *  rehearsal, 2026-09-16): CreateSubRecipeBody's ingredient items lag the
 *  new marinadeForIngredientId / marinadeAddAtCooking columns, so validated
 *  req.body dropped them. Handlers whose NESTED fields can lag the spec
 *  should read those parts from rawBody(req) instead of req.body — the
 *  validation verdict is unchanged, only the stripping is bypassed.
 */
export function rawBody<T = unknown>(req: Request): T {
  return ((req as Request & { _rawBody?: unknown })._rawBody ?? req.body) as T;
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
    (req as Request & { _rawBody?: unknown })._rawBody = req.body;
    req.body = result.data;
    next();
  };
}
