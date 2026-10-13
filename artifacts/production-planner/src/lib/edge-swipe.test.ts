import { describe, it, expect } from "vitest";
import {
  blockedByAncestors, businessSwipeEnabled, classifyMove, inStartZone, leftSwipeCommits, quickActionsHandleStyle, quickActionsHandleVisible, showBusinessInNav,
  type AncestorInfo,
} from "./edge-swipe";

describe("inStartZone", () => {
  it("right swipe starts anywhere in the right half, but not on the last 20 px (Safari's forward swipe)", () => {
    expect(inStartZone("right", 540, 1080)).toBe(true);
    expect(inStartZone("right", 1060, 1080)).toBe(true);
    expect(inStartZone("right", 1061, 1080)).toBe(false);
    expect(inStartZone("right", 539, 1080)).toBe(false);
  });
  it("left swipe starts anywhere in the left half, but not on the first 20 px (Safari's back swipe)", () => {
    expect(inStartZone("left", 20, 390)).toBe(true);
    expect(inStartZone("left", 195, 390)).toBe(true);
    expect(inStartZone("left", 19, 390)).toBe(false);
    expect(inStartZone("left", 196, 390)).toBe(false);
  });
});

describe("classifyMove", () => {
  it("waits until the finger has really travelled", () => {
    expect(classifyMove({ dx: -20, dy: 2, direction: -1 })).toBe("pending");
  });
  it("takes a clearly sideways swipe the right way", () => {
    expect(classifyMove({ dx: -30, dy: 10, direction: -1 })).toBe("go");
    expect(classifyMove({ dx: 40, dy: -5, direction: 1 })).toBe("go");
  });
  it("leaves scrolls, diagonals and wrong-way swipes to the page", () => {
    expect(classifyMove({ dx: -5, dy: 30, direction: -1 })).toBe("abandon");
    expect(classifyMove({ dx: -30, dy: 20, direction: -1 })).toBe("abandon"); // not > 2× sideways
    expect(classifyMove({ dx: 30, dy: 0, direction: -1 })).toBe("abandon");
  });
  it("either way for dragging the open panel (direction 0), with its own small slop", () => {
    expect(classifyMove({ dx: 12, dy: 3, direction: 0, slopPx: 10, ratio: 1 })).toBe("go");
    expect(classifyMove({ dx: -12, dy: 3, direction: 0, slopPx: 10, ratio: 1 })).toBe("go");
    expect(classifyMove({ dx: 4, dy: 12, direction: 0, slopPx: 10, ratio: 1 })).toBe("abandon");
    expect(classifyMove({ dx: 6, dy: 2, direction: 0, slopPx: 10, ratio: 1 })).toBe("pending");
  });
});

const el = (tag: string, attrs: AncestorInfo["attrs"] = {}, extra: Partial<AncestorInfo> = {}): AncestorInfo => ({ tag, attrs, ...extra });

describe("blockedByAncestors", () => {
  it("lets ordinary buttons, cards and text start a swipe", () => {
    expect(blockedByAncestors([el("span"), el("button"), el("div"), el("main", {}, { overflowX: "hidden" })])).toBe(false);
  });
  it("leaves text boxes, sliders, canvases and editable text alone", () => {
    expect(blockedByAncestors([el("input")])).toBe(true);
    expect(blockedByAncestors([el("textarea")])).toBe(true);
    expect(blockedByAncestors([el("div", { role: "slider" })])).toBe(true);
    expect(blockedByAncestors([el("canvas")])).toBe(true);
    expect(blockedByAncestors([el("p"), el("div", { contenteditable: "true" })])).toBe(true);
    expect(blockedByAncestors([el("div", { contenteditable: "false" })])).toBe(false);
  });
  it("leaves drag-and-drop areas and anything marked data-no-swipe alone", () => {
    expect(blockedByAncestors([el("span"), el("div", { "aria-roledescription": "sortable" })])).toBe(true);
    expect(blockedByAncestors([el("div", { "aria-roledescription": "draggable" })])).toBe(true);
    expect(blockedByAncestors([el("div", { draggable: "true" })])).toBe(true);
    expect(blockedByAncestors([el("span"), el("section", { "data-no-swipe": "" })])).toBe(true);
  });
  it("leaves a sideways-scrolling table alone — but only if it can actually scroll", () => {
    expect(blockedByAncestors([el("td"), el("div", {}, { overflowX: "auto", sidewaysSlackPx: 800 })])).toBe(true);
    expect(blockedByAncestors([el("td"), el("div", {}, { overflowX: "auto", sidewaysSlackPx: 0 })])).toBe(false);
  });
  // Found on the phone (2026-10-10): the page's own scroller was 11 px too
  // wide, which switched the swipe off everywhere on the dashboard.
  it("ignores a page that pokes a few px past the edge", () => {
    expect(blockedByAncestors([el("a"), el("div", {}, { overflowX: "auto", sidewaysSlackPx: 11 })])).toBe(false);
  });
});

