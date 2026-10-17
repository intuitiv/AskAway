---
name: sk-start
description: "Select a numbered Spec Kit feature and summarize its state."
disable-model-invocation: true
---
# /sk.start

Select feature $ARGUMENTS (a number such as 002, or a slug) in .specify/feature.json and orient. If no argument is given, list specs/ with each spec's stage and ask which one, as a single question.

Steps:
1. Resolve the argument to exactly one specs/NNN-* folder. If none or several match, list the candidates and stop.
2. Set feature_directory in .specify/feature.json. Make no other edit.
3. Report these four separately and never infer one from another: feature directory, current Git branch, recorded task branch, and cloud base revision (say "not set" when none is recorded).
4. Report the stage the way Spec Kit names it: which of spec.md, plan.md, tasks.md and implementation-log.md exist, whether any derived artifact is older than the one it derives from (stale), open [NEEDS CLARIFICATION] items, open versus done tasks, and the one command to run next (/sk.check, /sk.plan, /sk.tasks, /sk.implement or /sk.continue).

Do not implement.
