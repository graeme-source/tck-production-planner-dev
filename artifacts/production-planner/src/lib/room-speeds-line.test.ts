import { describe, it, expect } from "vitest";
import { roomSpeedsLine } from "./room-speeds-line";

describe("roomSpeedsLine", () => {
  it("puts boxes packed and packs wrapped per hour on one small line", () => {
    expect(roomSpeedsLine({ boxesPerHour: 12.34, packsPerHour: 150.4 })).toBe("12.3 boxes/hr · 150 packs/hr wrapped");
    expect(roomSpeedsLine({ boxesPerHour: null, packsPerHour: 98 })).toBe("98 packs/hr wrapped");
    expect(roomSpeedsLine({ boxesPerHour: null, packsPerHour: null })).toBe("No packing or wrapping yet");
  });
});
