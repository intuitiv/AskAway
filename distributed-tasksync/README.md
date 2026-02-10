# Distributed TaskSync

> A distributed, multi-agent orchestration platform built on top of TaskSync.

## Vision

Transform TaskSync from a linear human-in-the-loop chat wrapper into a **graph-based, distributed agent orchestrator**. Each node in the graph is an autonomous agent (backed by a Copilot session) with a distinct persona. The user acts as the primary stakeholder, defining goals and intervening at will.

## Core Concepts

- **Agent-to-Agent Coupling**: TaskSync becomes the "synapse" between agents. When one agent completes a task, TaskSync routes the output to the next agent in the graph.
- **Agent-to-Human Coupling**: At any point, a user can "take over" a node, replacing the autonomous agent with themselves.
- **Distributed Execution**: Agents can run on different workspaces, machines, or even cloud instances—all connected to a central orchestrator.

## Key Scenarios

1. **Autonomous Pipeline**: User submits a requirement → PM Agent elaborates → Architect Agent designs → Engineer Agent implements → QA Agent reviews.
2. **Human Intervention**: User pauses the pipeline, inspects an artifact, provides feedback, and resumes.
3. **Parallel Collaboration**: Multiple agents work on independent sub-tasks simultaneously, merging results at a convergence node.

## Folder Contents

| File | Description |
|------|-------------|
| [VOCABULARY.md](./VOCABULARY.md) | Glossary of terms for discussing the system |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | High-level architecture and data flow |
| [UI_MOCKUP.md](./UI_MOCKUP.md) | Visual mockups of the orchestrator UI |
| [ROADMAP.md](./ROADMAP.md) | Implementation phases and milestones |

---

*Last updated: 3 February 2026*
