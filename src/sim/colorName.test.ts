import { describe, expect, it } from "vitest";
import { chemLabel, colorName, namedColor } from "./colorName";

describe("color names", () => {
  it("uses the catalog name for a known drug", () => {
    expect(chemLabel("#FF9900")).toBe("Caffeine");
    expect(chemLabel("#ffffff")).toBe("Milk");
  });

  it("names a stock color from the list and snaps the shelf hex onto it", () => {
    const snapped = namedColor(0xff0000);
    const hex = `#${snapped.toString(16).padStart(6, "0")}`.toUpperCase();
    expect(colorName(hex)).toBe(chemLabel(hex));
    expect(colorName("#FF0000").length).toBeGreaterThan(0);
    expect(namedColor(snapped)).toBe(snapped);
  });
});
