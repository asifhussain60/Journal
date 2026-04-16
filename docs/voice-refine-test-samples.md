# Voice Refine — Test Sample Battery

Paste each sample into the Voice Refine drawer's raw-entry pane and hit Refine. Each
sample targets a specific fingerprint rule. If the refined output fails the "expected
behavior" check, the fingerprint (or the /api/refine instruction block) likely needs
tuning for that rule.

Samples are ordered easy → hard. Start at #1, work down.

---

## 1. Therapy jargon stress test

**Raw:**
> I finally set boundaries with my toxic parent. Their gaslighting triggered me constantly and I had to honor my inner child by embracing my truth. It's been a healing journey.

**Expected behavior:** Every prohibited word gone (boundaries, toxic, gaslighting, triggered, inner child, embrace my truth, healing journey). Short declarative sentences replacing the slogan chain. Probably 2-3 sentences, not 1 long one.

---

## 2. Corporate AI-speak

**Raw:**
> At the end of the day, I had to lean into the discomfort and unpack what was really going on. In many ways, moving forward meant navigating some difficult conversations. It's worth noting that this was a pivotal moment.

**Expected behavior:** Every idiom stripped (at the end of the day, lean into, unpack, in many ways, moving forward, navigating, it's worth noting, pivotal moment). Replaced with plain statements. Should feel colder, cleaner, older.

---

## 3. Melodrama

**Raw:**
> My heart shattered when she walked out. The world crumbled around me. I was drowning in despair, lost in an ocean of grief. Everything I had built fell apart in a single devastating moment.

**Expected behavior:** No shattering, drowning, oceans, devastation. The feeling is preserved but understated. Probably shorter. May lean into the "stay in the pain for a beat" rule — just sit with the fact rather than describe the fall.

---

## 4. Adjective inflation (the Pho House test)

**Raw:**
> Ishrat and I had the most incredible dinner at Dishoom. The food was absolutely amazing, the atmosphere was breathtaking, and the service was unbelievably attentive. It was honestly one of the best nights we've had in ages.

**Expected behavior:** Adjectives deflate or disappear. "Incredible/amazing/breathtaking/unbelievably" gone. Specifics may surface ("She ordered the bhel" kind of detail — but only if Claude can infer, otherwise short praise). Ishrat must be named (not "my wife"). Should be noticeably shorter.

---

## 5. Already in voice (no-op test)

**Raw:**
> I did not argue. He had said his piece and I had said mine and there was nothing left to say. I went upstairs. The stairs felt longer than usual.

**Expected behavior:** Output should be nearly identical, possibly verbatim. If Claude rewrites this heavily, the refiner is over-reaching. This is the primary **regression test** — confirms the system doesn't damage good prose.

---

## 6. Long and rambling

**Raw:**
> So I was thinking about Babu the other day, and how he used to do this thing where he would come home from work and he wouldn't really say anything for like the first hour or so, he would just sit in his chair and read the newspaper or watch the news or whatever, and at the time I thought he was just being distant or aloof or whatever but now that I'm older I think maybe he was just exhausted and needed to decompress and didn't know how to talk about that.

**Expected behavior:** One run-on sentence becomes several short ones. "Like/or whatever/whatever" filler words stripped. The insight at the end ("didn't know how to talk about that") is preserved but arrives more quietly. Probably 4-6 sentences, not one.

---

## 7. Fact preservation test

**Raw:**
> In 1993 my cousin Anwar got married in Karachi. Uncle Riaz flew in from Dubai for the wedding. The mehndi was at our house on Friday, the nikah was at the Pearl Continental on Saturday, and Anwar's wife Farzana moved to Lahore with him two weeks later.

**Expected behavior:** Every name (Anwar, Riaz, Farzana), place (Karachi, Dubai, Pearl Continental, Lahore), date (1993, Friday, Saturday, two weeks later) preserved exactly. Voice may tighten slightly but NO invented details. If Claude adds anything — a feeling, a scene, a reaction — the "preserve every fact, do not invent" rule is leaking and needs strengthening in refine.js.

---

## 8. Real-world journal scratchpad (the honest test)

**Raw:**
> Today was weird. Got up late, Ishrat was already downstairs making coffee. We didn't really talk much which isn't like us but I think we were both just tired from yesterday. Went to the market. Bought salmon. Had a small argument about the car situation again but nothing serious. I keep thinking about what Dad said last Sunday about not waiting. I don't know what to do with that yet.

**Expected behavior:** This is what a real quick DayOne entry looks like. Should get voice-tightened without losing the specifics (Ishrat, coffee, salmon, the car conversation, "Dad last Sunday"). "Dad" should ideally become "Babu" per the nomenclature rule (though this isn't in the fingerprint file — note if it stays as "Dad", that's a fingerprint gap to fix). Probably shortens by 20-30% without losing facts.

---

## What to do with failures

If any sample fails its expected behavior:

1. Copy the raw input, the actual refined output, and what you expected into a new file like `docs/voice-refine-failures-2026-04-15.md`.
2. Tell me which sample failed and what went wrong.
3. We either (a) strengthen the fingerprint in `reference/voice-fingerprint.md` (no code change, 5-second cache reload) or (b) strengthen the instruction block in `server/src/refine.js` (requires proxy restart via `launchctl kickstart -k gui/$(id -u)/com.asif.babu-journal-proxy`).

Fingerprint changes are almost always the right first move. Only touch the instruction block if the rule belongs there (e.g., output format, length limits) rather than in voice itself.
