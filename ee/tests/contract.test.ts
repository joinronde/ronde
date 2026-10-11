// SPDX-License-Identifier: LicenseRef-Ronde-EE
import { describe, expect, it } from "vitest";
import { ee } from "../src/index";

describe("Enterprise edition", () => {
  it("names itself, so a pure Community build can be checked for its absence", () => {
    expect(ee).toMatchObject({ kind: "ee", label: "Ronde Enterprise Edition" });
  });
});
