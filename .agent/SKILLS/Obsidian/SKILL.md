---
name: obsidian-ai-brain
description: >
  Use this skill whenever the user works with an Obsidian Desktop vault as a
  project "AI Brain" or "Business Model" knowledge base inside OpenCode — reading
  it for context, adding new information to it, scaffolding a new project inside
  it, or asking questions like "what's in the brain for X", "update the vault
  with...", "ضيف المعلومة دي فى ملفات المشروع", "افتح البرين بتاع فلان", or
  mentioning a project's Obsidian folder by name. Always consult this skill
  before reading or writing any file inside a tracked Obsidian vault — don't just
  grep the folder blind.
---

# Obsidian AI Brain — per-project knowledge base for OpenCode

Turns a local Obsidian Desktop vault into a persistent, navigable "brain" for
each project the user works on. One vault, many projects, each project a
folder. No database, no GraphQL server, no MCP dependency — the "graph" IS
Obsidian's own native `[[wikilink]]` / backlink system. OpenCode just reads and
writes plain markdown files on disk; Obsidian Desktop renders the same files
as a graph view for free.

The core problem this solves: dumping an entire project folder into context
on every task kills accuracy (too much irrelevant text) and burns tokens. This
skill instead teaches the agent to enter through one gateway file and only
*follow the links that matter for the current task* — a targeted graph
traversal instead of a full read.

---

## 1. Vault layout

```
<VaultRoot>/
  _VaultMap.md                 <- index of every project in this vault
  <project-slug>/
    <project-slug>.md          <- gateway file: entry point / table of contents
    01-overview.md
    02-product.md
    03-market-customers.md
    04-tech-stack.md
    05-competitors.md
    06-growth-marketing.md
    07-operations.md
    08-finance.md
    09-decisions-log.md
  <another-project-slug>/
    ...
```

- **One folder per project**, named with a slug (lowercase, hyphens — e.g.
  `woops-cc`, not `Woops CC!!`). This is how the agent finds the right project
  when the user mentions its name.
- **The gateway file shares the folder's name** (`woops-cc/woops-cc.md`). It is
  always the first and only mandatory read.
- **Category files** are numbered only for human sorting in the Finder/Explorer
  and Obsidian's file tree — the numbers are cosmetic and never appear inside
  `[[wikilinks]]` (link to `[[02-product]]`, not `[[Product]]`, unless you
  rename the file to match).
- The **9-category taxonomy above is a default**, modeled loosely on a
  business-model breakdown. It's a starting point, not a rule — add, rename, or
  drop categories per project as the user's work actually shapes up. Don't force
  content into a category that doesn't fit; create a new file instead.

## 2. `_VaultMap.md` — top-level index

```markdown
---
type: vault-map
updated: 2026-07-26
---

# Vault Map

- [[woops-cc/woops-cc|woops.cc]] — AI customer support platform (WhatsApp/Messenger/Instagram)
- [[project-b/project-b|Project B]] — one-line description
```

Read this first only when the target project isn't obvious from what the user
said, or to confirm a project exists before creating a duplicate.

## 3. Gateway file format (`<slug>/<slug>.md`)

```markdown
---
type: gateway
project: woops-cc
tags: [brain, project]
updated: 2026-07-26
---

# woops.cc — AI Brain

## One-line summary
AI-powered customer support platform across WhatsApp, Messenger, and Instagram.
Solo-built. Currently focused on COD verification / social-commerce expansion.

## Map
- [[01-overview]]
- [[02-product]]
- [[03-market-customers]]
- [[04-tech-stack]]
- [[05-competitors]]
- [[06-growth-marketing]]
- [[07-operations]]
- [[08-finance]]
- [[09-decisions-log]]
```

Keep the one-line summary honest and current — it's the single most
context-dense sentence in the whole vault and often all that's needed for a
quick question.

## 4. Category file format (e.g. `04-tech-stack.md`)

```markdown
---
type: category
project: woops-cc
category: tech-stack
tags: [tech-stack]
related: [[02-product]], [[07-operations]]
updated: 2026-07-26
---

# Tech Stack

<content — freeform notes, decisions, specifics>

## Related
- [[02-product]] — the stack decisions this enables
- [[07-operations]] — who runs/maintains what
```

The `related:` frontmatter list **is the graph**. It's what Obsidian's graph
view draws from, and it's what the agent should follow instead of guessing.
Every time content in one file meaningfully connects to another, add the link
in both directions (in both files' `related:` list and under `## Related`) so
the backlink graph stays accurate on both sides.

## 5. How the agent should actually use this (the traversal logic)

1. **Locate the project.** Match the folder/slug against what the user said.
   If it's ambiguous or the project might not exist yet, read `_VaultMap.md`
   first rather than guessing a path.
2. **Enter through the gateway, always.** Read `<slug>/<slug>.md` before
   anything else. This alone often answers "what is this project" or "give me
   the summary" — stop there if it does.
3. **Traverse only what the task needs.**
   - Narrow question (pricing, stack, a competitor) → read the one matching
     category file, then only the files listed in its `related:` frontmatter —
     not the whole folder.
   - Broad request ("give me the full picture") → read the gateway + every
     first-level category file, but still don't cascade into second-level
     `related:` files unless the answer actually needs them.
   - Never `cat` or `grep -r` the entire project folder into context as a first
     move — that's the exact blind-read this skill exists to avoid.
4. **Writing new information:**
   - Decide which existing category it belongs to. If none fits, create a new
     numbered file and add it to the gateway's `## Map`.
   - Append inside that file's body — don't pile everything into the gateway.
   - Bump that file's `updated:` frontmatter date.
   - If the new info changes the shape of the project, update the gateway's
     one-line summary too.
   - If it connects to another category, add the link both ways as described
     in §4 above.
5. **New project setup:** ask the user for (a) the vault root path — only once,
   then remember it for the session — (b) the project name/slug, and (c)
   whether to use the default 9-category taxonomy or a custom one. Then
   scaffold the folder, gateway file, and empty category files with frontmatter
   pre-filled.

## 6. Useful commands

```bash
# Find a project folder by (partial) name
find "<VaultRoot>" -maxdepth 1 -type d -iname "*woops*"

# Always read the gateway first
cat "<VaultRoot>/woops-cc/woops-cc.md"

# What links TO a given file (backlinks) — mirrors Obsidian's own backlink pane
grep -rl "\[\[04-tech-stack\]\]" "<VaultRoot>/woops-cc/"

# Filter by category/tag in frontmatter before reading full content
grep -rl "^category: finance" "<VaultRoot>/woops-cc/"

# List every project currently in the vault
find "<VaultRoot>" -maxdepth 1 -type d ! -path "<VaultRoot>"
```

- Vault => /Users/ceo/Documents/Obsidian Vault/woops
## 7. Deliberately out of scope

- **No GraphQL API, no external database.** The graph is the wikilink +
  `related:` frontmatter structure above — it's what Obsidian's native Graph
  View already renders, so the vault stays fully editable by hand in Obsidian
  Desktop with zero extra tooling.
- **No MCP / Local REST API plugin.** OpenCode reads and writes the vault as
  plain files on the local filesystem, same as any other project folder.

---

## Notes for iterating on this skill

This is a first draft based on one conversation, not a tested/tuned skill yet.
Worth revisiting once it's been used for a bit:
- The 9-category taxonomy in §1 is a guess — adjust it once real project files
  exist and some categories turn out unused or too cramped.
- If projects grow large enough that even "first-level category files" become
  too much to read in one go, consider a `references/` subfolder per category
  for deep, rarely-needed detail (progressive disclosure, same idea as any
  other skill).