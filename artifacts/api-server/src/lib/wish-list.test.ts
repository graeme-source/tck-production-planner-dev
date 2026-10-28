import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  commentNotificationMessage,
  commentRecipients,
  canEditItem,
  canManageWishList,
  canVoteToday,
  cleanProductUrl,
  findDuplicate,
  parsePriceToPence,
  readProductPage,
  storeNameFor,
  stripSiteSuffix,
  summariseVotes,
  titleFromUrl,
  titlesNearlySame,
  unacknowledgedItems,
  urlDuplicateKey,
} from "./wish-list";

// Graeme's own test link (23 Oct 2026), straight from a Google Shopping ad.
const GGM_AD_LINK = "https://www.ggmgastro.com/en-gb-gbp/commercial-walk-behind-scrubber-dryer-work-rate-1200-m2-h-tanks-4-5l-7-5l-incl-charging-cable-kbssk?utm_source=google&utm_medium=cpc&utm_campaign=alle-produkte&utm_content=klarna&utm_term=KBSSK&gad_source=1&gad_campaignid=22755667603&gbraid=0AAAAAC8r70QK06g7Jwz4HTKcLJUxA9OqO&gclid=CjwKCAjwi-zWBhAdEiwAqlRf-LfxqhTSwx7ixPIOh6XcTh5Ns8NvRoUIuajC38Bg_Rc8rmg15wykOhoCwFQQAvD_BwE";
const GGM_CLEAN = "https://www.ggmgastro.com/en-gb-gbp/commercial-walk-behind-scrubber-dryer-work-rate-1200-m2-h-tanks-4-5l-7-5l-incl-charging-cable-kbssk";

describe("cleanProductUrl", () => {
  it("strips every tracking parameter from Graeme's GGM ad link", () => {
    expect(cleanProductUrl(GGM_AD_LINK)).toBe(GGM_CLEAN);
  });
  it("keeps parameters that pick the product (size, colour, variant)", () => {
    expect(cleanProductUrl("https://shop.example.com/p/mop?variant=123&utm_source=x&fbclid=y#reviews"))
      .toBe("https://shop.example.com/p/mop?variant=123");
  });
  it("cuts Amazon links to /dp/ASIN", () => {
    expect(cleanProductUrl("https://www.amazon.co.uk/Vileda-Turbo-Mop/dp/b00ab12cde/ref=sr_1_3?crid=XYZ&keywords=mop&qid=1&sr=8-3"))
      .toBe("https://www.amazon.co.uk/dp/B00AB12CDE");
    expect(cleanProductUrl("https://www.amazon.co.uk/gp/product/B00AB12CDE?psc=1")).toBe("https://www.amazon.co.uk/dp/B00AB12CDE");
  });
  it("adds https:// to a bare address and refuses non-web links", () => {
    expect(cleanProductUrl("nisbets.co.uk/some-tongs")).toBe("https://nisbets.co.uk/some-tongs");
    expect(cleanProductUrl("javascript:alert(1)")).toBeNull();
    expect(cleanProductUrl("ftp://example.com/x")).toBeNull();
    expect(cleanProductUrl("just some words")).toBeNull();
    expect(cleanProductUrl("")).toBeNull();
  });
});

describe("urlDuplicateKey", () => {
  it("treats the ad link and the clean link as the same thing", () => {
    expect(urlDuplicateKey(GGM_AD_LINK)).toBe(urlDuplicateKey(GGM_CLEAN));
  });
  it("ignores www., a trailing slash, case and parameter order", () => {
    expect(urlDuplicateKey("https://WWW.Example.com/Tongs/?b=2&a=1")).toBe(urlDuplicateKey("http://example.com/tongs?a=1&b=2"));
  });
  it("tells different products apart", () => {
    expect(urlDuplicateKey("https://example.com/tongs?variant=1")).not.toBe(urlDuplicateKey("https://example.com/tongs?variant=2"));
  });
});

describe("titlesNearlySame / findDuplicate", () => {
  it("matches the same words in a different order or case", () => {
    expect(titlesNearlySame("Heavy-duty Mop Bucket", "mop bucket heavy duty")).toBe(true);
  });
  it("doesn't match short titles that differ by a word", () => {
    expect(titlesNearlySame("Mop", "Mop bucket")).toBe(false);
  });
  it("matches long titles with one word different", () => {
    expect(titlesNearlySame(
      "Commercial Walk-Behind Scrubber Dryer Work Rate 1200 m2/h Tanks 4.5L 7.5L incl charging cable",
      "Commercial Walk-Behind Scrubber Dryer Work Rate 1200 m2/h Tanks 4.5L 7.5L charging cable",
    )).toBe(true);
  });
  const items = [
    { id: 1, url: GGM_CLEAN, title: "Scrubber dryer", status: "requested" },
    { id: 2, url: null, title: "Spare blue chopping boards", status: "approved" },
    { id: 3, url: "https://example.com/old-thing", title: "Old thing", status: "declined" },
  ];
  it("finds an open item by link (even with tracking on it)", () => {
    expect(findDuplicate(items, { url: GGM_AD_LINK, title: "anything" })?.id).toBe(1);
  });
  it("finds an open item by near-identical title", () => {
    expect(findDuplicate(items, { url: null, title: "spare BLUE chopping boards" })?.id).toBe(2);
  });
  it("lets something declined be asked for again", () => {
    expect(findDuplicate(items, { url: "https://example.com/old-thing", title: "Old thing" })).toBeNull();
  });
});

