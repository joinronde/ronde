import { NOTIFY_EVENTS } from "@ronde/core/notify";
import type { NotifyConnectorDTO } from "@ronde/core/types";
import { createElement, Fragment } from "react";
import { describe, expect, it } from "vitest";
import {
  ago,
  choicesOf,
  defaultOptions,
  defaultTarget,
  deviceLabelOf,
  firstLine,
  holidayName,
  keyBytes,
  splitDuration,
  textOf,
} from "@/lib/shared/helpers";

// Small pieces of the pages' logic: new notification rules, the drawn select, push keys and devices, durations,
// how old a sync is, a project's description and holiday calendars

const KINDS: NotifyConnectorDTO["kind"][] = ["email", "matrix", "slack", "teams", "discord", "mattermost", "webhook", "sms", "whatsapp"];

describe("a new notification rule", () => {
  it("goes to the participants by email, text message or WhatsApp", () => {
    for (const kind of ["email", "sms", "whatsapp"] as const) expect(defaultTarget(kind)).toEqual({ audience: "participants" });
  });

  it("asks for a Matrix room, and needs nothing more for a chat or a webhook", () => {
    expect(defaultTarget("matrix")).toEqual({ room: "" });
    for (const kind of KINDS.filter((k) => !["email", "sms", "whatsapp", "matrix"].includes(k))) expect(defaultTarget(kind)).toEqual({});
  });

  it("starts ten minutes before a session, a week after an action is late, with no option otherwise", () => {
    expect(defaultOptions("session.soon")).toEqual({ minutesBefore: 10 });
    expect(defaultOptions("action.overdue")).toEqual({ days: 7 });
    for (const ev of NOTIFY_EVENTS.filter((e) => e !== "session.soon" && e !== "action.overdue")) expect(defaultOptions(ev)).toEqual({});
  });

  it("gets a fresh object each time, so one rule's change never reaches another", () => {
    const a = defaultTarget("email");
    a.audience = "hosts";
    expect(defaultTarget("email")).toEqual({ audience: "participants" });
  });
});

describe("the text of a select's option", () => {
  it("reads strings and numbers, zero included", () => {
    expect(textOf("France")).toBe("France");
    expect(textOf(0)).toBe("0");
    expect(textOf(12.5)).toBe("12.5");
  });

  it("reads through elements and lists", () => {
    expect(textOf(["Fr", createElement("b", null, "an", createElement("i", null, "ce"))])).toBe("France");
    expect(textOf(createElement("span", null, "🇫🇷 ", "France"))).toBe("🇫🇷 France");
  });

  it("is empty for nothing, booleans and an element without children", () => {
    for (const node of [null, undefined, true, false, "", [], createElement("img")]) expect(textOf(node)).toBe("");
  });

  it("keeps right-to-left text as it is", () => {
    expect(textOf(createElement("bdi", null, "العربية"))).toBe("العربية");
  });
});

describe("the choices of a drawn select", () => {
  const option = (props: Record<string, unknown>, ...children: unknown[]) => createElement("option", props, ...(children as []));

  it("are read from <option> children, as a native select reads them", () => {
    const choices = choicesOf([
      option({ value: "fr", key: 1 }, "French"),
      option({ value: 3, key: 2, disabled: true, lang: "ar" }, "العربية"),
    ]);
    expect(choices).toEqual([
      { value: "fr", label: "French", text: "French", disabled: false, group: null, lang: undefined },
      { value: "3", label: "العربية", text: "العربية", disabled: true, group: null, lang: "ar" },
    ]);
  });

  it("take an option's text as its value when it has none", () => {
    expect(choicesOf(option({}, "Paris", " ", "15e"))[0]!.value).toBe("Paris 15e");
    expect(choicesOf(option({}))[0]!.value).toBe("");
  });

  it("know the group each one is in, and go through fragments", () => {
    const tree = [
      option({ key: "a", value: "" }, "None"),
      createElement(
        "optgroup",
        { key: "b", label: "Europe" },
        option({ value: "fr" }, "France"),
        createElement(Fragment, null, option({ value: "de" }, "Germany")),
      ),
      createElement("optgroup", { key: "c" }, option({ value: "jp" }, "Japan")),
    ];
    expect(choicesOf(tree).map((c) => [c.value, c.group])).toEqual([
      ["", null],
      ["fr", "Europe"],
      ["de", "Europe"],
      ["jp", null],
    ]);
  });

  it("skip text, empty slots and other elements between the options", () => {
    const Custom = () => null;
    const tree = [
      null,
      false,
      "loose text",
      0,
      createElement("div", { key: 1 }),
      createElement(Custom, { key: 2 }),
      option({ key: 3, value: "x" }, "X"),
    ];
    expect(choicesOf(tree).map((c) => c.value)).toEqual(["x"]);
  });

  it("keep duplicates and the order given, for 50 options as for one", () => {
    const many = Array.from({ length: 50 }, (_, i) => option({ key: i, value: i % 25 }, `Item ${i}`));
    const choices = choicesOf(many);
    expect(choices).toHaveLength(50);
    expect(choices[0]!.value).toBe("0");
    expect(choices[25]!.value).toBe("0");
    expect(choices[49]!.text).toBe("Item 49");
  });

  it("are none for no children", () => {
    expect(choicesOf(null)).toEqual([]);
    expect(choicesOf([])).toEqual([]);
  });
});

