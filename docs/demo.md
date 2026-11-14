# Demo

Postings chosen by `npx tsx scripts/pick-demo.ts` for the demo résumé PDF. The PDF stays outside the repo. This file has no résumé text, name, email, bullets, or employers.

Scores use `scoreMatch` and `selectGaps`, the same functions as `POST /api/match` and `POST /api/gaps`. The script scores jobs with `extraction_status = done` and `role_type` of `internship` or `new_grad` (350 jobs). The match route scores every done job, including other role types. A job that both score gets the same number when the profile fields below are what was saved.

## Profile settings

Schema defaults, except year and majors, which come from the parser. No flags were passed.

| Setting | Value |
| --- | --- |
| Year | May 2029 |
| Majors | Computer Science, Mathematics |
| Needs sponsorship | false |
| Open to relocation | false |
| Preferred locations | none |
| Minimum pay | none |

The latest parse reported 6 experiences and 13 skills. Earlier parses of the same PDF reported 1 and 3 experiences, and the number of skill entries passed into `scoreMatch` moved between 13 and 23. The score bands and the three postings below stayed the same on every successful run. Check the live upload: if the parsed skill set differs, these percentages can move.

Score bands on that run: 0–39: 128, 40–74: 139, 75–85: 2, 86–100: 0, N/A: 81.

## ATS

`buildAtsReport` missing section: Experience.

Detail the app will show: "Possible issue: Experience section heading is missing."

Education and Skills headings are present. The Experience check looks for a short heading of "Work Experience" or "Professional Experience". This PDF will not show the missing-Skills issue in the PRD run of show.

## Demo posting

| | |
| --- | --- |
| Company | Airbnb |
| Title | Advanced Analytics Intern |
| Job id | `cb849b79-49f5-4776-aad1-2d2bfac3c945` |
| URL | https://careers.airbnb.com/positions/8380007?gh_jid=8380007 |
| Role | internship, United States |
| Score | 77% |
| Covered | SQL, Python |
| Missing | R |
| Preferred missing | none |

Why this one: it is the only posting in the 75–85 band whose every missing skill has a CICS course or lab, and Airbnb is in `data/companies.json`.

Gap for R:

- Course: CICS 109 Introduction to Data Analysis in R
- Lab: none

