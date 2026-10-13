---
name: course-hub
description: Use when the user asks about their own courses, assignments, deadlines, exams, grades of work due, "今天/这周/下周要做什么", what a course covers in a given week, or wants a week's material explained — reads their Course Hub (all of their Canvas schools in one place) through the `coursehub` command.
---

# Course Hub

The user's Course Hub runs on this Mac (http://127.0.0.1:4123) and has every course, assignment, exam and
weekly study guide from all of their Canvas schools. Read it with the `coursehub` command
(~/.local/bin/coursehub). It is read-only toward Canvas; never try to submit or change anything in Canvas.

## Commands

| Need | Command |
|---|---|
| What's due (human readable, local time, includes overdue) | `coursehub tasks --days 7` |
| Same with details (Canvas link `htmlUrl`, category, status, note) | `coursehub tasks --days 7 --json` |
| Course ids and the current week of each course | `coursehub courses --json` |
| A week's study guide (overview, concepts, cheatsheet) | `coursehub study <courseId> <week>` (`--json` for everything incl. self-test) |
| Generate a missing guide (1–3 min, uses Claude) | `coursehub guide <courseId> <week>` |
| Fresh data from Canvas | `coursehub sync` |
| Is everything working | `coursehub status` / `coursehub doctor` |
| Open a page for the user | `coursehub open /study/<courseId>/<week>` |

## How to answer

- Reply in Chinese; keep course names, assignment titles and technical terms in English.
- Dates and times come only from the command output. Never compute, shift or guess a date; quote the due
  text as printed (e.g. "周日 23:59", "明天"). `dueAt` in JSON is UTC — if you must show it, convert to
  America/Los_Angeles without changing the day.
- Tell exams apart from homework: `[考]` in the list or `category: "exam"` in JSON. Some Canvas "quizzes" are
  really homework (category `homework`) — trust the category, not the Canvas type.
- Give the Canvas link (`htmlUrl`) for anything the user should open or submit.
- Mention a task's personal note (`note`, shown as ✎) when it matters ("带计算器").
- If `coursehub` says the server isn't running or data looks stale, run `coursehub sync` (or `coursehub doctor`)
  and say what you did.
- For "explain week N of course X": find the course id with `coursehub courses --json`, then
  `coursehub study <courseId> <N>`; if it isn't generated, offer to run `coursehub guide <courseId> <N>`.
