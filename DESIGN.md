# Accepted visual baseline

The user preferred the first blue-and-white research workspace. That design is restored as the baseline: the original sidebar, introductory research diagram, three workflow cards, and research table. The later editorial and SaaS dashboard restyles are not imported into the live application.

Current entry styles are `styles.css` and `control-refinements.css`; the overview is `OriginalOverview.tsx`.

Only targeted control improvements are retained: accessible custom select menus for time, tokens, run mode, schedules, and workflow filtering; the menu Escape fix; stable modal focus; and keyboard workspace search. Further changes should refine this baseline rather than introduce a different visual direction.

## Octo refinement pass (October 2026)

Builds on the accepted blue-and-white baseline; layout, palette and component structure are unchanged. Additions live in `src/octo.css`, layered after `styles.css`.

- **Brand:** the product is named Octo. New mark (ring, core, orbiting node) and favicon in the existing cobalt.
- **Typography:** self-hosted Inter Variable replaces the Helvetica/Arial fallback so type renders the same on every OS. Labels previously set at 7–9px move to 9–11px; heading weights stay light.
- **Agent mascots:** each mascot represents one specific agent and always appears with that agent's name (`src/agents.tsx`). The roster mirrors the specialist plan in `server/prompts.ts`. Mascots are never decorative: they appear in the research diagram (labelled nodes, idle), the research dialog's team roster, the run's team panel, and beside activity entries written by that agent (exact name match). States come only from real data: the director reflects run status; OpenAI specialists reflect reported agent status. Google shows planned passes without per-specialist activity, because the API does not report it. Runs, workflow cards and system events do not use mascots.
- **Overview:** research diagram with each agent labelled, and a workspace activity strip computed from saved runs.
- **Run detail:** ASCII scan while research is in progress, mascot team panel, evidence-coverage radar and fit distribution for company records (computed from saved records only), middle-truncated URLs and file paths, and slide-to-confirm for CRM export after the review checkbox.

References studied: Inspo (Gumloop, Statsig, Calendly), libraries.dev bot avatars, Bible Strong Avatar Lab (studied only; no code used, no license stated), evilcharts radar (reimplemented with ECharts directly, since the project has no Tailwind/shadcn), sv-chan components (Svelte; slide-to-unlock, middle truncation and contribution grid patterns reimplemented in React), 21st.dev ASCII recipes (style reference for a custom canvas effect), loading.dev loaders. No icons MCP was available; Lucide remains the icon set.

## Questions, plan-based teams and dark mode (October 2026)

- **Specialists follow the plan.** There is no fixed roster per workflow. Each research area the user keeps gets its own named specialist with a mascot from a fixed pool in area order, so an area keeps the same mascot across the team panel, the questions screen and its activity entries. The director and final reviewer keep their own mascots. Before a plan exists, the UI says specialists are chosen from the brief rather than showing placeholders.
- **Questions before research** use the existing card language: two summary cards (what Octo understood, the outcome it assumes), area chips with checkboxes, option chips per question with a free-text detail field, and one "anything else" box. Demo runs label their questions as illustrative.
- **Partial reports** use an amber banner distinct from errors, with a single Continue action and an optional note.
- **Dark mode** is generated, not hand-written: `scripts/build-dark-theme.mjs` maps every colour in the light stylesheets (neutrals to cool navy-tinted darks, light tints to dark tints, accent text lightened, primary fills kept) into `src/dark.css`. Charts, the ASCII scan and mascots read the active theme. System preference is the default.

## Evidence, grounded questions, versions and workspace memory (October 2026)

Octo's positioning moved from "runs research" to "research you can check and keep". The overview now has a "What a chat window can't do" section with six cards: asks first, checks its own citations, answers only from your research, keeps research current, builds on what you know, and survives limits and ships files.