describe("parsePriceToPence", () => {
  it.each([
    ["654.12", 65412],
    ["£1,234.56", 123456],
    ["£12", 1200],
    ["12,50 €", 1250],
    ["1.234,56", 123456],
    ["1.200", 120000],
    [19.99, 1999],
    ["Price: £ 7.5", 750],
  ])("%s → %s", (raw, pence) => {
    expect(parsePriceToPence(raw)).toBe(pence);
  });
  it("is null for no number", () => {
    expect(parsePriceToPence("Call for price")).toBeNull();
    expect(parsePriceToPence(null)).toBeNull();
    expect(parsePriceToPence(-3)).toBeNull();
  });
});

describe("votes — once per person per London day", () => {
  const votes = [
    { userId: 7, voteDate: "2026-10-20" },
    { userId: 7, voteDate: "2026-10-23" },
    { userId: 9, voteDate: "2026-10-23" },
  ];
  it("refuses a second vote the same day, allows it the next day", () => {
    expect(canVoteToday(votes, 7, "2026-10-23")).toBe(false);
    expect(canVoteToday(votes, 7, "2026-10-24")).toBe(true);
    expect(canVoteToday(votes, 12, "2026-10-23")).toBe(true);
  });
  it("summarises total, people and different days", () => {
    expect(summariseVotes(votes, 7, "2026-10-23")).toEqual({ total: 3, people: 2, days: 2, votedToday: true });
    expect(summariseVotes(votes, 12, "2026-10-23").votedToday).toBe(false);
  });
});

describe("who manages the list", () => {
  it("is the founder and admins", () => {
    expect(canManageWishList({ email: "graeme@thecalzonekitchen.co.uk", role: "viewer" })).toBe(true);
    expect(canManageWishList({ email: "someone@x.com", role: "admin" })).toBe(true);
    expect(canManageWishList({ email: "someone@x.com", role: "manager" })).toBe(false);
  });
  it("lets the requester edit only while requested", () => {
    expect(canEditItem({ createdByUserId: 5, status: "requested" }, { id: 5, canManage: false })).toBe(true);
    expect(canEditItem({ createdByUserId: 5, status: "approved" }, { id: 5, canManage: false })).toBe(false);
    expect(canEditItem({ createdByUserId: 5, status: "requested" }, { id: 6, canManage: false })).toBe(false);
    expect(canEditItem({ createdByUserId: 5, status: "ordered" }, { id: 6, canManage: true })).toBe(true);
  });
});

describe("unacknowledgedItems", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  const it_ = (id: number, by: number, daysAgo: number, deleted = false) => ({
    id, createdByUserId: by, createdAt: new Date(now.getTime() - daysAgo * 864e5), deletedAt: deleted ? now : null,
  });
  const items = [it_(1, 2, 20), it_(2, 2, 3), it_(3, 1, 1), it_(4, 3, 0), it_(5, 3, 0, true)];
  it("shows what's newer than the marker, not my own adds or deleted ones", () => {
    expect(unacknowledgedItems(items, 1, 1, now).map(i => i.id)).toEqual([2, 4]);
    expect(unacknowledgedItems(items, 1, 4, now)).toEqual([]);
  });
  it("with no marker yet, shows only the last week", () => {
    expect(unacknowledgedItems(items, 1, null, now).map(i => i.id)).toEqual([2, 4]);
  });
});

describe("stripSiteSuffix / storeNameFor", () => {
  it("removes the shop name tail", () => {
    expect(stripSiteSuffix("Tongs 30cm | Nisbets", null)).toBe("Tongs 30cm");
    expect(stripSiteSuffix("Amazon.co.uk : Vileda mop", null)).toBe("Vileda mop");
    expect(stripSiteSuffix("Mop - Blue", null)).toBe("Mop - Blue");
    expect(stripSiteSuffix("Mop - Example Shop", "Example Shop")).toBe("Mop");
  });
  it("names known shops and falls back to the host", () => {
    expect(storeNameFor(GGM_CLEAN)).toBe("GGM Gastro");
    expect(storeNameFor("https://www.amazon.co.uk/dp/B00AB12CDE")).toBe("Amazon");
    expect(storeNameFor("https://www.some-shop.co.uk/x")).toBe("some-shop.co.uk");
    expect(storeNameFor("https://www.some-shop.co.uk/x", "Some Shop")).toBe("Some Shop");
  });
});

