import { describe, it, expect } from "vitest";
import { toSafeUserRow } from "./safe-user-row";

describe("toSafeUserRow", () => {
  const row = {
    id: 6,
    name: "Lorna",
    email: "lorna@example.com",
    passwordHash: "$2a$10$password",
    pinHash: "$2a$10$station",
    privatePinHash: "$2a$10$private",
    pinAttempts: 0,
  };

  it("REGRESSION: never sends the password or either PIN hash", () => {
    const safe = toSafeUserRow(row) as Record<string, unknown>;
    expect(safe).not.toHaveProperty("passwordHash");
    expect(safe).not.toHaveProperty("pinHash");
    expect(safe).not.toHaveProperty("privatePinHash");
  });

  it("keeps everything else", () => {
    expect(toSafeUserRow(row)).toEqual({ id: 6, name: "Lorna", email: "lorna@example.com", pinAttempts: 0 });
  });
});
