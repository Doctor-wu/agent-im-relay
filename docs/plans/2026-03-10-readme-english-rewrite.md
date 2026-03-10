# README English Rewrite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the root README for the international open source audience while preserving the existing information and overall section order, except for moving `Why Agent Inbox` and `Quick Start` directly below the badges.

**Architecture:** This is a documentation-only change centered on the root `README.md`. The work removes the embedded architecture image, rewrites all prose from Chinese to English, preserves existing commands, links, tables, and section ordering, and then delivers the result through a new git branch and GitHub pull request.

**Tech Stack:** Markdown, git, GitHub CLI

---

### Task 1: Update the README content

**Files:**
- Modify: `README.md`

**Step 1: Rewrite the introduction and section headings**

Update the top of `README.md` so the project description is English-first, delete the architecture image line, rename the feature-highlights section to `Why Agent Inbox`, and place that section plus `Quick Start` immediately after the badges.

**Step 2: Translate the remaining prose**

Rewrite the rest of the README content in English while preserving useful information, links, commands, tables, and the order of sections after `Quick Start`.

**Step 3: Review the rendered structure through diff**

Run: `git diff -- README.md`

Expected: only the requested structural movement plus English copy updates.

### Task 2: Deliver the documentation change

**Files:**
- Modify: `README.md`
- Create: `docs/plans/2026-03-10-readme-english-rewrite.md`

**Step 1: Create a feature branch**

Run: `git switch -c docs/readme-english-rewrite`

Expected: a new branch based on the current working tree, carrying the approved uncommitted README changes forward.

**Step 2: Commit the documentation update**

Run: `git add README.md docs/plans/2026-03-10-readme-english-rewrite.md && git commit -m "docs: rewrite README for international audience"`

Expected: one commit containing the README rewrite and the plan document.

**Step 3: Push and create a pull request**

Run: `git push -u origin docs/readme-english-rewrite` and create a PR with GitHub CLI summarizing the README rewrite and verification.

Expected: a GitHub PR URL ready for review.