describe("titleFromUrl", () => {
  it("makes a name from the link when the page can't be read", () => {
    expect(titleFromUrl(GGM_CLEAN)).toBe("Commercial walk behind scrubber dryer work rate 1200 m2 h tanks 4 5l 7 5l incl charging cable kbssk");
    expect(titleFromUrl("https://www.nisbets.co.uk/vogue-tongs-300mm/p/c123.html")).toBe("Vogue tongs 300mm");
    expect(titleFromUrl("https://www.amazon.co.uk/dp/B00AB12CDE")).toBeNull();
    expect(titleFromUrl("https://example.com/")).toBeNull();
  });
});

describe("readProductPage", () => {
  it("reads Graeme's GGM scrubber dryer page (saved fixture)", () => {
    const html = readFileSync(new URL("./__fixtures__/ggm-scrubber-dryer.html", import.meta.url), "utf8");
    const r = readProductPage(html, GGM_CLEAN);
    expect(r.title).toBe("Commercial Walk-Behind Scrubber Dryer - Work Rate 1200 m²/h - Tanks 4.5L/7.5L - incl. charging cable");
    expect(r.pricePence).toBe(65412);
    expect(r.priceIncludesVat).toBe(true);
    expect(r.priceExVatPence).toBe(54510);
    expect(r.currency).toBe("GBP");
    expect(r.imageUrl).toBe("https://cdn.ggmgastro.com/asset/5d8ba9e4-74e8-4a35-9021-a2aad439d5ca/JPG/KBSSK_1.jpg");
    expect(r.storeName).toBe("GGM Gastro");
  });

  it("reads og: and product: meta tags when there's no JSON-LD", () => {
    const html = `<html><head>
      <meta property="og:title" content="Stainless Steel Tongs 30cm | Kitchen Co" />
      <meta property="og:site_name" content="Kitchen Co" />
      <meta property="og:image" content="/img/tongs.jpg" />
      <meta property="product:price:amount" content="8.99" />
      <meta property="product:price:currency" content="gbp" />
    </head><body>Price ex VAT</body></html>`;
    const r = readProductPage(html, "https://kitchen.example.com/tongs");
    expect(r.title).toBe("Stainless Steel Tongs 30cm");
    expect(r.pricePence).toBe(899);
    expect(r.currency).toBe("GBP");
    expect(r.priceIncludesVat).toBe(false);
    expect(r.imageUrl).toBe("https://kitchen.example.com/img/tongs.jpg");
    expect(r.storeName).toBe("Kitchen Co");
  });

  it("reads Amazon's own markup", () => {
    const html = `<html><head><title>Amazon.co.uk : Vileda Turbo Mop</title></head><body>
      <span id="productTitle" class="a-size-large">   Vileda Turbo Microfibre Mop &amp; Bucket Set   </span>
      <span class="a-price"><span class="a-offscreen">£29.99</span></span>
      <img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/mop.jpg" src="https://m.media-amazon.com/images/I/mop-small.jpg" />
    </body></html>`;
    const r = readProductPage(html, "https://www.amazon.co.uk/dp/B00AB12CDE");
    expect(r.title).toBe("Vileda Turbo Microfibre Mop & Bucket Set");
    expect(r.pricePence).toBe(2999);
    expect(r.currency).toBe("GBP");
    expect(r.imageUrl).toBe("https://m.media-amazon.com/images/I/mop.jpg");
    expect(r.storeName).toBe("Amazon");
  });

  it("finds a Product inside an @graph and copes with broken JSON-LD", () => {
    const html = `<script type="application/ld+json">{ broken</script>
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"Product","name":"Label printer","image":{"url":"https://x.com/p.png"},"offers":[{"@type":"Offer","price":149,"priceCurrency":"GBP"}]}]}</script>`;
    const r = readProductPage(html, "https://x.com/printer");
    expect(r.title).toBe("Label printer");
    expect(r.pricePence).toBe(14900);
    expect(r.imageUrl).toBe("https://x.com/p.png");
  });

  it("returns nulls, not a crash, for a page with nothing on it", () => {
    const r = readProductPage("<html><body>hello</body></html>", "https://x.com/");
    expect(r).toMatchObject({ title: null, pricePence: null, imageUrl: null });
  });
});

describe("wish list comment notifications", () => {
  it("tells the requester and earlier commenters, never the writer or anyone twice", () => {
    expect(commentRecipients({ requesterId: 1, earlierCommenterIds: [2, 3, 2, null, 1], authorId: 3 }).sort()).toEqual([1, 2]);
  });
  it("the requester replying to themselves tells nobody new", () => {
    expect(commentRecipients({ requesterId: 1, earlierCommenterIds: [], authorId: 1 })).toEqual([]);
  });
  it("an item with no requester left still reaches earlier commenters", () => {
    expect(commentRecipients({ requesterId: null, earlierCommenterIds: [5], authorId: 6 })).toEqual([5]);
  });
  it("says whose item it is", () => {
    expect(commentNotificationMessage("Lorna Brown", "Spray bottles", true)).toBe("Lorna Brown commented on your wish list item: Spray bottles");
    expect(commentNotificationMessage("Graeme", "Spray bottles", false)).toBe("Graeme commented on a wish list item: Spray bottles");
  });
});