describe("the push key", () => {
  const base64url = (bytes: number[]) => Buffer.from(bytes).toString("base64url");

  it("turns a VAPID public key into its 65 bytes", () => {
    const bytes = Array.from({ length: 65 }, (_, i) => (i * 37) % 256);
    bytes[0] = 4;
    const out = keyBytes(base64url(bytes));
    expect([...out]).toEqual(bytes);
    expect(out.buffer).toBeInstanceOf(ArrayBuffer);
  });

  it("puts back the padding base64url leaves out, whatever the length", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const bytes = Array.from({ length: n }, (_, i) => 250 - i);
      expect([...keyBytes(base64url(bytes))]).toEqual(bytes);
    }
  });

  it("reads the URL-safe characters", () => {
    // 0xfb 0xff is "+/8=" in plain base64
    expect(base64url([0xfb, 0xff])).toBe("-_8");
    expect([...keyBytes("-_8")]).toEqual([0xfb, 0xff]);
  });

  it("is empty for an empty key, and refuses a key that is not base64url", () => {
    expect(keyBytes("")).toHaveLength(0);
    expect(() => keyBytes("not a key!")).toThrow();
  });
});

describe("the name of a device", () => {
  const UA = {
    chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
    samsung:
      "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
    safariIphone:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    chromeIphone:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1",
    edgeWindows:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
    chromeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
    firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0",
  };

  it("names the browser and the system", () => {
    expect(deviceLabelOf(UA.chromeAndroid)).toBe("Chrome · Android");
    expect(deviceLabelOf(UA.safariIphone)).toBe("Safari · iOS");
    expect(deviceLabelOf(UA.chromeWindows)).toBe("Chrome · Windows");
    expect(deviceLabelOf(UA.safariMac)).toBe("Safari · macOS");
    expect(deviceLabelOf(UA.firefoxLinux)).toBe("Firefox · Linux");
    expect(deviceLabelOf(UA.firefoxMac)).toBe("Firefox · macOS");
  });

  it("tells Edge and Samsung Internet from the Chrome they also claim to be", () => {
    expect(deviceLabelOf(UA.edgeWindows)).toBe("Edge · Windows");
    expect(deviceLabelOf(UA.samsung)).toBe("Samsung Internet · Android");
  });

  it("calls every browser of an iPhone Safari, which it is underneath (and what an installed app runs in)", () => {
    expect(deviceLabelOf(UA.chromeIphone)).toBe("Safari · iOS");
  });

  it("says what it knows, and nothing for an unknown agent", () => {
    expect(deviceLabelOf("curl/8.5.0")).toBe("");
    expect(deviceLabelOf("")).toBe("");
    expect(deviceLabelOf("SomeBot (Windows)")).toBe("Windows");
    expect(deviceLabelOf("Firefox/131.0")).toBe("Firefox");
  });
});

