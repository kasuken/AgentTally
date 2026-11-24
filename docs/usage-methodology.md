# Local usage and estimates

AgentTally reads retained local logs, not account billing APIs. All history stays on
this device. Usage and Impact independently request the same local `usage_summary`;
neither needs the live scanner, its filters or its 24-hour discovery window.
Nothing is sent to a server, and no upstream package is installed or invoked.
Browser previews cannot read history; `usage.html?demo` and `impact.html?demo`
explicitly use invented data. The two workspaces share a reporting period: their
links carry `days=1`, `7` or `30` and keep the current `demo` or `live` flag.

## Periods and coverage

Today starts at the operating system's local midnight. Seven and thirty days include
today plus the previous six and twenty-nine **calendar dates**, not fixed multiples
of 24 hours. Calendar arithmetic and OS timezone rules preserve daylight-saving
boundaries. Ambiguous midnight uses its earliest instant; a skipped midnight uses
the first valid minute. Events use their logged timestamp, never file modification
time. Changing the system timezone changes date attribution on the next query.

An independent Rust thread discovers eligible logs and imports bounded batches
(at most 512 JSONL records or approximately 2 MiB per file per pass). It uses the
same normalized accounting parser as live ingestion; it never sums snapshots or
publishes historical observations as live events. JSON documents are reconciled
atomically and limited to 16 MiB. A record is limited to 2 MiB and a parser checkpoint
to 4 MiB; breaches are explicit import errors, not silently truncated counts.
Unfinished JSONL lines wait for the next append. Invalid complete lines and oversized
frames are skipped and counted; oversized frames are discarded in bounded chunks
across passes so later records can still import. Invalid document rewrites preserve
the previous committed index.

The app-owned `usage-v1.sqlite` database uses WAL so queries and indexing do not
block live scanning. Each source checkpoint stores an offset, metadata, boundary
fingerprint and parser reconciliation state. Append reads resume at that offset.
Truncation, document rewrites and detected boundary/metadata changes replay the
source, replacing observations by stable source/observation key. Refinements replace
counts, tool starts deduplicate independently, and retractions delete superseded
rows. Same-file-length rewrites replay when modification time changes. Append
detection checks the first and last 512 consumed bytes: unusual in-place edits
entirely between those boundaries combined with an append cannot be detected from
these checkpoints; restart alone does not force a full rebuild.

Expired observations are deleted after each pass; only the last thirty local
dates are queried. Checkpoints retain minimal older identifiers/cumulative
watermarks while a source is still eligible: these are necessary to prevent an
old response refinement or resumed cumulative session being charged as new usage.
Old inactive source checkpoints are deleted. No prompts, code, arguments,
responses, session titles or raw log records are stored. Source paths are replaced
by deterministic opaque fingerprints; models and categorized tool names come from
the normalization boundary. Debug builds honor `AGENT_TALLY_FIXTURE_ROOT` and keep
the database under that fixture's `app-data`, isolated from real app history.

Import coverage lists indexed/pending/activity-only files, files with no retained
usage, malformed records and errors. Missing token fields and explicitly partial
records are counted. The earliest usage date is **not** proof that earlier dates
had zero activity. Logs may have been deleted, rotated, inaccessible, or never
written. Model/provider shares describe indexed reported tokens only.

## Accounting

- Claude repeats/refines messages: stable message IDs replace previous usage.
- Codex cumulative usage becomes per-observation deltas with persisted watermarks.
- Gemini documents are replayed as complete snapshots.
- Copilot per-call usage is reconciled with shutdown cumulative residuals.
  Residuals are attributed to shutdown/report time and counted separately in coverage.
- Verified VS Code saved usage fields are accepted; scalar prompt-only counts stay
  partial. Unsupported/unverified formats contribute no inferred tokens.
- Only tool starts count. Tool results do not increment counts.

Fresh input excludes reported cache reads/writes when the provider includes them
in input. If cache-inclusive input has no reported read split, its unresolved
portion remains unclassified and is not priced as fresh input. Codex does not
report a separate cache-write class. Inconsistent cache counts larger than inclusive
input are clamped to input and marked partial. Separate Gemini tool-prompt tokens join
fresh input. Reasoning tokens join output only when the provider says they are
separate; a known reasoning-only subtotal remains available and partial when output
is missing. TTL-specific cache writes are
subsets, never extra tokens. A reported total with incomplete classes contributes
the nonnegative remainder to **unclassified** tokens. Unclassified tokens have no
cost or footprint estimate. Missing fields are never estimated from text.

## Offline API-equivalent pricing

Version **standard-usd-2026-11-24**, USD per million tokens, standard API rates
retrieved 2026-11-24. The exact bundled table is in
`ui/js/usage-estimates.js`. Matching strips known vendor prefixes and dated
snapshots; it does not guess the price of an unknown model or suffix.

Sources:

