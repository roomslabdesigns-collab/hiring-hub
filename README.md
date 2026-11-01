# Flexiple Hiring Hub (prototype)

A clickable prototype of one shared, live hiring timeline for the client, the candidate and the Flexiple recruiter, from interview to Day 1. Built as a product exercise by Thamada Ashish. Not an official Flexiple product. All companies, people and data are made up.

## Views

- **Candidate view:** the job's real interview rounds, the current round, the next update date (a range if it slips), outcome cards, message history and saved test results.
- **Recruiter view:** alerts for candidates with no update for 7+ days, AI-drafted updates to edit, approve or discard, channel chips, and a 2-messages-per-role-per-week guardrail.
- **Client view:** a hiring board per role and an offer-to-join tracker with Low/Medium/High risk from process signals only, plus a backup chip for high-risk hires.

## Try these

1. Recruiter view: **Move to next round** on a candidate, then **Approve and send** the new draft. Check the candidate view.
2. Pause a role and see the outcome drafts for every candidate on it.
3. Client view: **Log missed check-in** on a hire and watch the risk level rise.

## Run it

Open `index.html` in a browser. It loads React, Tailwind and Babel from public CDNs, so it needs an internet connection.

## Code

- `api.js`: mock API with in-memory seed data and 300-500 ms delays. Functions such as `getCandidates()`, `getRoles()`, `updateStage()`, `draftMessage()` and `approveMessage()` can be swapped for real HTTP calls.
- `index.html`: the React + Tailwind single-page app.

Data resets when the page reloads.
