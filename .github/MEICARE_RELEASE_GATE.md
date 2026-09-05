# MEICARE Release Gate

This repository follows MEICARE's AI-native 2-founder governance model.

## Release principle
No production release is approved solely because code compiles or tests pass. A release must satisfy the applicable product, clinical, security, data-integrity and rollback gates.

## Mandatory gates

### 1. Product / workflow
- Requirement and acceptance criteria are explicit.
- User-visible behavior is traceable to a task/project.
- Error/empty/loading states are considered.

### 2. Data integrity
For Supabase/PostgreSQL, HIS ingestion, inventory calculations or migrations:
- organization/tenant boundaries are preserved;
- idempotency and duplicate handling are defined;
- reconciliation/evidence is available;
- destructive operations have explicit backup/rollback controls.

### 3. Clinical safety
Any change affecting pharmacy workflow, alerts, medication interpretation, prioritization or safety logic requires Founder B approval before production.

### 4. Technology / security
Any material change affecting authentication, authorization, RLS, secrets, permissions, network boundaries, audit logs or production infrastructure requires Founder A approval before production.

### 5. Reserved matters
Material cross-domain commitments or changes governed by the Company Constitution require approval from both founders.

## AI boundary
AI may:
- review diffs;
- propose tests;
- run/interpret non-destructive checks;
- draft release notes;
- classify risk;
- prepare rollback/evidence checklists.

AI may not autonomously:
- deploy a high/critical-risk change to production;
- alter IAM/secrets/permissions;
- run destructive database actions;
- approve clinical safety;
- bypass a required founder gate.

## Minimum release evidence
Each material release should retain:
1. linked task/issue;
2. PR/review evidence;
3. test/regression evidence;
4. migration + rollback evidence if applicable;
5. clinical/security approvals where applicable;
6. release timestamp/version;
7. incident/rollback record if release fails.
