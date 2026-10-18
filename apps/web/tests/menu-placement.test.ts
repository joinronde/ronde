import { describe, expect, it } from "vitest";
import { menuPlacement } from "@/lib/shared/menu-placement";

describe("menu placement", () => {
  it("opens above as asked when it fits there", () => {
    expect(menuPlacement({ top: 700, bottom: 740, viewport: 900, topInset: 56, height: 400, preferUp: true })).toEqual({
      up: true,
      maxHeight: 626,
    });
  });

  it("opens below instead when the top of the page has less room (the agenda's add menu cut by the top bar)", () => {
    const place = menuPlacement({ top: 300, bottom: 340, viewport: 900, topInset: 56, height: 520, preferUp: true });
    expect(place).toEqual({ up: false, maxHeight: 542 });
  });

  it("never gets taller than the room it has, on the larger side: it scrolls", () => {
    const place = menuPlacement({ top: 420, bottom: 460, viewport: 800, topInset: 56, height: 900, preferUp: true });
    expect(place).toEqual({ up: true, maxHeight: 346 });
  });

  it("opens below by default, above only when below is too small and above is larger", () => {
    expect(menuPlacement({ top: 100, bottom: 140, viewport: 900, height: 300, preferUp: false }).up).toBe(false);
    expect(menuPlacement({ top: 800, bottom: 840, viewport: 900, height: 300, preferUp: false }).up).toBe(true);
  });
});
