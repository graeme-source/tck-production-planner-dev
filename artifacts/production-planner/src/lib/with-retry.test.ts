import { describe, expect, it } from "vitest";
import { clientErrorMessage } from "./with-retry";

describe("clientErrorMessage", () => {
  it("uses the server's reason when it sends one", () => {
    expect(clientErrorMessage(422, "Unprocessable Entity", JSON.stringify({ error: "There are no extra packs to take off." })))
      .toBe("There are no extra packs to take off.");
  });
  it("falls back to the status line for empty, non-JSON or reason-less bodies", () => {
    expect(clientErrorMessage(400, "Bad Request", "")).toBe("400 Bad Request");
    expect(clientErrorMessage(404, "Not Found", "<html>nope</html>")).toBe("404 Not Found");
    expect(clientErrorMessage(400, "Bad Request", JSON.stringify({ error: { fieldErrors: {} } }))).toBe("400 Bad Request");
    expect(clientErrorMessage(409, "Conflict", "null")).toBe("409 Conflict");
  });
});