- **Evidence** is a tab on every report. A strip above the report shows the result at a glance: "Evidence checked · 12 of 16 claims backed by their cited page · 2 to review", plus a score pill. The tab shows a score ring (green 75 and up, amber 50 and up, red below), filters by status, and one card per claim. Each card has a coloured left edge, a status badge, the check's note, the matching excerpt and the source link. Flagged claims sort first.
- **Ask** answers sit below a single input with suggested starter questions. Coverage badges say whether the research answered the question. Claim chips jump to the Evidence tab and highlight that claim. A gap row offers "Research this", which fills the follow-up box but does not start research by itself.
- **Versions** pairs "Refresh research" (with an optional focus) with a compare selector, change counts, source changes and a monospace line diff. Long unchanged stretches collapse.
- **Build on earlier research** appears in the research form only when related reports exist, as a tinted fieldset with checkboxes and the shared terms.
- The status colours (green, amber, red, grey, violet) carry into dark mode through the generated `dark.css`.

## Showcase pass (October 2026)

Same blue-and-white baseline and layout. Styles live in `src/showcase.css`, layered after `octo.css`, and feed the dark-theme generator.

- **Type:** Geist Variable for text and Geist Mono Variable for figures, labels and code (self-hosted via Fontsource). Headings use a tighter scale and balanced wrapping; numbers are tabular.
- **Copy says what Octo does:** "Research you can check" with "Octo researches your question, then opens every page it cites and marks which claims hold up." The hero describes the real process (director, one specialist per area, reviewer). Page titles are plain nouns; no all-caps eyebrows.
- **Overview tiles** (superseded by the checked-document pass below; `src/Bento.tsx` removed): the evidence check is the large tile because it is Octo's signature; the voice tile shows a sample exchange and opens the real assistant. Three smaller tiles cover asking first, community voices and Challenge. The remaining five capabilities are a plain text list, not cards. Example content is labelled as such.
- **Report summary strip:** Evidence (now a ledger bar, see below), Sources (count and source mix), Real voices and Versions; each cell opens its tab.
- **Claim marks (signature):** every checked claim is placed on the report line it came from (`src/claimPlacement.ts`, word and figure overlap; a claim whose figure is not on the line never matches) and gets a small numbered mark coloured by status. A mark opens the Evidence tab on that claim. At 1280px and wider a sticky margin strip listed the marks in reading order (now margin notes, see below) with the count to review; claims that could not be placed are counted there and left to the Evidence tab rather than pinned to the wrong sentence. Marks only show when the check ran on this exact report.
- **Legibility floor:** no text under 12px (uppercase labels 11px with tracking), secondary text in `#596070` (6.2:1 on white), inputs 16px on phones, every control 44px tall on touch screens. Measured with a DOM contrast scan across overview, report, Evidence, Connections and the research dialog in both themes at 1440, 834 and 390: 140 failing text styles before, 0 after.
- **Layout:** below 1024px the sidebar is a drawer behind the menu button (previously only below 760, and the desktop toggle did nothing); research rows become cards below 860px; report tabs scroll with a fading edge; the voice button shrinks to its icon so it covers less of the report.
- **Motion and decoration:** kept only where they carry meaning: the score ring fill, button press, hover lift on clickable cards, and the claim-mark flash when jumping from the margin strip. No load stagger, cursor spotlight, grain, glowing orb or gradient text. All motion is disabled under `prefers-reduced-motion`.
- **Dark mode (AMOLED):** the page, sidebar and top bar are true black. `scripts/build-dark-theme.mjs` maps white cards to charcoal panels, greys to a neutral family and light tints to deep tints; `src/amoled.css` adds lit top edges, visible borders, nested cards one step lighter, a flat navy hero and voice tile, and a flat blue for primary actions. Nothing glows.
- **Both themes:** sticky frosted top bar; reports at 14.5px with a 74-character measure, section dividers and rounded tables.

## Checked-document pass (October 2026)

Derived from Octo's own subject rather than SaaS defaults: a report going through fact-checking. References: Gwern (serif reading text with sidenotes), Making Software (cobalt technical drawings with mono callouts), Modern Treasury (process drawn as a schematic). The category's measured default (grotesk sans, bento grid) was the gravity this pass pushes against.

