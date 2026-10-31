// Post-build guard: load the compiled Vercel entry the way Vercel's runtime
// does (no ESM syntax detection for ambiguous files) and build a deck, so a
// dependency that only crashes in production fails the build instead.
// Run with: node --no-experimental-detect-module scripts/check-serverless.mjs
const entry = await import("../api/index.js");
if (typeof entry.default !== "function")
  throw new Error("api/index.js has no request handler export.");
const { toPptx } = await import("../dist-server/server/slides.js");
const { seedRun } = await import("../dist-server/server/demo.js");
const deck = await toPptx({
  ...seedRun(),
  report: "# Check\n\n## Section\n\nA sentence for the deck.",
});
if (!deck.length || deck.subarray(0, 2).toString() !== "PK")
  throw new Error("PowerPoint export did not produce a .pptx file.");
console.log(
  `Serverless entry loads; deck export works (${deck.length} bytes).`,
);
process.exit(0);
