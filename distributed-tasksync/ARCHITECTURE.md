# Distributed TaskSync – Architecture

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Canvas    │  │  Inspector  │  │  Artifact   │  │    Control Bar      │ │
│  │   (Graph)   │  │   Panel     │  │   Viewer    │  │ [Run][Pause][Step]  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ORCHESTRATOR SERVICE                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Graph     │  │   Task      │  │  Artifact   │  │     Synapse         │ │
│  │   Manager   │  │   Scheduler │  │  Registry   │  │     Router          │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐
│     LOCAL SESSION     │ │   WORKSPACE-REMOTE    │ │    MACHINE-REMOTE     │
│  ┌─────────────────┐  │ │  ┌─────────────────┐  │ │  ┌─────────────────┐  │
│  │ TaskSync Bridge │  │ │  │ TaskSync Bridge │  │ │  │ TaskSync Bridge │  │
│  └────────┬────────┘  │ │  └────────┬────────┘  │ │  └────────┬────────┘  │
│           ▼           │ │           ▼           │ │           ▼           │
│  ┌─────────────────┐  │ │  ┌─────────────────┐  │ │  ┌─────────────────┐  │
│  │ Copilot Session │  │ │  │ Copilot Session │  │ │  │ Copilot Session │  │
│  │   + Persona     │  │ │  │   + Persona     │  │ │  │   + Persona     │  │
│  └─────────────────┘  │ │  └─────────────────┘  │ │  └─────────────────┘  │
└───────────────────────┘ └───────────────────────┘ └───────────────────────┘
      Same Window              Same Machine              Network/Cloud
```

## Component Details

### 1. Orchestrator Service

The brain of the system. Runs as a singleton within the primary VS Code extension.

```typescript
interface OrchestratorService {
  // Graph Management
  loadGraph(definition: GraphDefinition): void;
  getGraph(): Graph;
  
  // Execution Control
  startRun(): Run;
  pauseRun(runId: string): void;
  resumeRun(runId: string): void;
  stepRun(runId: string): void;  // Execute single node
  
  // Node Management
  getNodeStatus(nodeId: string): NodeStatus;
  takeoverNode(nodeId: string): void;  // Human takes control
  releaseNode(nodeId: string): void;   // Return to agent
  
  // Artifact Management
  getArtifacts(runId: string): Artifact[];
  getArtifact(artifactId: string): Artifact;
}
```

### 2. Synapse Router

The coupling mechanism that handles inter-node communication.

```typescript
interface SynapseRouter {
  // Route output from source to target(s)
  route(payload: HandoffPayload, targetNodeIds: string[]): void;
  
  // Apply transformations before routing
  transform(payload: HandoffPayload, rules: TransformRule[]): HandoffPayload;
  
  // Validate payload against target node expectations
  validate(payload: HandoffPayload, targetSchema: Schema): ValidationResult;
}
```

### 3. TaskSync Bridge

Adapter layer that connects the Orchestrator to individual Copilot sessions.

```typescript
interface TaskSyncBridge {
  // Connection
  connect(config: SessionConfig): Promise<void>;
  disconnect(): void;
  getStatus(): 'connected' | 'disconnected' | 'error';
  
  // Task Execution
  executeTask(task: Task): Promise<TaskResult>;
  cancelTask(taskId: string): void;
  
  // Persona Management
  setPersona(persona: Persona): void;
  
  // Events
  onStatusChange(callback: (status: NodeStatus) => void): void;
  onArtifactProduced(callback: (artifact: Artifact) => void): void;
}
```

### 4. Session Types

| Type | Connection | Latency | Use Case |
|------|------------|---------|----------|
| **Local** | In-process | ~0ms | Primary development session |
| **Workspace-Remote** | IPC / Named Pipe | ~1-5ms | Multi-window workflows |
| **Machine-Remote** | WebSocket / HTTP | ~10-100ms | Distributed teams, cloud agents |

## Data Flow Example

```
User Requirement: "Build a REST API for user management"

1. [User] ──requirement──▶ [PM Node]
   
2. [PM Node] ──user_stories──▶ [Orchestrator]
   Artifact: requirements.md
   
3. [Orchestrator] ──handoff──▶ [Architect Node]
   Payload: { artifact_id: "req-001", instructions: "Design API structure" }
   
4. [Architect Node] ──design──▶ [Orchestrator]
   Artifact: api-design.md, openapi.yaml
   
5. [Orchestrator] ──handoff──▶ [Engineer Node]
   Payload: { artifact_id: "design-001", instructions: "Implement endpoints" }
   
6. [Engineer Node] ──code──▶ [Orchestrator]
   Artifact: src/routes/users.ts, src/models/user.ts
   
7. [Orchestrator] ──handoff──▶ [QA Node]
   Payload: { artifact_id: "code-001", instructions: "Write tests" }
   
8. [QA Node] ──tests──▶ [Orchestrator]
   Artifact: tests/users.test.ts
   
9. [Orchestrator] ──complete──▶ [User]
   Final Artifacts: All files ready for review
```

## State Persistence

```typescript
interface RunState {
  runId: string;
  graphId: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  currentNodeId: string | null;
  checkpoints: Checkpoint[];
  artifacts: ArtifactReference[];
  nodeStates: Map<string, NodeState>;
  startedAt: Date;
  updatedAt: Date;
}
```

State is persisted to:
- **In-memory**: For active runs (fast access).
- **Local JSON**: For pause/resume across VS Code restarts.
- **Optional SQLite**: For complex queries and history.

## Security Considerations

1. **Node Isolation**: Each agent session runs in its own context.
2. **Artifact Sandboxing**: Code artifacts are not auto-executed.
3. **Network Security**: Machine-remote connections require authentication.
4. **Persona Constraints**: Personas can limit tool access per role.