- [Anthropic official pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [OpenAI official pricing](https://developers.openai.com/api/docs/pricing)

`cost = (freshInput * inputRate + output * outputRate +
cacheRead * cacheReadRate + cacheWrite * writeRate) / 1,000,000`.
Claude writes use the five-minute rate unless an explicit one-hour subdivision is
reported, in which case that subdivision uses twice the base input rate. API models
without a sourced cache-write rate omit that class and reduce priced coverage.
Cache-inclusive input is normalized **before** pricing.

These are API-equivalent estimates, **not bills**: subscriptions, Copilot credits,
Auto discounts, batch/flex discounts, geographic premiums, context-length premiums,
taxes, service/tool fees, negotiated contracts and historical price changes are not
modeled. Unknown models and unclassified counts are excluded. UI coverage shows
the priced known subtotal and its token denominator; it never fills unknown
models with a fabricated price. Rates are bundled, not fetched at runtime.
The Usage workspace shows this subtotal. Prices play no role in the energy,
emissions or cooling-water calculation.

## Environmental factors

Version **carbonbit-style-1.1.0**, adapted from CarbonBit methodology 1.1.0
(effective 2026-10-03), not measured energy. Factors are low-confidence assumptions:

```
weightedInput = freshInput + cacheRead * 0.1 + cacheWrite
energyWh = (weightedInput * 0.00015 + output * 0.0006) * classMultiplier
emissionsGramsCO2e = energyWh / 1000 * 480
onSiteCoolingWaterMl = energyWh * 1.1
```

Small model names (Haiku, mini, nano, Flash, Luna) use 0.25x; frontier names
(Opus, Fable, Mythos, Astra) use 3x; other known names use the medium 1x anchor.
Class membership is a visualization/modeling assumption, not a scientific hardware
classification. The bundled classifier recognizes price-table entries and
`gemini-` model names; recognition for footprint modeling does not imply a price.
Unknown models use the medium generic anchor, explicitly counted
in generic coverage. Unclassified counts are excluded. Missing classes produce
only a labeled known subtotal, not a whole-request claim.

The Impact report applies each model's multiplier to each of its four classified
token counts before summing. Its energy band divides that same subtotal by token
class; the model table ranks contributions to that subtotal, not model
efficiency. For example, 1,000 reported output tokens at the small 0.25× factor
contribute 0.15 Wh, the same modeled energy as 1,000 fresh input tokens at 1×.
Carbon and cooling water are conversions of the unrounded energy subtotal, not
separate measurements. Values display at up to two significant digits, switching
from Wh/g/mL to kWh/kg/L at 1,000. An absent class is not shown as a measured
zero; if there are no positive classified counts, no footprint is displayed.

The anchor infers per-token energy from a roughly 0.3 Wh query with 500 output
tokens, assumes a 4:1 output/input energy ratio, and includes data-center overhead.
The cache-read discount and class multipliers are assumptions. Global grid intensity
is 480 g CO2e/kWh; on-site cooling is 1.1 L/kWh. Actual region, time, hardware,
batching and caching are unknown. Training, hardware embodied emissions, user-device
energy and electricity-generation water are excluded. No yearly extrapolations
or offset claims are made.

Sources:

- [CarbonBit methodology](https://github.com/kasuken/vscode-carbonbit/blob/main/docs/METHODOLOGY.md)
- [Epoch AI, How much energy does ChatGPT use? (2025)](https://epoch.ai/gradient-updates/how-much-energy-does-chatgpt-use)
- [Google, Measuring environmental impact at Google scale (2025)](https://arxiv.org/abs/2508.15734)
- [Ember, Global Electricity Review 2024](https://ember-energy.org/latest-insights/global-electricity-review-2024/)

Token totals are stored, not precomputed estimate amounts. Current bundled versioned
tables are applied at query presentation, so a future table update intentionally
recalculates the same retained history; versions are available in the methodology
disclosure alongside detailed import coverage.

### Everyday comparisons

The Impact page divides each **unrounded known subtotal** by a reference amount
from [CarbonBit methodology 1.1.0](https://github.com/kasuken/vscode-carbonbit/blob/4f4cab14c1cd6baf5a12860c7409926cc87cf02d/docs/METHODOLOGY.md#everyday-comparisons-v110).
Alternatives within a row describe the same footprint; they are not additive.
They do not represent actual trips, household consumption, or avoided emissions.
When no footprint can be estimated, no comparison is displayed.

| Footprint quantity | References used for comparison |
| --- | --- |
| Inference energy (Wh) | A 10 W lamp uses 10 Wh per hour by definition; [19 Wh per phone charge](https://www.epa.gov/energy/greenhouse-gas-equivalencies-calculator-calculations-and-references); [120 Wh per litre boiled](https://www.energimyndigheten.se/globalassets/energieffektivisering_/lagar-och-krav/ekodesign--energimarkning/ecodesign_kettles_task_3_20201218_v27_final.pdf). |
| Emissions (g CO₂e) | [UK 2025 conversion factors](https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2025): 162.72 g per petrol car-km (tailpipe only), 35.46 g per national rail passenger-km, or 125.76 g per short-haul economy passenger-km including radiative forcing. These comparisons exclude fuel production. |
| On-site water (mL) | A 250 mL mug (CarbonBit assumption); [8.4 L per shower minute](https://www.epa.gov/sites/default/files/2017-01/documents/ws-products-support-statement-showerheads.pdf); [50 L per washing machine load](https://www.ccw.org.uk/save-money-and-water/averagewateruse/). |

## Attribution and licenses

[AI Engineering Fluency](https://github.com/rajbos/ai-engineering-fluency)
inspired period/model breakdowns and offline API-equivalent pricing.
[CarbonBit](https://github.com/kasuken/vscode-carbonbit) inspired token-class
weighting, confidence and energy-to-carbon/water conversion. Both repositories'
MIT licenses were reviewed. No source code or visual assets were copied; the
CarbonBit factor methodology is adapted and attributed above.

CarbonBit's MIT notice is retained for the adapted factor methodology:

> MIT License. Copyright (c) 2026 kasuken.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.
