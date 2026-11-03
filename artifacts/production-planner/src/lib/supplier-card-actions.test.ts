import { describe, it, expect } from "vitest";
import {
  SUPPLIER_CARD_ACTIONS_ROW,
  SUPPLIER_CARD_EDIT_BUTTON,
  SUPPLIER_CARD_DELETE_BUTTON,
} from "./supplier-card-actions";

// Issue #356: the buttons were "opacity-0 group-hover:opacity-100", so on an
// iPad (no hover) Jane could never see Edit or Delete.
describe("supplier card actions", () => {
  const all = [SUPPLIER_CARD_ACTIONS_ROW, SUPPLIER_CARD_EDIT_BUTTON, SUPPLIER_CARD_DELETE_BUTTON];

  it("never hides the buttons behind hover", () => {
    for (const cls of all) {
      expect(cls).not.toMatch(/(^|\s)opacity-0(\s|$)/);
      expect(cls).not.toMatch(/group-hover:opacity/);
      expect(cls).not.toMatch(/(^|\s)invisible(\s|$)/);
    }
  });

  it("gives each button a 44px touch target", () => {
    for (const cls of [SUPPLIER_CARD_EDIT_BUTTON, SUPPLIER_CARD_DELETE_BUTTON]) {
      expect(cls).toContain("min-w-[44px]");
      expect(cls).toContain("min-h-[44px]");
    }
  });
});
