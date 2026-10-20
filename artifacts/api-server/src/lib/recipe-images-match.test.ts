import { describe, expect, it } from "vitest";
import { pickRecipeImages } from "./recipe-name-match";

describe("recipe images from shop products", () => {
  const rows = [
    { productTitle: "Properoni - CarniZone 🍗🍖🌶", imageUrl: "carni.jpg" },
    { productTitle: "Properoni - CarniZone 🍗🍖🌶", imageUrl: "carni-2.jpg" },
    { productTitle: "Properoni Chicken & Chorizo", imageUrl: "chorizo.jpg" },
    { productTitle: "No Photo", imageUrl: null },
    { productTitle: null, imageUrl: "orphan.jpg" },
  ];

  it("finds the photo despite dashes, emojis and capitals", () => {
    const m = pickRecipeImages(["Properoni Carnizone", "Properoni Chicken & Chorizo"], rows);
    expect(m.get("properoni carnizone")).toBe("carni.jpg");
    expect(m.get("properoni chicken & chorizo")).toBe("chorizo.jpg");
  });

  it("leaves out recipes with no photo", () => {
    const m = pickRecipeImages(["No Photo", "Carnizone"], rows);
    expect(m.size).toBe(0);
  });
});
