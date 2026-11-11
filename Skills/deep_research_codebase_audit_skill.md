# Skill: Deep Research & Codebase Audit for Production Readiness

## Objective
Systematically investigate, map, audit, and research the **Agentic-Shopify** codebase (`https://github.com/RyanAteser/Agentic-Shopify`) to prepare it for enterprise-level, production-grade deployment.

---

## 1. Initial Research & Inspection Phase

Run a multi-tier exploration of the codebase using targeted queries and static analysis.

### Primary Inspection Checklist
- [ ] **Repository Layout:** Map all top-level directories, entry points, configuration files, and scripts.
- [ ] **Technology Stack:** Identify languages, frameworks, runtime environments (e.g., Python, Node.js, Next.js, FastAPI, Remix), and dependency versions.
- [ ] **Agentic Architecture:** Determine how AI agents, tools, and memory are implemented (e.g., LangChain, LlamaIndex, Model Context Protocol (MCP), custom loops, OpenAI Assistants API).
- [ ] **Shopify Integration:** Locate Shopify API client initialization (GraphQL Admin API vs. Storefront API vs. REST), authentication flow (OAuth 2.0 vs. Custom App tokens), and webhooks implementation.
- [ ] **State & Persistence:** Audit session storage, vector databases (e.g., Pinecone, Qdrant, Chroma), relational databases (PostgreSQL/SQLite), and caching layers (Redis).

---

## 2. Deep Diagnostic Questions Matrix

Ask the following diagnostic questions across five core dimensions to build a complete architectural picture.

### A. Codebase & Logic Architecture
1. What is the execution flow from an incoming user request or event to the agent's tool invocation?
2. How are agent system prompts, tool schemas, and output parsing structured and versioned?
3. Are there explicit fallbacks or retry mechanics when an LLM fails to output valid JSON/tool calls?

### B. Shopify API & Platform Safety
1. How does the application handle Shopify's cost-based GraphQL rate limits?
2. Is webhook verification (`X-Shopify-Hmac-SHA256`) strictly enforced on all incoming webhook endpoints?
3. What safety controls or human-in-the-loop checkpoints exist before an agent executes high-impact Shopify API calls (e.g., price changes, order cancellations, refund processing)?

### C. Scalability & Performance
1. Is long-running agent execution decoupled from synchronous HTTP request cycles using background task queues (e.g., BullMQ, Celery, Temporal)?
2. How is conversation state/memory pruned or summarized to prevent context-window overflow and control LLM token costs?
3. Are database connections pooled appropriately for multi-tenant, high-traffic loads?

### D. Security & Compliance
1. How are merchant access tokens and environment secrets stored and encrypted at rest?
2. Does the application follow multi-tenant data isolation rules to prevent cross-tenant memory leakage?
3. Are input sanitization measures in place to prevent Prompt Injection attacks against the agent tools?

### E. Infrastructure & Observability
1. What containerization (`Dockerfile`, `docker-compose.yml`) or CI/CD pipelines are currently configured?
2. Are structured logs (JSON format with trace/correlation IDs) and error reporting tools (e.g., Sentry) integrated?
3. How are health checks, readiness probes, and metrics endpoints monitored?

---

## 3. Gap Analysis & Production Upgrade Plan

Based on the responses to the diagnostic matrix, formulate a gap analysis report structured as follows:

```
+------------------------+-------------------------+---------------------------------+
| Dimension              | Current Implementation  | Production Target Requirements   |
+------------------------+-------------------------+---------------------------------+
| Auth & Security        | Baseline / Prototype    | HMAC verification + Key Vault   |
| Agent Orchestration    | Single-threaded sync    | Async worker queue + Fallbacks  |
| Data Persistence       | Memory / Local DB       | Distributed DB + Redis Cache    |
| Observability          | Standard stdout logs    | Traced logs + Sentry + OpenTelemetry |
+------------------------+-------------------------+---------------------------------+
```

---

## 4. Deep Research Execution Prompt Template

Copy and execute this prompt against any LLM or AI agent tasked with auditing the repository:

> *"Perform a deep research audit on the Agentic-Shopify repository. Examine all entry points, dependencies, environment configs, API abstractions, and agent tool definitions. Provide a comprehensive summary covering: 1) Architecture overview, 2) Data flow diagram/description, 3) Critical vulnerabilities or production blockers, 4) Shopify API compliance issues, and 5) A prioritized 5-step roadmap to make this application enterprise-ready."*