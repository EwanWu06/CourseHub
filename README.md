# Course Hub

A personal dashboard that gathers coursework from several Canvas LMS schools into one place on a Mac:
deadlines, what each assignment actually asks for, and weekly study guides. Built for a student taking
classes at three schools at once, each with its own Canvas. The interface is in Chinese.

## What it does
- One list of everything due across all schools, with reminders and change alerts as macOS notifications
- Works out what is really left to do (discussion replies, peer reviews, module requirements, missing work)
  and checks itself against Canvas's own To Do list, calendar feed and missing list
- Daily and weekly plans, and per-week study guides that Claude writes from each course's own materials
- A local web app and a `coursehub` command line

## How it works
- Runs only on your Mac: a TypeScript/Node server (Hono, built-in SQLite) on 127.0.0.1 and a React web app
- Signs in through each school's normal login (SSO) in Chrome, keeps the session alive, and stores only the
  cookies that sign-in needs, readable by your account alone
- Read-only toward Canvas; the web app is locked down (Content-Security-Policy, sandboxed file previews,
  cross-site request and DNS-rebinding guards)
- 380+ automated tests against a mock Canvas server, plus real-Chrome login tests

## Setup
macOS, Node 24+, Google Chrome, and Claude Code for the AI features. Run ./scripts/install.sh.

## How it was made
I set the goals, the scope and the standards, and made the key decisions. Claude Code (Anthropic) wrote
the code.

Not affiliated with Instructure or any school.
