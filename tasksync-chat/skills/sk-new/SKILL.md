---
name: sk-new
description: "Create a new numbered Spec Kit feature without losing the previous active feature."
disable-model-invocation: true
---
# /sk.new

Create a new numbered feature from $ARGUMENTS (the reviewer's plain description) under specs/. Preserve the previous feature_directory until creation succeeds. Keep feature slug, current Git branch, recorded task branch, and explicit cloud base revision separate; never derive one from another.

Steps:
1. Read .specify/feature.json and remember its feature_directory. Do not change it yet.
2. List specs/ and take the next number (highest NNN + 1, zero padded). Make a short kebab-case slug from the description.
3. Create specs/NNN-slug/spec.md from .specify/templates/spec-template.md: prioritized user stories (P1 first), each independently testable, with Given/When/Then acceptance scenarios, functional requirements, success criteria, and **Status**: Draft. Write what and why, never how.
4. Mark every genuine gap as [NEEDS CLARIFICATION: question], at most five. Choose a sensible default for everything else and list it under Assumptions.
5. Only after the files exist, set feature_directory in .specify/feature.json to the new folder (activate the new feature).
6. Report the path, the number, the stories found, the open [NEEDS CLARIFICATION] items, and the next command: /sk.check. Do not plan or implement.
