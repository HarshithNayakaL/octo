# Why people struggle with AI research tools, and what Octo does about it

October 2026. This note records the user research behind Octo's features, so later product decisions can build on it.

## Method

- **Community posts.** We collected 3,314 public posts and comments from Reddit (through the PullPush archive) and Hacker News (through the Algolia API), all from 2024 to 2026. We used 24 searches about deep research, AI search, citations, Perplexity, ChatGPT, Gemini and Claude. After filtering for posts in relevant communities that mention a research tool and a specific complaint, 301 remained, and we read them by theme.
- **Published studies and reporting.** We also read studies and reporting on the reliability of AI search and deep research.
- **Limits.** Vocal forum users are not a representative sample, and the counts below only show which complaints recur. Treat them as direction, not market size.

## What people struggle with

| Pain | How often it came up (of 301) | Typical words |
|---|---|---|
| Made-up or unsupported claims | 101 | "hallucinates a lot … tiring to double-check everything" |
| Checking sources by hand | 58 | "for anything I'd put my name on, I find myself re-checking sources" |
| SEO pages and blogs treated as evidence | 42 | "citing SEO-bait as a primary source" |
| Generic, long, surface-level reports | 38 | "overly verbose" |
| One-sided answers, contradictions smoothed over | 26 | "I want an AI that gives me all relevant positions" |
| Paywalled or specialist sources out of reach | 25 | "legal texts are surprisingly paywalled" |
| Outdated information | 11 | "much of its information is outdated" |
| No way to read what real people say | recurring | "Claude doesn't have access" (to Reddit) |

Representative posts:
- [r/perplexity_ai: "how do you verify the answers?"](https://reddit.com/r/perplexity_ai/comments/1x32s0m/for_people_using_perplexity_for_serious_research/)
- [r/ChatGPTPro: deep research outdated and hallucinating](https://reddit.com/r/ChatGPTPro/comments/1wb20ut/any_gemini_deep_research_alternative/p8pm3s0/)
- [r/perplexity_ai: "two models agree … two confident guesses shaking hands"](https://reddit.com/r/perplexity_ai/comments/1wu6iix/i_still_has_a_habit_of_using_free_perplexity_as/pd3kpb7/)
- [Hacker News: gathering Reddit comments about a vendor](https://news.ycombinator.com/item?id=49741488)
- [r/singularity: legal research is paywalled and the search terms are too narrow](https://reddit.com/r/singularity/comments/1w914qw/openai_ai_agents_now_perform_31/p87vlgy/)
- [Hacker News: wanting all relevant positions](https://news.ycombinator.com/item?id=48666138)

## What the studies say

- **Liu, Zhang and Liang (Findings of EMNLP 2023), four generative search engines:** only 51.5% of sentences were fully supported by their citations, and 74.5% of citations supported the sentence they were attached to. [arXiv 2304.09848](https://arxiv.org/abs/2304.09848)
- **Tow Center for Digital Journalism, Columbia (March 2025), eight AI search tools:** asked to identify a news article's source, the tools were wrong more than 60% of the time and rarely signalled uncertainty. [Nieman Lab](https://www.niemanlab.org/2025/03/ai-search-engines-fail-to-produce-accurate-citations-in-over-60-of-tests-according-to-new-tow-center-study/)
- **DeepTRACE (Salesforce AI Research and Microsoft Research, ICLR 2026):** deep research agents cite thoroughly, but stay one-sided on debate questions and leave many statements unsupported by their own sources. Citation accuracy ranged from 40% to 80%. [arXiv 2509.04499](https://arxiv.org/abs/2509.04499)
- **A 2026 preprint on citation URLs:** 3–13% of URLs cited by models and agents were hallucinated, and deep research agents hallucinated URLs more often than search-augmented models. [arXiv 2604.03173](https://arxiv.org/pdf/2604.03173)
- **Search quality:** a study of 7,392 product-review queries found that affiliate and SEO spam degrades Google, Bing and DuckDuckGo results. [The Register](https://www.theregister.com/2024/01/17/google_search_results_spam)
- **Who checks:** a survey summarised in a press release found that nearly 80% of Americans make decisions based on AI, but only 17% consistently check the answers. [National Law Review press release](https://natlawreview.com/press-releases/nearly-80-americans-make-decisions-based-ai-only-17-consistently-check)

## Where Octo differs

General assistants already search, ground answers and cite links. Octo should not compete on "it can research". It competes on the work around research that people still do by hand.

| Problem | Octo feature |
|---|---|
| Checking sources by hand | **Evidence check:** Octo opens every cited page and PDF, marks each claim, and scores the report |
| SEO pages and blogs as evidence | **Source quality map and source policy:** sources labelled by kind and date, blogs and review sites flagged, primary-first mode, trusted and blocked domains |
| One-sided answers | **Balanced by default, plus Challenge this report:** a counter-evidence pass that revises the report and records each challenge's verdict |
| Cannot read real people | **Community voices:** Reddit and Hacker News themes with verbatim, linked quotes, optionally given to the research agent |
| Outdated information | Dates on every checked source with stale flags, Refresh with a "what changed" view, scheduled checks |
| Generic reports | Questions before research, plan areas per brief, and Ask answers only from the report |
| Lost work | Partial reports that continue into one report, versions, and building on earlier research |

## Next candidates

- **Bring your own library.** Paywalled and specialist sources (law, medicine, finance) came up repeatedly. A workspace library of uploaded PDFs and notes, searched alongside the web with the same evidence check, would serve those users.
- **Rendering pages that need JavaScript.** Many official statistics pages (for example NPCI) return no text without a browser, so the evidence check marks them "Could not check". A headless rendering fallback would close that gap.
- **Disagreement map.** Show competing claims side by side with their sources, not only in the Challenge section.
- **Official Reddit API.** Reddit content currently comes through a third-party archive that can lag. An optional official API key would make it current and dependable.