describe("leftSwipeCommits", () => {
  it("a deliberate swipe 30% across (at least 120 px) goes to The Business", () => {
    expect(leftSwipeCommits({ dx: 330, viewportWidth: 1080, velocityPxPerMs: 0 })).toBe(true);
    expect(leftSwipeCommits({ dx: 300, viewportWidth: 1080, velocityPxPerMs: 0 })).toBe(false);
    expect(leftSwipeCommits({ dx: 120, viewportWidth: 390, velocityPxPerMs: 0 })).toBe(true);
    expect(leftSwipeCommits({ dx: 110, viewportWidth: 390, velocityPxPerMs: 0 })).toBe(false);
  });
  it("a fast flick counts only after 20% of the screen", () => {
    expect(leftSwipeCommits({ dx: 230, viewportWidth: 1080, velocityPxPerMs: 0.9 })).toBe(true);
    expect(leftSwipeCommits({ dx: 150, viewportWidth: 1080, velocityPxPerMs: 0.9 })).toBe(false);
    expect(leftSwipeCommits({ dx: -400, viewportWidth: 1080, velocityPxPerMs: 0.9 })).toBe(false);
  });
});

describe("The Business on touch screens", () => {
  const ipad = { coarsePointer: true, canHover: false };
  const desktop = { coarsePointer: false, canHover: true };
  it("comes out of the founder's menu on a touch screen (any width) and stays with a mouse", () => {
    expect(showBusinessInNav({ isFounder: true, ...ipad })).toBe(false);
    expect(showBusinessInNav({ isFounder: true, ...desktop })).toBe(true);
    expect(showBusinessInNav({ isFounder: true, coarsePointer: false, canHover: false })).toBe(false);
    // A touchscreen PC with a mouse/trackpad keeps it in the menu (regression, 2026-10-12).
    expect(showBusinessInNav({ isFounder: true, ...ipad, anyFinePointer: true })).toBe(true);
    expect(showBusinessInNav({ isFounder: true, ...ipad, anyFinePointer: false })).toBe(false);
  });
  it("stays in the menu for anyone else with a Business grant", () => {
    expect(showBusinessInNav({ isFounder: false, ...ipad })).toBe(true);
  });
  it("the left swipe works only for the founder, only on touch, and not when already there", () => {
    expect(businessSwipeEnabled({ isFounder: true, ...ipad, onBusinessPage: false })).toBe(true);
    expect(businessSwipeEnabled({ isFounder: true, ...ipad, onBusinessPage: true })).toBe(false);
    expect(businessSwipeEnabled({ isFounder: false, ...ipad, onBusinessPage: false })).toBe(false);
    expect(businessSwipeEnabled({ isFounder: true, ...desktop, onBusinessPage: false })).toBe(false);
  });
});

describe("quick-actions handle style", () => {
  it("a desktop mouse gets the big tab", () => {
    expect(quickActionsHandleStyle({ coarsePointer: false, canHover: true, anyFinePointer: true })).toBe("tab");
  });
  it("an iPad or phone (touch only) keeps the slim handle", () => {
    expect(quickActionsHandleStyle({ coarsePointer: true, canHover: false, anyFinePointer: false })).toBe("slim");
    expect(quickActionsHandleStyle({ coarsePointer: true, canHover: false })).toBe("slim");
  });
  it("a touchscreen laptop or an iPad with a trackpad gets the tab, even reporting a coarse primary pointer", () => {
    expect(quickActionsHandleStyle({ coarsePointer: true, canHover: true, anyFinePointer: true })).toBe("tab");
    expect(quickActionsHandleStyle({ coarsePointer: true, canHover: false, anyFinePointer: true })).toBe("tab");
  });
  it("a hover-capable fine primary pointer with no any-pointer report still gets the tab", () => {
    expect(quickActionsHandleStyle({ coarsePointer: false, canHover: true })).toBe("tab");
  });
});

describe("quick-actions handle visibility", () => {
  it("the slim handle hides once the panel is fully out; the tab stays so a second click closes it", () => {
    expect(quickActionsHandleVisible({ style: "slim", progress: 1, overlayShowing: false })).toBe(false);
    expect(quickActionsHandleVisible({ style: "tab", progress: 1, overlayShowing: false })).toBe(true);
    expect(quickActionsHandleVisible({ style: "slim", progress: 0.4, overlayShowing: false })).toBe(true);
  });
  it("neither shows over another pop-up while the panel is shut", () => {
    expect(quickActionsHandleVisible({ style: "tab", progress: 0, overlayShowing: true })).toBe(false);
    expect(quickActionsHandleVisible({ style: "slim", progress: 0, overlayShowing: true })).toBe(false);
    expect(quickActionsHandleVisible({ style: "tab", progress: 0, overlayShowing: false })).toBe(true);
  });
});
