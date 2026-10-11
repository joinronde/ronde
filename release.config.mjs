// Releases of Ronde once main gets regular commits again: every push to main with a release-worthy commit makes
// a version (vX.Y.Z), its notes and a GitHub release. During the beta, main is a single amended commit and
// betas are published by hand (.github/workflows/release.yml); this configuration waits until then.
// Commits use gitmoji: the first emoji says what kind of change it is.

/** New features: a minor version */
const FEATURES = [
  "✨",
  "🎉",
  "📅",
  "🎥",
  "🗂️",
  "📨",
  "🔐",
  "🧩",
  "💳",
  "🧭",
  "🖥️",
  "🎙️",
  "⚙️",
  "🎫",
  "🏷️",
  "💖",
  "🔔",
  "🔎",
  "📈",
  "🪪",
  "🛂",
  "📜",
  "🔑",
  "🐙",
  "🅿️",
  "🎡",
  "🃏",
  "🌐",
  "♿",
  "⌨️",
  "📣",
  "🎨",
];
/** Fixes and polish: a patch version */
const FIXES = ["🐛", "🚑️", "🔒️", "💄", "⚡️", "✏️", "🩹", "🥅", "♻️", "📝", "🔧", "📦", "🏗️", "🔍"];

export default {
  branches: ["main"],
  tagFormat: "v${version}",
  plugins: [
    [
      "semantic-release-gitmoji",
      {
        releaseRules: { major: ["💥"], minor: FEATURES, patch: FIXES },
      },
    ],
    "@semantic-release/github",
  ],
};
