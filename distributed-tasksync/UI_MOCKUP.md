# Distributed TaskSync – UI Mockups

## 1. Main Orchestrator View

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  🔷 Distributed TaskSync                                    [+ New Pipeline] [⚙️]   │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌─ CONTROL BAR ─────────────────────────────────────────────────────────────────┐  │
│  │  Pipeline: [User Management API ▼]    Run: #42                                │  │
│  │                                                                               │  │
│  │  [▶ Run]  [⏸ Pause]  [⏭ Step]  [↺ Reset]  [👤 Takeover Selected]            │  │
│  │                                                                               │  │
│  │  Status: ● Running    Progress: ████████░░░░░░░░ 53%    Elapsed: 00:04:32   │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌─ CANVAS ──────────────────────────────────────────────────────────┐ ┌─ INSPECTOR─┐│
│  │                                                                    │ │            ││
│  │         ┌──────────┐                                               │ │ Selected:  ││
│  │         │  📋 PM   │ ✅ Completed                                  │ │ ARCH Node  ││
│  │         │  Agent   │                                               │ │            ││
│  │         └────┬─────┘                                               │ │ ──────────-││
│  │              │                                                     │ │ Persona:   ││
│  │              │ requirements.md                                     │ │ Architect  ││
│  │              ▼                                                     │ │            ││
│  │         ┌──────────┐                                               │ │ Session:   ││
│  │         │  🏗 ARCH │ ⏳ In Progress                                │ │ Local #2   ││
│  │    ┌────│  Agent   │────┐                                          │ │            ││
│  │    │    └────┬─────┘    │                                          │ │ Status:    ││
│  │    │         │          │                                          │ │ ● Active   ││
│  │    │         │          │                                          │ │            ││
│  │    ▼         ▼          ▼                                          │ │ Task:      ││
│  │ ┌──────┐ ┌──────┐ ┌──────┐                                         │ │ Designing  ││
│  │ │ 👨‍💻   │ │ 👨‍💻   │ │ 👨‍💻   │  ○ Pending                            │ │ API struct ││
│  │ │ ENG  │ │ ENG  │ │ ENG  │                                         │ │            ││
│  │ │ API  │ │ Auth │ │ DB   │                                         │ │ ──────────-││
│  │ └──┬───┘ └──┬───┘ └──┬───┘                                         │ │ Artifacts: ││
│  │    │        │        │                                             │ │ 📄 api.md  ││
│  │    └────────┼────────┘                                             │ │ 📄 spec.yml││
│  │             ▼                                                      │ │            ││
│  │        ┌──────────┐                                                │ │ [View Conv]││
│  │        │  🧪 QA   │  ○ Pending                                     │ │ [Takeover] ││
│  │        │  Agent   │                                                │ │ [Inspect]  ││
│  │        └──────────┘                                                │ │            ││
│  │                                                                    │ │            ││
│  │  [🔍 Zoom: 100%]  [⊞ Fit]  [📐 Grid]                              │ │            ││
│  └────────────────────────────────────────────────────────────────────┘ └────────────┘│
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Node Configuration Modal

