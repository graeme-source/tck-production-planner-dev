import { describe, expect, it } from "vitest";
import { base64FromDataUrl, imageRows, nutritionImageLayout, type NutritionImageRow } from "./nutrition-image";

const row = (key: string, label: string, per100g: string, perPortion: string | null, extra: Partial<NutritionImageRow> = {}): NutritionImageRow =>
  ({ key, label, indent: false, optional: false, per100g, perPortion, ...extra });

// As the server sends them (nutritionRows), Carnizone's numbers.
const carni: NutritionImageRow[] = [
  row("energyKj", "Energy", "1004kJ", "3565kJ"),
  row("energyKcal", "", "240kcal", "851kcal"),
  row("fat", "Fat", "12g", "41g"),
  row("saturates", "of which saturates", "5.8g", "21g", { indent: true }),
  row("carbohydrate", "Carbohydrate", "20g", "71g"),
  row("sugars", "of which sugars", "4.0g", "14g", { indent: true }),
  row("fibre", "Fibre", "2.1g", "7.5g", { optional: true }),
  row("protein", "Protein", "15g", "53g"),
  row("salt", "Salt", "1.1g", "4.0g"),
];

describe("nutrition image layout (matches the website's images)", () => {
  it("the mandatory rows only — fibre is left off like the website's", () => {
    expect(imageRows(carni)!.map(r => r.key)).toEqual(["energyKj", "energyKcal", "fat", "saturates", "carbohydrate", "sugars", "protein", "salt"]);
  });

  it("nothing is drawn when a value is missing or there are no rows", () => {
    expect(imageRows([])).toBeNull();
    expect(nutritionImageLayout(carni.map(r => (r.key === "salt" ? { ...r, per100g: "—" } : r)), 355)).toBeNull();
    expect(nutritionImageLayout(carni.map(r => (r.key === "fat" ? { ...r, perPortion: "—" } : r)), 355)).toBeNull();
  });

  it("headings: bold 'Typical values', 'per 100g', and 'per 355g' / 'serving' on two lines", () => {
    const l = nutritionImageLayout(carni, 355.4)!;
    const bold = l.texts.filter(t => t.bold).map(t => t.text);
    expect(bold).toEqual(["Typical values", "per 100g", "per 355g", "serving"]);
    const serving = l.texts.find(t => t.text === "serving")!;
    expect(serving.y).toBeGreaterThan(l.texts.find(t => t.text === "per 355g")!.y);
  });

  it("values right-aligned in two columns, labels left, 'of which' rows indented, kcal under Energy with no label", () => {
    const l = nutritionImageLayout(carni, 355)!;
    const at = (text: string) => l.texts.find(t => t.text === text)!;
    expect(at("1004kJ").align).toBe("right");
    expect(at("3565kJ").x).toBeGreaterThan(at("1004kJ").x);
    expect(at("of which saturates").x).toBeGreaterThan(at("Fat").x);
    expect(at("Fat").align).toBe("left");
    // kcal row: just the two numbers, on the line below energy.
    const kcalY = at("240kcal").y;
    expect(l.texts.filter(t => t.y === kcalY).map(t => t.text)).toEqual(["240kcal", "851kcal"]);
    expect(kcalY).toBeGreaterThan(at("1004kJ").y);
    // Every value fits inside the border.
    for (const t of l.texts) expect(t.x).toBeLessThanOrEqual(l.border.x + l.border.w);
    expect(Math.max(...l.texts.map(t => t.y))).toBeLessThan(l.border.y + l.border.h);
  });

  it("about 1000 px wide, landscape like the website's", () => {
    const l = nutritionImageLayout(carni, 355)!;
    expect(l.width).toBe(1000);
    expect(l.height).toBeGreaterThan(500);
    expect(l.height).toBeLessThan(l.width);
  });

  it("no portion size (sold by weight): a per 100g column only, at the right edge", () => {
    const per100 = carni.map(r => ({ ...r, perPortion: null }));
    const l = nutritionImageLayout(per100, null)!;
    expect(l.texts.some(t => t.text.includes("serving"))).toBe(false);
    expect(l.texts.find(t => t.text === "1004kJ")!.x).toBe(l.texts.find(t => t.text === "per 100g")!.x);
    expect(l.height).toBeLessThan(nutritionImageLayout(carni, 355)!.height);
  });

  it("the request carries the base64 part of the PNG data URL", () => {
    expect(base64FromDataUrl("data:image/png;base64,iVBORw0K")).toBe("iVBORw0K");
    expect(base64FromDataUrl("data:image/jpeg;base64,xx")).toBeNull();
  });
});
