---
status: DRAFT — human publishes
note: Copy affinity.png, popularity.png, ladder.png from
  /Users/saurabh/code/motionvector/media-scratch/code-to-3d-charts/
  into ./charts/ alongside this post before publishing.
---

# Title options (pick one)

1. Web 3D is a monopoly, and agents don't mind
2. Agents fly where humans suffer: a backend census and a week of receipts
3. The commit is not the check: what 467 agent sessions actually bought

# Body

Web 3D is a monopoly. One library holds nearly all the mindshare, and everyone
else fights over the remainder. That sounds like a complaint. It is not. It is
the starting condition for everything that follows.

![Web 3D mindshare: Three.js 113k stars vs PlayCanvas 16k, log scale](./charts/popularity.png)
*Fig. 1 — GitHub stars for the two web-tracked backends (log scale).
Three.js 113k vs PlayCanvas 16k, verified September 2026. The other eight
backends in our census are not web-tracked, so they have no bar here — that
absence is itself data.*

A monopoly simplifies the agent's job. Fewer targets to learn. Deeper training
footprint on the one that matters. More examples of every failure mode ever
committed to a public repo.

Which raises the real question: easy for whom? We scored ten backends twice —
once for human ease, once for agent affinity — on a 1–5 scale. The two rankings
do not agree, and the disagreements are the interesting part.

![Human ease vs agent affinity across ten backends](./charts/affinity.png)
*Fig. 2 — Human ease (5 = gentle) vs agent affinity (5 = native format plus
training footprint) for ten backends. Scores are author-scored, not measured —
treat them as an argument, not a reading.*

Three.js tops both lists. No surprise: gentle for humans, native for agents.
Blender is the split that matters. Humans rate it a 2 — a cliff of hotkeys and
modes. Agents rate it a 4. Blender's Python API is scriptable, deterministic,
and extremely well represented in training data. The thing humans suffer through
is the thing agents fly over. Houdini shows the same pattern in reverse order
of magnitude: brutal for humans (1), workable for agents (3) because procedural
node graphs serialize cleanly into text.

The commercial tools cluster at the bottom of both scales. Maya, C4D, Unreal —
expensive, GUI-bound, thinly represented in public code. Agents cannot click
their way out of a proprietary interface any better than you can script one.

So the census says: agents do best where the interface is text, scriptable, and
publicly documented. Web 3D's monopoly happens to satisfy all three.

## The money finding

Then we looked at what agents actually do with that affinity. One week of
Agentworth data: 467 sessions, roughly $4.5k in list-price spend. Sessions were
graded onto an evidence ladder — r0 (unflown, no outcome evidence) up through
r2 (artifact changed), r3 (test passed), r4 (commit observed), r5 (CI green).

![Sessions vs spend per evidence rung](./charts/ladder.png)
*Fig. 3 — One Agentworth week: 467 sessions, ~$4,480 list-price. Bars are
sessions (left axis) and cost in USD (right axis) per rung. r4 — commit
observed — takes 222 sessions and $3,546, about 79% of spend.*

Read the chart from right to left. 190 sessions never flew at all — no outcome
evidence — costing $260. Only 7 sessions reached r5, full CI green. And the
mass of everything sits at r4: 222 sessions, $3,546, some 79% of the week's
spend, all resting on "a commit was observed."

A commit is assumed, not checked. It says code was written down, not that it
works. The rung above it — a passing test — holds 12 sessions. The rung above
that holds 7. The headline number, $17.59 per verified outcome, is the price of
that gap: most of the money buys the appearance of done.

This is not an argument against agents. It is an argument about where the loop
is open. The generation step works. The verification step is where the spend
goes unverified — literally. Sessions end at the commit because nothing in the
loop demands the next rung.

## Closing the loop

That is what zero-vision is for. It reads the rendered frame as text — OCR,
contact sheets, title cards, clipped headlines — without sending pixels to a
frontier vision model, and it does it on the same machine that ran the agent.

The idea is small on purpose: after the commit, look at what was made, and say
what it says. A render that fails its own caption gets caught at r2 cost, not
r4 prices. The loop closes by one rung at a time.

*Zero-vision is a local-first screen reader for agent renders: OCR and frame
description on-machine, no pixels off the box. Details in the repo README.*