The other posting in the 75–85 band was not chosen. Veeva, Intern Technical Consultant (`89cdcccd-4d3f-48b9-b488-f8cd827e41df`, https://jobs.lever.co/veeva/87ae81ed-831f-4bc3-b12b-bf9a77f954c0) scores 85% with Python and Java covered and no missing skills, so the gap screen would be empty.

No 75–85 posting has a missing skill that the gap response pairs with a faculty lab. `selectGaps` keeps 3 resources and lists courses before labs. These skills have faculty labs in `umass_resources`, and each also has at least 3 courses, so the lab is cut:

| Skill | Courses | Faculty labs | Jobs missing it |
| --- | --- | --- | --- |
| Machine learning | 22 | 3 | 24 |
| Statistics | 8 | 1 | 3 |
| Distributed systems | 7 | 1 | 13 |
| Natural language processing | 4 | 3 | 10 |
| Large language models | 3 | 1 | 36 |

The gap API therefore returns courses only for those skills. The demo can show CICS 109 for R. It cannot show a lab with faculty until the cap or the course-before-lab order changes.

## Hard-mismatch posting

| | |
| --- | --- |
| Company | Affirm |
| Title | IT Engineer Intern (Early Careers Summer 2027) |
| Job id | `14a224de-e6c1-4575-8fa6-f68f449c6a33` |
| URL | https://job-boards.greenhouse.io/affirm/jobs/8011375003 |
| Score | 40% (capped) |
| Flag | Graduation year 2029 is outside 2027–2027 |
| Covered | Python, Java, JavaScript, React |
| Missing | Angular, AWS (no course or lab for either) |

Why this one: well-known company, a real percentage with the red flag beside it, and the mismatch comes from the parsed year. 213 of the 350 scored jobs hard-mismatch for May 2029.

Sponsorship is off, so a posting that says it will not sponsor has no hard-mismatch flag yet. 44 of those are not already hard-mismatched on graduation year. The strongest one for the A-4 toggle is Cloudflare, People Team: Software Engineer Intern (Winter 2027), `549aaefc-d3ab-41aa-a840-c53d0815540a`, https://boards.greenhouse.io/cloudflare/jobs/7774167?gh_jid=7774167. It scores 65% with sponsorship `no`. Turning needs sponsorship on caps it at 40% and sets the flag "Needs sponsorship; posting won't sponsor". That matches the sponsorship line in the PRD run of show. The Affirm card above already shows a grad-year flag with sponsorship left off.

## N/A posting

| | |
| --- | --- |
| Company | Affirm |
| Title | Software Engineer I, Early Career (London) |
| Job id | `18e9584b-be91-4f12-b003-dd5f7e33da19` |
| URL | https://job-boards.greenhouse.io/affirm/jobs/8011718003 |
| Score | N/A |
| Required skills after canonicalize | 0 |

Why this one: well-known company, internship/new-grad, extraction done, and no required skills after `canonicalize`. Under the profile above there is no hard-mismatch flag.

Next two candidates, same shape:

- Affirm, Software Engineer, Early Career (SF), `201daa5e-4a23-4b44-8a84-1c55f611d912`, https://job-boards.greenhouse.io/affirm/jobs/8010617003
- Affirm, Software Engineer Intern (Summer 2027), `6740fd7a-925f-4b90-83e7-20c7f001f048`, https://job-boards.greenhouse.io/affirm/jobs/8011590003

## Interview readiness

`npx tsx scripts/interview-readiness.ts --job cb849b79-49f5-4776-aad1-2d2bfac3c945`

Questions use the script's fixture experiences. They are not from the demo résumé.

Both runs **FAIL** the automated §5.8 check. Grades that returned were under 10 seconds. The failures are Gemini 503s, not zod errors.

| Run | Clean rounds | AI failures | Grade times (ms) | Result |
| --- | --- | --- | --- | --- |
| 1 | 1/3 | 2 | 682, 1153, 1675, 1250, 1294, 908 (max 1675) | FAIL |
| 2 | 2/3 | 1 | 1377, 1043, 1183, 1194, 1355, 1367 (max 1377) | FAIL |

Questions from run 2:

Round 1

- [behavioral] Tell me about a time when you used SQL or Python to analyze a complex dataset and explained your findings to non-technical partners.
- [behavioral] Describe a situation where your analysis showed a significant discrepancy from your expected baseline or forecast, and explain how you identified the drivers behind it.
- [behavioral] Tell me about a time when you had to collaborate closely with cross-functional team members to complete a project milestone or communicate project updates.
- [resume] In your role as Student Software Developer at UMass Amherst IT, how did you approach writing SQL queries against the PostgreSQL help-desk database to find the most common ticket types?
- [resume] In your role as Logistics Team Member at HackUMass, how did you manage coordinating check-in for about 600 hackers with a team of 8 volunteers?

Round 2

- [behavioral] Tell me about a time when you had to analyze complex business data using SQL or Python to explain why actual performance differed from a forecast or expectation. How did you identify the core drivers and share those findings with non-technical partners?
- [behavioral] Describe a situation where you had to communicate technical analytical findings to a diverse audience across different business teams in written readouts or recurring reviews. How did you ensure your insights were clearly understood and translated into actionable decisions?
- [behavioral] Tell me about a time when you owned a complex data or analytics project from beginning to end while collaborating with multiple team members. How did you manage milestones and incorporate feedback to achieve your final goal?
- [resume] In your role as Student Software Developer at UMass Amherst IT, you wrote SQL queries against the PostgreSQL help-desk database. Can you describe how you approached this task and what specific ticket types you were looking for?
- [resume] In your role as Logistics Team Member at HackUMass, you built a Google Sheets tracker for sponsor table assignments. Walk me through how you designed and utilized this tracker during the event.

Round 3

- [behavioral] Tell me about a time when you had to analyze a complex dataset using SQL and Python or R to uncover what drove a performance gap or variance. How did you approach the problem and what was the outcome?
- [behavioral] Describe a situation where you had to communicate technical analytical findings to non-technical partners or stakeholders in written readouts or meetings. How did you ensure your message was clearly understood?
- [behavioral] Tell me about a time when you collaborated with team members to achieve a major project milestone or complete a capstone-style project from beginning to end. How did you manage the workload and stakeholder updates?
- [resume] In your role as Student Software Developer at UMass Amherst IT, you wrote SQL queries against the PostgreSQL help-desk database. Can you describe how you approached querying that database to find the most common ticket types?
- [resume] In your role as Logistics Team Member at HackUMass, you built a Google Sheets tracker. Can you tell me about how you set that up for sponsor table assignments during the event?

The behavioral questions track the posting (SQL, Python or R, explaining a forecast gap to non-technical partners). Leave interview prep out of the live demo until a run is 3/3 with no AI failures.

## Scout runs

5 `bot_runs` rows with `kind = scout` and `status = done`. The PRD asks for at least 3 logged before judging. No new run was started.

## Before every demo run

1. In the Supabase project, email confirmation is off for the demo address.
2. Reset the demo user. The address is `DEMO_EMAIL` in `.env.local`. The script refuses an email on the command line. Dry run, then delete:

```bash
npx tsx scripts/reset-demo.ts
npx tsx scripts/reset-demo.ts --yes
```

3. Sync status. Course sync (a second run should log unchanged):

```bash
npx tsx scripts/sync-courses.ts
```

Extraction for the feed is already done: 350 internship and new-grad jobs with `extraction_status = done` were scored above.

4. Pre-warm is B-10 and is not a script yet. After sign-up and the résumé upload, run match for the demo user and tailor the Airbnb posting once (`cb849b79-49f5-4776-aad1-2d2bfac3c945`) so those Gemini calls are warm.
5. Fallbacks: the backup video on the desktop, and the logged scout runs in the activity panel.
6. One person drives and one narrates.

C-9 stays open. Reset, a full demo, reset, and a full demo need the sign-up, upload, feed, job detail, tracker, and bot panel.
