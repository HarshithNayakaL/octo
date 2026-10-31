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

Same blue-and-white baseline and layout; the pass adds depth, motion and a clearer story. Styles live in `src/showcase.css`, layered after `octo.css`, and feed the dark-theme generator.

- **Type:** Geist Variable for text and Geist Mono Variable for figures, labels and code (self-hosted via Fontsource), replacing Inter. Headings use a tighter scale, negative tracking and balanced wrapping; numbers are tabular.
- **Surfaces:** ink is a navy-tinted near-black (`--ink`), shadows are navy-tinted (`--shadow-sm/md/lg`), and the overview hero is a navy panel with layered radial light and a CSS-only grain overlay. The research diagram inherits the panel colour through `currentColor`.
- **Overview bento** (`src/Bento.tsx`) replaces the six equal cards. Two large tiles show the signature features working: an example evidence check (score ring that fills on load, four claims with statuses) and the voice assistant (orb, sample exchange, a button that opens the real assistant). Three smaller tiles cover asking first, community voices and Challenge; a strip lists the remaining five capabilities. Example content is labelled as such.
- **Report trust strip** replaces the single evidence line above a report: Evidence (score ring and claims backed), Sources (count and a mix bar of official, news and weak sources), Real voices (themes and posts) and Versions. Each cell opens its tab. On phones the evidence cell spans the full row.
- **Tabs and panels:** Evidence, Voices and Versions tabs carry their own accent underline; their panel headers take matching soft tints (green, violet, amber; Ask in blue).
- **Motion:** dashboard sections rise in with a short stagger, cards lift on hover, buttons press on click, and the score rings animate through an `@property` custom property. All of it is disabled under `prefers-reduced-motion`.
- **Dark mode:** generated as before, with overrides so the navy hero and voice tile keep white text and the selected chip keeps contrast.
