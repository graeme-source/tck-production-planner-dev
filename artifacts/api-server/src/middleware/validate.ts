import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodObject, type ZodSchema } from "zod";

export function validate(schema: ZodSchema): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Use .passthrough() on object schemas so that fields not yet in the
    // spec are forwarded instead of silently stripped.  This prevents data
    // loss when the OpenAPI-generated Zod schema lags behind the actual DB
    // columns (e.g. color, isCoreMenu, ingredient flags, marinades).
    const safeSchema = schema instanceof ZodObject ? schema.passthrough() : schema;
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
