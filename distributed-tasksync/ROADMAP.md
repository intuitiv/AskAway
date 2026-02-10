# Distributed TaskSync – Roadmap

## Phase 1: Foundation (Weeks 1-3)

### 1.1 Extract Orchestrator Service
- [ ] Create `src/orchestrator/OrchestratorService.ts`
- [ ] Move state (queue, history) from `WebviewProvider` to `OrchestratorService`
- [ ] Implement event emitter for state changes
- [ ] Refactor `WebviewProvider` to subscribe to `OrchestratorService`

### 1.2 Define Core Interfaces
- [ ] Create `src/types/graph.ts` with `Node`, `Edge`, `Graph` interfaces
- [ ] Create `src/types/artifact.ts` with `Artifact`, `ArtifactRegistry` interfaces
- [ ] Create `src/types/persona.ts` with `Persona`, `Capability` interfaces

### 1.3 Implement Artifact Registry
- [ ] Create `src/orchestrator/ArtifactRegistry.ts`
- [ ] Implement versioning (store diffs or full copies)
- [ ] Add artifact lineage tracking

---

## Phase 2: Graph Engine (Weeks 4-6)

### 2.1 Graph Manager
- [ ] Create `src/orchestrator/GraphManager.ts`
- [ ] Implement graph CRUD operations
- [ ] Add graph validation (cycle detection, orphan nodes)
- [ ] Implement graph serialization/deserialization (JSON)

### 2.2 Task Scheduler
- [ ] Create `src/orchestrator/TaskScheduler.ts`
- [ ] Implement topological sort for execution order
- [ ] Add parallel execution support (fan-out/fan-in)
- [ ] Implement checkpoint save/restore

### 2.3 Synapse Router
- [ ] Create `src/orchestrator/SynapseRouter.ts`
- [ ] Implement handoff payload construction
- [ ] Add transformation rules (filter, map, merge)
- [ ] Implement validation against node input schemas

---

## Phase 3: Agent Integration (Weeks 7-9)

### 3.1 Local Session Bridge
- [ ] Create `src/bridges/LocalBridge.ts`
- [ ] Integrate with existing `ask_user` tool mechanism
- [ ] Implement persona injection into system prompt
- [ ] Add capability filtering per persona

### 3.2 Remote Session Bridge
- [ ] Create `src/bridges/RemoteBridge.ts`
- [ ] Extend MCP server with `delegate_task`, `report_status` tools
- [ ] Implement WebSocket transport for low-latency communication
- [ ] Add authentication/authorization layer

### 3.3 Persona Manager
- [ ] Create `src/orchestrator/PersonaManager.ts`
- [ ] Define built-in personas (PM, Architect, Engineer, QA, Docs)
- [ ] Implement custom persona creation UI
- [ ] Add persona-to-capability mapping

---

## Phase 4: Visual Interface (Weeks 10-13)

### 4.1 Canvas Component
- [ ] Evaluate graph libraries (Cytoscape.js, React Flow, D3)
- [ ] Implement node rendering with status indicators
- [ ] Implement edge rendering with data flow visualization
- [ ] Add zoom, pan, fit-to-screen controls

### 4.2 Inspector Panel
- [ ] Create conversation history view
- [ ] Create artifact list view
- [ ] Implement real-time status updates (WebSocket)

### 4.3 Pipeline Editor
- [ ] Implement drag-and-drop node placement
- [ ] Implement edge drawing (click source → click target)
- [ ] Create node configuration modal
- [ ] Create edge configuration panel

### 4.4 Takeover Mode
- [ ] Implement node pause/resume
- [ ] Create artifact production form
- [ ] Add "Release to Agent" functionality

---

## Phase 5: Polish & Ship (Weeks 14-16)

### 5.1 Persistence
- [ ] Implement run state persistence (JSON files)
- [ ] Add run history browser
- [ ] Implement run comparison (diff between runs)

### 5.2 Error Handling
- [ ] Add node retry logic
- [ ] Implement failure notifications
- [ ] Add manual intervention prompts on failure

### 5.3 Documentation
- [ ] Write user guide
- [ ] Create video tutorials
- [ ] Document API for custom integrations

### 5.4 Testing
- [ ] Unit tests for Orchestrator components
- [ ] Integration tests for graph execution
- [ ] E2E tests for UI workflows

---

## Future Enhancements (Post-MVP)

- **Cloud Orchestrator**: Run the orchestrator as a cloud service
- **Multi-User Collaboration**: Multiple humans observing/intervening
- **AI-Generated Pipelines**: Describe goal, AI creates the graph
- **Plugin System**: Custom node types, custom bridges
- **Metrics Dashboard**: Execution time, token usage, cost tracking

---

## Dependencies

| Dependency | Purpose | Status |
|------------|---------|--------|
| Cytoscape.js | Graph visualization | To evaluate |
| Socket.IO | Real-time communication | Already used |
| Zod | Schema validation | To add |
| LevelDB/SQLite | Persistent storage | To evaluate |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Graph render time | < 100ms for 50 nodes |
| Node execution handoff latency | < 500ms (local), < 2s (remote) |
| UI responsiveness | 60fps during interactions |
| State persistence | < 1s save/restore |