```
┌──────────────────────────────────────────────────────────────────────┐
│  Configure Node: ARCH Agent                                    [✕]  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─ IDENTITY ───────────────────────────────────────────────────┐   │
│  │  Node ID:    arch-001                                        │   │
│  │  Display:    [Architect Agent              ]                 │   │
│  │  Icon:       [🏗 ▼]                                          │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─ SESSION ────────────────────────────────────────────────────┐   │
│  │  Type:       (•) Local   ( ) Workspace-Remote   ( ) Remote   │   │
│  │                                                              │   │
│  │  ┌─ Local Options ─────────────────────────────────────────┐ │   │
│  │  │  VS Code Window:  [Current Window ▼]                    │ │   │
│  │  │  Copilot Model:   [claude-sonnet-4 ▼]                       │ │   │
│  │  └─────────────────────────────────────────────────────────┘ │   │
│  │                                                              │   │
│  │  ┌─ Remote Options (disabled) ─────────────────────────────┐ │   │
│  │  │  Host:     [_________________________]                  │ │   │
│  │  │  Port:     [3000]                                       │ │   │
│  │  │  API Key:  [_________________________]  [Test Connection]│ │   │
│  │  └─────────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─ PERSONA ────────────────────────────────────────────────────┐   │
│  │  Template:   [Architect ▼]                                   │   │
│  │                                                              │   │
│  │  System Prompt:                                              │   │
│  │  ┌──────────────────────────────────────────────────────────┐│   │
│  │  │ You are a senior software architect. Your role is to:   ││   │
│  │  │ - Design scalable system architectures                  ││   │
│  │  │ - Evaluate technical feasibility                        ││   │
│  │  │ - Define API contracts and interfaces                   ││   │
│  │  │ - Consider security, performance, and maintainability   ││   │
│  │  │                                                          ││   │
│  │  │ Always produce: architecture.md, openapi.yaml           ││   │
│  │  └──────────────────────────────────────────────────────────┘│   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌─ CAPABILITIES ───────────────────────────────────────────────┐   │
│  │  [✓] file-read   [✓] file-write   [ ] terminal              │   │
│  │  [✓] web-search  [ ] code-exec    [✓] ask-user              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│                                        [Cancel]  [Save Node]        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Drill-Down: Conversation View

When you click **[View Conv]** or double-click a node:

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  🏗 Architect Agent – Conversation                    [← Back to Graph]  [👤 Takeover]│
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌─ TASK CONTEXT ────────────────────────────────────────────────────────────────┐  │
│  │  Input Artifact: requirements.md (from PM Agent)                              │  │
│  │  Instructions: "Design the API structure for user management system"          │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌─ CONVERSATION ────────────────────────────────────────────────────────────────┐  │
│  │                                                                                │  │
│  │  ┌─ SYSTEM ──────────────────────────────────────────────────────────────────┐│  │
│  │  │ You are a senior software architect. Your role is to design scalable...  ││  │
│  │  └───────────────────────────────────────────────────────────────────────────┘│  │
│  │                                                                                │  │
│  │  ┌─ USER (Orchestrator) ─────────────────────────────────────────────────────┐│  │
│  │  │ Based on the requirements below, design the API structure:                ││  │
│  │  │                                                                           ││  │
│  │  │ **Requirements:**                                                         ││  │
│  │  │ 1. User registration with email verification                              ││  │
│  │  │ 2. Login with JWT authentication                                          ││  │
│  │  │ 3. Password reset flow                                                    ││  │
│  │  │ 4. User profile CRUD operations                                           ││  │
│  │  └───────────────────────────────────────────────────────────────────────────┘│  │
│  │                                                                                │  │
│  │  ┌─ ASSISTANT ───────────────────────────────────────────────────────────────┐│  │
│  │  │ I'll design a RESTful API structure for the user management system.      ││  │
│  │  │                                                                           ││  │
│  │  │ ## API Endpoints                                                          ││  │
│  │  │                                                                           ││  │
│  │  │ ### Authentication                                                        ││  │
│  │  │ - `POST /auth/register` - User registration                               ││  │
│  │  │ - `POST /auth/login` - User login                                         ││  │
│  │  │ - `POST /auth/verify-email` - Email verification                          ││  │
│  │  │ ...                                                                       ││  │
│  │  └───────────────────────────────────────────────────────────────────────────┘│  │
│  │                                                                                │  │
│  │  ┌─ TOOL CALL: ask_user ─────────────────────────────────────────────────────┐│  │
│  │  │ "Should I include rate limiting in the API design?"                       ││  │
│  │  │                                                     ⏳ Waiting for input  ││  │
│  │  └───────────────────────────────────────────────────────────────────────────┘│  │
│  │                                                                                │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌─ HUMAN INTERVENTION ──────────────────────────────────────────────────────────┐  │
│  │  [Yes, include rate limiting with 100 req/min per user        ]  [Send]      │  │
│  │                                                                               │  │
│  │  Quick Actions: [✓ Yes] [✗ No] [Let Agent Decide] [Inject Feedback]          │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Artifact Inspector

When you click an artifact from the Inspector Panel:

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  📄 Artifact: api-design.md                          [← Back]  [📥 Download]  [📋]  │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌─ METADATA ────────────────────────────────────────────────────────────────────┐  │
│  │  ID:        art-20260203-001                                                  │  │
│  │  Produced:  ARCH Agent @ 10:42:15                                             │  │
│  │  Version:   v2 (previous: v1)                                                 │  │
│  │  Size:      4.2 KB                                                            │  │
│  │  [View v1] [Compare v1 ↔ v2]                                                  │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌─ CONTENT ─────────────────────────────────────────────────────────────────────┐  │
│  │  # User Management API Design                                                 │  │
│  │                                                                               │  │
│  │  ## Overview                                                                  │  │
│  │  This document outlines the REST API design for user management...           │  │
│  │                                                                               │  │
│  │  ## Endpoints                                                                 │  │
│  │                                                                               │  │
│  │  ### POST /auth/register                                                      │  │
│  │  Creates a new user account.                                                  │  │
│  │                                                                               │  │
│  │  **Request:**                                                                 │  │
│  │  ```json                                                                      │  │
│  │  {                                                                            │  │
│  │    "email": "user@example.com",                                               │  │
│  │    "password": "securePassword123",                                           │  │
│  │    "name": "John Doe"                                                         │  │
│  │  }                                                                            │  │
│  │  ```                                                                          │  │
│  │  ...                                                                          │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌─ LINEAGE ─────────────────────────────────────────────────────────────────────┐  │
│  │                                                                               │  │
│  │  [requirements.md] ──▶ [PM Agent] ──▶ [ARCH Agent] ──▶ [api-design.md]       │  │
│  │        ↑                                                      │               │  │
│  │     (input)                                               (you are here)      │  │
│  │                                                                               │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│                                              [Use in Prompt]  [Send to Node ▼]      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Pipeline Configuration (Drag & Drop)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  ⚙️ Configure Pipeline: User Management API              [Save]  [Save As...]  [✕]  │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌─ NODE PALETTE ────────┐  ┌─ CANVAS (Drag & Drop) ─────────────────────────────┐  │
│  │                       │  │                                                     │  │
│  │  Agent Nodes:         │  │           ┌──────────┐                              │  │
│  │  ┌─────────────────┐  │  │           │  📋 PM   │                              │  │
│  │  │  📋 PM Agent    │◀─┼──┼───drag────│  Agent   │                              │  │
│  │  └─────────────────┘  │  │           └────┬─────┘                              │  │
│  │  ┌─────────────────┐  │  │                │                                    │  │
│  │  │  🏗 Architect   │  │  │                ▼                                    │  │
│  │  └─────────────────┘  │  │           ┌──────────┐                              │  │
│  │  ┌─────────────────┐  │  │           │  🏗 ARCH │                              │  │
│  │  │  👨‍💻 Engineer    │  │  │           │  Agent   │                              │  │
│  │  └─────────────────┘  │  │           └────┬─────┘                              │  │
│  │  ┌─────────────────┐  │  │        ┌───────┼───────┐                            │  │
│  │  │  🧪 QA Agent    │  │  │        ▼       ▼       ▼                            │  │
│  │  └─────────────────┘  │  │    ┌──────┐┌──────┐┌──────┐                         │  │
│  │  ┌─────────────────┐  │  │    │ ENG  ││ ENG  ││ ENG  │                         │  │
│  │  │  📝 Docs Agent  │  │  │    │ API  ││ Auth ││ DB   │                         │  │
│  │  └─────────────────┘  │  │    └──┬───┘└──┬───┘└──┬───┘                         │  │
│  │                       │  │       └───────┼───────┘                             │  │
│  │  Control Nodes:       │  │               ▼                                     │  │
│  │  ┌─────────────────┐  │  │          ┌──────────┐                               │  │
│  │  │  ⊕ Parallel     │  │  │          │  🔀 Merge │ ← Gateway Node               │  │
│  │  └─────────────────┘  │  │          └────┬─────┘                               │  │
│  │  ┌─────────────────┐  │  │               ▼                                     │  │
│  │  │  🔀 Merge       │  │  │          ┌──────────┐                               │  │
│  │  └─────────────────┘  │  │          │  🧪 QA   │                               │  │
│  │  ┌─────────────────┐  │  │          │  Agent   │                               │  │
│  │  │  ✋ Approval    │  │  │          └──────────┘                               │  │
│  │  └─────────────────┘  │  │                                                     │  │
│  │  ┌─────────────────┐  │  │                                                     │  │
│  │  │  👤 Human Node  │  │  │  Tip: Click an edge to configure data flow.        │  │
│  │  └─────────────────┘  │  │       Double-click a node to configure it.         │  │
│  │                       │  │                                                     │  │
│  └───────────────────────┘  └─────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌─ EDGE CONFIGURATION ──────────────────────────────────────────────────────────┐  │
│  │  Selected Edge: PM Agent → ARCH Agent                                         │  │
│  │                                                                               │  │
│  │  Data Flow:                                                                   │  │
│  │  [✓] Pass all artifacts   [ ] Select specific artifacts                       │  │
│  │                                                                               │  │
│  │  Instructions Template:                                                       │  │
│  │  [Design the system architecture based on the requirements provided.    ]    │  │
│  │                                                                               │  │
│  │  Condition (optional):                                                        │  │
│  │  [                                                                      ]    │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Takeover Mode

When user clicks **[Takeover]** on a node:

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  👤 TAKEOVER MODE: ARCH Agent                           [🔙 Release to Agent]       │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ⚠️ You are now controlling this node. The agent is paused.                         │
│                                                                                      │
│  ┌─ INPUT ARTIFACTS ─────────────────────────────────────────────────────────────┐  │
│  │  📄 requirements.md (from PM Agent)                            [View] [Edit]  │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌─ YOUR TASK ───────────────────────────────────────────────────────────────────┐  │
│  │  "Design the API structure for user management system"                        │  │
│  │                                                                               │  │
│  │  Expected Outputs:                                                            │  │
│  │  • architecture.md - System design document                                   │  │
│  │  • openapi.yaml - API specification                                           │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌─ PRODUCE ARTIFACTS ───────────────────────────────────────────────────────────┐  │
│  │                                                                               │  │
│  │  Artifact 1:                                                                  │  │
│  │  Name: [api-design.md                    ]  Type: [Markdown ▼]               │  │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐│  │
│  │  │ # API Design                                                             ││  │
│  │  │                                                                          ││  │
│  │  │ ## Endpoints                                                             ││  │
│  │  │ ...                                                                      ││  │
│  │  └──────────────────────────────────────────────────────────────────────────┘│  │
│  │                                                                               │  │
│  │  [+ Add Another Artifact]                                                     │  │
│  │                                                                               │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│                    [Save & Continue to Next Node]  [Save & Release to Agent]        │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Color Legend

| Element | Color | Meaning |
|---------|-------|---------|
| 🟢 Green border | `#22c55e` | Completed |
| 🟡 Yellow border | `#eab308` | In Progress |
| ⚪ Gray border | `#6b7280` | Pending |
| 🔴 Red border | `#ef4444` | Failed / Error |
| 🔵 Blue border | `#3b82f6` | Human Takeover Active |
| ⬛ Dashed border | `#9ca3af` | Gateway / Control Node |

---

## Responsive Behavior

- **Wide Screen (>1400px)**: Canvas + Inspector side-by-side
- **Medium Screen (900-1400px)**: Inspector as slide-out panel
- **Narrow Screen (<900px)**: Tab-based navigation (Graph | Inspector | Artifacts)
