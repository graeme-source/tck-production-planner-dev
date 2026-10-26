import { describe, it, expect } from "vitest";
import { explainAddressLoss } from "./apc-address-loss";
import { normaliseAddress } from "../services/apc";

describe("what a shortened APC address loses (2026-10-26)", () => {
  it("#138172 no longer loses anything: the town restatement drops, Birmingham stays", () => {
    const n = normaliseAddress("12 Example Road", "The Royal Town of Sutton Coldfield, Birmingham", "Sutton Coldfield", { postcode: "B72 1AA" });
    expect(n.address2).toBe("Birmingham");
    expect(n.review).toEqual([]);
  });
  it("Bournemouth, Christchurch and Poole: Town + County, no flag", () => {
    const n = normaliseAddress("24 St Mark's Road", undefined, "Bournemouth, Christchurch and Poole", { postcode: "BH11 8SZ" });
    expect([n.city, n.county, n.review.length]).toEqual(["Bournemouth", "Christchurch and Poole", 0]);
  });
  it("when the County line is taken, the loss is spelled out", () => {
    const n = normaliseAddress("12 Example Road", "Riverside Business Park, Unit 14 Rear Entrance", "Bournemouth, Christchurch and Poole", { postcode: "BH11 8SZ" });
    const loss = n.review.find(r => r.kind === "truncated")!.loss!;
    expect(loss.lost).toBe("Unit 14 Rear Entrance");
    expect(loss.safe).toBe(false);
    expect(loss.label.county).toBe("Christchurch and Poole");
  });
  it("a lost wider area is safe, and the better line is suggested", () => {
    const loss = explainAddressLoss({
      field: "Address line 2", original: "The Royal Town of Sutton Coldfield, Birmingham", kept: "The Royal Town of Sutton Coldf",
      address1: "12 Example Road", address2: "The Royal Town of Sutton Coldf", city: "Sutton Coldfield",
    });
    expect(loss.lostParts.find(p => p.text === "Birmingham")?.safeBecause).toMatch(/wider area/);
    expect(loss.suggestion).toMatchObject({ line: "" });
  });
  it("a lost flat or building name is NOT safe", () => {
    const loss = explainAddressLoss({
      field: "Address line 2", original: "Riverside Business Park, Unit 14 Rear Entrance", kept: "Riverside Business Park",
      address1: "Mill Lane", address2: "Riverside Business Park", city: "Leeds",
    });
    expect(loss.lost).toBe("Unit 14 Rear Entrance");
    expect(loss.safe).toBe(false);
    expect(loss.suggestion).toBeNull();
  });
  it("suggests dropping the county to keep the part that matters", () => {
    const loss = explainAddressLoss({
      field: "Address line 2", original: "Old Dairy Cottage, Little Snoring, Norfolk", kept: "Old Dairy Cottage, Little Snoring",
      address1: "Church Road", address2: "Old Dairy Cottage, Little Snoring", city: "Fakenham",
    });
    expect(loss.lost).toBe("Norfolk");
    expect(loss.safe).toBe(true);
    // Already as good as it gets — nothing better to suggest.
    expect(loss.suggestion).toBeNull();
  });
  it("Birmingham as the TOWN itself is never 'wider area'", () => {
    const loss = explainAddressLoss({ field: "Address line 2", original: "Flat 3, Birmingham", kept: "Flat 3", address1: "1 High St", address2: "Flat 3", city: "Birmingham" });
    expect(loss.lostParts[0].safeBecause).toMatch(/already on the label/);
  });
});