- **Reports read like documents.** Report paragraphs, list items and table cells use Source Serif 4 (optical sizes, self-hosted, `--serif`); headings and interface stay in Geist.
- **Claim highlights.** Each placed claim's exact sentence is underlined in its status colour: solid green (supported), solid amber (partly), wavy red (not found), dotted grey (could not check), wavy violet (no source). `src/claimNotes.tsx` builds DOM ranges and registers them with the CSS Custom Highlight API, so the report DOM React renders is untouched; browsers without the API keep the numbered marks only. `bestSentence` in `src/claimPlacement.ts` picks the sentence (numbers like "18.4" do not split sentences).
- **Margin notes.** At 1400px and wider, one note card per paragraph sits level with it (measured drift 0px on a 20-claim live report), listing that paragraph's claims with status and source host; overlapping cards are pushed down in reading order. Hovering a note row or a mark highlights its pair; clicking opens the claim in Evidence.
- **Evidence ledger.** The score ring is replaced by the score in mono and a bar with one segment per status, sized by count (unchecked claims hatched), with the full breakdown as the bar's accessible label.
- **Overview.** The navy hero card and the bento tiles are gone. The page opens on a blueprint-grid hero: the headline with "Start research" and "Say it instead" (opens the voice assistant), beside a labelled example report page showing highlights, marks, a ledger and margin notes. Below, Fig. 1 maps the process as one track of seven numbered stations, each marked by who acts (filled: Octo, outlined: you, tinted: both), with the research mascots at the Research station and a note on refresh and follow-up questions. Under 1100px the track turns vertical.

```
desktop · 1440
┌──────────────────────────────────────────────────────────────────────┐
│ RUNS ON GEMINI OR OPENAI ──     ┌ example report page ──────┐ ┊ 1 ✓  │  blueprint grid
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ (h1)           │ ▬▬▬▬▬▬▬▬ ledger     38/100│ ┊ 2 ◐  │
│ ░░░░░░░░░░░░░ lede              │ ░░░ claim¹ ░░ claim² ░░░  │ ┊ 3 ✕  │  margin notes
│ ( Start research ) [🎙 Say it]  │ ~~claim³~~ ~~claim⁴~~     │ ┊ 4 ?  │
│                                 └───────────────────────────┘        │
├──────────────────────────────────────────────────────────────────────┤
│ FIG. 1 ──  How a report gets made          ● Octo ○ You ◍ Both       │
│ (01)──(02)──(03)──(04)──(05)──(06)──(07)   one track, 7 stations     │
│ Brief Questions Plan Research Report Check Challenge                 │
└──────────────────────────────────────────────────────────────────────┘

report · 1400+
┌ ledger: 50/100 ▇▇▒▒▒▒▒▒▒▒▒▒▇ ┬ Sources ┬ Voices ┬ Versions ┐
│ serif text, claim sentence underlined ① ② ③   ┊ ┌ 1 ◌ Could not check │
│                                              ┊ │ 2 ✓ Supported       │  level with paragraph
│ next paragraph ④                             ┊ └ …                  │
└──────────────────────────────────────────────┴──────────────────────┘

phone · 390: hero stacks (copy, specimen, notes in 2 columns); Fig. 1 is a
vertical track with nodes on the left; reports keep inline marks and highlights.
```

### Difference section (Fig. 1)

Between the hero and the process map, "Not another way to ask a model" answers how Octo differs from a search engine and an AI chat with search, without reading as a wrapper. A five-step schematic separates the one swappable part (the model, drawn dashed like a slot) from what Octo runs itself (your plan, its own fetcher, the figure and wording comparison, the marks in the text), and the caption states plainly what the model does (lists claims, with a rule-based fallback) and what Octo's code decides (the verdicts). A comparison ledger follows: seven research questions, three columns, Octo's column tinted with a blue rule and written as mechanisms, not adjectives. On phones each question is a card with Octo's answer first. The process map is now Fig. 2.
