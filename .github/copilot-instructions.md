# NDVItoTaskmap — Mirror & Sync Instructies

Dit project wordt ontwikkeld in `d:\GIT\AZ_dilab-prod\showcases\NDVItoTaskmap`
en gespiegeld naar `D:\GIT\NDVItoTaskmap`.

## Verplichte taken bij elke wijziging

1. **README bijwerken** — Werk na elke functionele wijziging de `README.md` bij:
   - Nieuwe features toevoegen aan de functielijst.
   - Gewijzigde exportformaten of stappen in de workflow updaten.
   - Datum, versie of links waar nodig actualiseren.
   - **Zowel NL- als EN-sectie** consistent houden.

2. **CHANGELOG bijwerken** — Houd de `CHANGELOG.md` in de bron bij met een
   beschrijving van wat er is gewijzigd, onder een `## [Unreleased]`-kop.

3. **Synchoniseer naar de mirror** — Voer na het voltooien van wijzigingen in de bron dit
   PowerShell-commando uit om de mirror synchroon te houden:
   ```powershell
   robocopy "d:\GIT\AZ_dilab-prod\showcases\NDVItoTaskmap" "D:\GIT\NDVItoTaskmap" /E /COPY:DAT /R:2 /W:2 /NP /NDL /XO
   ```
   > `/XO` (eXclude Older) zorgt dat alleen nieuwere bestanden van bron naar mirror worden gekopieerd.

4. **Mirror README & CHANGELOG bijwerken** — Als de README of CHANGELOG zijn gewijzigd,
   werk ze dan ook bij in de mirror via bovenstaande sync (robocopy doet dit automatisch).

---

# Karpathy-Inspired Copilot Guidelines

Behavioural guidelines to reduce common LLM coding mistakes, derived from [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls. Source: [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: *"Would a senior engineer say this is overcomplicated?"* If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: *Every changed line should trace directly to the user's request.*

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
