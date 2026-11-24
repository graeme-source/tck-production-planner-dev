import { describe, expect, it } from "vitest";
import { artworkDisposition, artworkMime, cleanArtworkName } from "./artwork-rules";

describe("artwork rules", () => {
  it("takes print artwork by its extension", () => {
    expect(artworkMime("Insert front.PDF")).toBe("application/pdf");
    expect(artworkMime("label.ai")).toBe("application/illustrator");
    expect(artworkMime("notes.docx")).toBeNull();
  });
  it("keeps the file's name but drops paths and quotes", () => {
    expect(cleanArtworkName("C:\\art\\Insert \"v2\".pdf")).toBe("Insert v2.pdf");
    expect(cleanArtworkName("")).toBe("artwork");
  });
  it("sends the original name back on download", () => {
    expect(artworkDisposition("Insert – back.pdf", false)).toBe(`attachment; filename="Insert _ back.pdf"; filename*=UTF-8''Insert%20%E2%80%93%20back.pdf`);
  });
});