describe("a duration in two fields", () => {
  it("splits seconds into minutes and seconds (or minutes into hours and minutes)", () => {
    expect(splitDuration(0)).toEqual([0, 0]);
    expect(splitDuration(59)).toEqual([0, 59]);
    expect(splitDuration(60)).toEqual([1, 0]);
    expect(splitDuration(90)).toEqual([1, 30]);
    expect(splitDuration(3599)).toEqual([59, 59]);
  });

  it("keeps everything above an hour in the first field", () => {
    expect(splitDuration(24 * 60)).toEqual([24, 0]);
    expect(splitDuration(10_000)).toEqual([166, 40]);
  });
});

describe("how long ago a project was synced", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  const say = (minutes: number, locale = "en") => ago(at(minutes), locale, "just now", now);

  it("says just now within half a minute", () => {
    expect(say(0)).toBe("just now");
    expect(say(-0.4)).toBe("just now");
    expect(say(0.4)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(say(-1)).toBe("1 minute ago");
    expect(say(-59)).toBe("59 minutes ago");
    expect(say(-60)).toBe("1 hour ago");
    expect(say(-5 * 60)).toBe("5 hours ago");
    expect(say(-24 * 60)).toBe("yesterday");
    expect(say(-3 * 24 * 60)).toBe("3 days ago");
    expect(say(-400 * 24 * 60)).toBe("400 days ago");
  });

  it("rounds to the nearest hour or day, so a day less a minute still reads in hours", () => {
    expect(say(-24 * 60 + 1)).toBe("24 hours ago");
    expect(say(-36 * 60 - 1)).toBe("2 days ago");
  });

  it("says a moment ahead too, a clock a little off", () => {
    expect(say(5)).toBe("in 5 minutes");
    expect(say(24 * 60)).toBe("tomorrow");
  });

  it("speaks the reader's language, right to left included", () => {
    expect(say(-24 * 60, "fr")).toBe("hier");
    expect(say(-24 * 60, "ar")).toBe("أمس");
    expect(say(-5, "zh")).toBe("5分钟前");
  });

  it("measures moments, not calendar days: the time zone written does not matter", () => {
    // 23:30 in Kiribati is 09:30 UTC, two and a half hours before now (a half rounds up, towards now)
    expect(ago("2026-10-13T23:30:00+14:00", "en", "just now", now)).toBe("2 hours ago");
    // 23:59 on the 12th in Baker Island is 11:59 UTC on the 13th: a minute ago, not yesterday
    expect(ago("2026-10-12T23:59:00-12:00", "en", "just now", now)).toBe("1 minute ago");
  });
});

describe("the first line of a description", () => {
  it("skips blank lines and drops heading marks and emphasis", () => {
    expect(firstLine("\n  \n## **Billing** _v2_\nMore")).toBe("Billing v2");
    expect(firstLine("`api` gateway")).toBe("api gateway");
  });

  it("is empty for an empty description", () => {
    expect(firstLine("")).toBe("");
    expect(firstLine("\n\n   \n")).toBe("");
  });

  it("keeps other scripts and emoji", () => {
    expect(firstLine("# مشروع الفوترة 🚀\nتفاصيل")).toBe("مشروع الفوترة 🚀");
    expect(firstLine("计费项目")).toBe("计费项目");
  });
});

describe("the name of a holiday calendar", () => {
  it("names the country in the reader's language", () => {
    expect(holidayName("FR", "en")).toBe("France");
    expect(holidayName("DE", "fr")).toBe("Allemagne");
    expect(holidayName("DE", "zh")).toBe("德国");
    expect(holidayName("FR", "ar")).toBe("فرنسا");
  });

  it("adds the region by its name when known, by its code otherwise", () => {
    expect(holidayName("DE-BY", "en", { BY: "Bayern" })).toBe("Germany · Bayern");
    expect(holidayName("DE-BY", "en")).toBe("Germany · BY");
  });

  it("is empty for no calendar", () => {
    expect(holidayName(null, "en")).toBe("");
    expect(holidayName("", "en")).toBe("");
  });

  it("falls back on the code for a country or a language it cannot name", () => {
    expect(holidayName("ZZZ", "en")).toBe("ZZZ");
    expect(holidayName("FR", "not a locale!")).toBe("FR");
  });
});
