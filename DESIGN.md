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
