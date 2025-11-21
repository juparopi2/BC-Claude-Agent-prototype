# Database Schema - Complete Reference (UPDATED 2025-11-20)

> **Status**: 13/13 tables functional ✅ ALL TABLES EXIST
> **Last Updated**: 2025-11-20 (After Schema Audit)
> **Database**: sqldb-bcagent-dev (Azure SQL)
> **Server**: sqlsrv-bcagent-dev.database.windows.net
> **Resource Group**: rg-BCAgentPrototype-data-dev

---

## Overview

The BC-Claude-Agent system uses **Azure SQL Database** for persistent state management. The schema supports:
- Chat sessions with event sourcing
- User authentication (Microsoft OAuth + password fallback)
- Human-in-the-loop approvals
- Todo tracking with hierarchical dependencies
- Audit logging and performance metrics

### Schema Status

**✅ ALL TABLES FUNCTIONAL (13/13)**:
- ✅ Core (6): users, sessions, messages, message_events, approvals, checkpoints
- ✅ Advanced (4): todos, tool_permissions, permission_presets, agent_executions
- ✅ Observability (2): audit_log, performance_metrics
- ✅ Files (1): session_files

**⚠️ Previous Documentation Errors**:
- ❌ Documentation incorrectly stated `session_files` was missing - **IT EXISTS**
- ❌ Documentation did NOT mention `message_events` table - **CRITICAL FOR EVENT SOURCING**
- ❌ Many columns have been renamed or removed in production

---

## Entity-Relationship Diagram (UPDATED)

```mermaid
erDiagram
    users ||--o{ sessions : "creates"
    users ||--o{ approvals : "decides"
    users ||--o{ tool_permissions : "has"
    users ||--o{ audit_log : "generates"

    sessions ||--o{ messages : "contains"
    sessions ||--o{ message_events : "streams"
    sessions ||--o{ approvals : "requests"
    sessions ||--o{ todos : "tracks"
    sessions ||--o{ checkpoints : "snapshots"
    sessions ||--o{ agent_executions : "runs"
    sessions ||--o{ session_files : "references"
    sessions ||--o{ performance_metrics : "measures"

    message_events ||--o{ messages : "materializes"
    messages ||--o{ approvals : "triggers"
    todos ||--o{ todos : "depends_on"

    permission_presets ||--o{ tool_permissions : "defines"

    users {
        uniqueidentifier id PK
        nvarchar email UK
        nvarchar password_hash NULL
        nvarchar full_name
        bit is_active
        bit is_admin
        nvarchar role
        nvarchar microsoft_id UK
        nvarchar microsoft_email
        nvarchar microsoft_tenant_id
        datetime2 last_microsoft_login
        nvarchar bc_access_token_encrypted
        nvarchar bc_refresh_token_encrypted
        datetime2 bc_token_expires_at
        datetime2 created_at
        datetime2 updated_at
    }

    sessions {
        uniqueidentifier id PK
        uniqueidentifier user_id FK
        nvarchar title
        bit is_active
        datetime2 created_at
        datetime2 updated_at
    }

    message_events {
        uniqueidentifier id PK
        uniqueidentifier session_id FK
        nvarchar event_type
        int sequence_number UK
        datetime2 timestamp
        nvarchar data
        bit processed
    }

    messages {
        uniqueidentifier id PK
        uniqueidentifier session_id FK
        uniqueidentifier event_id FK
        nvarchar role
        nvarchar content
        nvarchar metadata
        int token_count
        nvarchar message_type
        nvarchar stop_reason
        int sequence_number
        nvarchar tool_use_id
        datetime2 created_at
    }

    approvals {
        uniqueidentifier id PK
        uniqueidentifier session_id FK
        uniqueidentifier message_id FK
        uniqueidentifier decided_by_user_id FK
        nvarchar action_type
        nvarchar action_description
        nvarchar action_data
        nvarchar status
        nvarchar tool_name
        nvarchar tool_args
        nvarchar rejection_reason
        nvarchar priority
        datetime2 expires_at
        datetime2 decided_at
        datetime2 created_at
    }

    todos {
        uniqueidentifier id PK
        uniqueidentifier session_id FK
        uniqueidentifier parent_todo_id FK
        nvarchar content
        nvarchar activeForm
        nvarchar description
        nvarchar status
        int order
        nvarchar dependencies
        nvarchar metadata
        datetime2 created_at
        datetime2 started_at
        datetime2 completed_at
    }

    checkpoints {
        uniqueidentifier id PK
        uniqueidentifier session_id FK
        nvarchar checkpoint_name
        nvarchar checkpoint_data
        datetime2 created_at
    }

    agent_executions {
        uniqueidentifier id PK
        uniqueidentifier session_id FK
        nvarchar agent_type
        nvarchar action
        nvarchar input_data
        nvarchar output_data
        nvarchar status
        nvarchar error_message
        nvarchar error_stack
        int duration_ms
        int tokens_used
        int thinking_tokens
        datetime2 created_at
        datetime2 completed_at
    }

    session_files {
        uniqueidentifier id PK
        uniqueidentifier session_id FK
        nvarchar file_name
        nvarchar file_path
        nvarchar file_type
        bigint file_size_bytes
        nvarchar mime_type
        nvarchar content_hash
        bit is_active
        nvarchar metadata
        datetime2 created_at
        datetime2 removed_at
    }

    audit_log {
        uniqueidentifier id PK
        uniqueidentifier user_id FK
        uniqueidentifier session_id FK
        uniqueidentifier entity_id
        nvarchar action
        nvarchar entity_type
        nvarchar event_type
        nvarchar details
        nvarchar event_data
        nvarchar ip_address
        nvarchar user_agent
        datetime2 created_at
    }

    performance_metrics {
        uniqueidentifier id PK
        uniqueidentifier session_id FK
        nvarchar metric_name
        float metric_value
        nvarchar metric_unit
        nvarchar tags
        datetime2 created_at
    }

    tool_permissions {
        uniqueidentifier id PK
        uniqueidentifier user_id FK
        nvarchar tool_name
        bit is_allowed
        bit requires_approval
        datetime2 created_at
        datetime2 updated_at
    }

    permission_presets {
        uniqueidentifier id PK
        nvarchar name UK
        nvarchar description
        nvarchar permissions
        bit is_active
        datetime2 created_at
        datetime2 updated_at
    }
```

---

## Complete DDL (Data Definition Language)

### Core Tables

#### 1. users

**Purpose**: User profiles with Microsoft OAuth integration and encrypted BC tokens

```sql
CREATE TABLE users (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    email NVARCHAR(255) UNIQUE NOT NULL,
    password_hash NVARCHAR(255) NULL,  -- Optional, for fallback auth
    full_name NVARCHAR(255) NULL,
    is_active BIT NOT NULL DEFAULT 1,
    is_admin BIT NOT NULL DEFAULT 0,
    role NVARCHAR(50) NOT NULL DEFAULT 'viewer',

    -- Microsoft OAuth (Migration 005)
    microsoft_id NVARCHAR(255) UNIQUE NULL,  -- From Microsoft Entra ID
    microsoft_email NVARCHAR(255) NULL,
    microsoft_tenant_id NVARCHAR(255) NULL,
    last_microsoft_login DATETIME2 NULL,

    -- BC token encryption (per-user tokens)
    bc_access_token_encrypted NVARCHAR(MAX) NULL,  -- AES-256-GCM
    bc_refresh_token_encrypted NVARCHAR(MAX) NULL,
    bc_token_expires_at DATETIME2 NULL,

    -- Timestamps
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETDATE()
);

-- Indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_microsoft_id ON users(microsoft_id) WHERE microsoft_id IS NOT NULL;
CREATE INDEX idx_users_is_active ON users(is_active);
```

**Key Features**:
- Hybrid authentication (Microsoft OAuth + optional password)
- Per-user Business Central tokens (encrypted at rest)
- Role-based access control (viewer/editor/admin)

---

#### 2. sessions

**Purpose**: Chat sessions metadata

```sql
CREATE TABLE sessions (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id UNIQUEIDENTIFIER NOT NULL,
    title NVARCHAR(500) NOT NULL DEFAULT 'New Chat',
    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETDATE(),

    -- Foreign Keys
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_is_active ON sessions(is_active);
CREATE INDEX idx_sessions_updated_at ON sessions(updated_at DESC);
```

**Key Features**:
- Simple session metadata (complex data in message_events)
- Soft delete via `is_active` flag
- Cascade delete removes all related data

---

#### 3. message_events ⭐ NEW - Event Sourcing

**Purpose**: Append-only event log for message streaming (Event Sourcing pattern)

```sql
CREATE TABLE message_events (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    session_id UNIQUEIDENTIFIER NOT NULL,
    event_type NVARCHAR(50) NOT NULL,  -- 'message_start', 'content_block_delta', 'message_stop', etc.
    sequence_number INT NOT NULL,       -- Atomic sequence via Redis INCR
    timestamp DATETIME2 NOT NULL DEFAULT GETDATE(),
    data NVARCHAR(MAX) NOT NULL,        -- JSON event payload
    processed BIT NOT NULL DEFAULT 0,   -- For async processing queue

    -- Foreign Keys
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,

    -- Unique constraint on sequence per session
    UNIQUE (session_id, sequence_number)
);

-- Indexes
CREATE INDEX idx_message_events_session ON message_events(session_id, sequence_number);
CREATE INDEX idx_message_events_processed ON message_events(processed) WHERE processed = 0;
CREATE INDEX idx_message_events_type ON message_events(event_type);
```

**Key Features**:
- Immutable event log (no updates, only inserts)
- Atomic sequence numbers via Redis INCR
- BullMQ async processing via `processed` flag
- Foundation for CQRS pattern (events → materialized messages)

**Event Types**:
- `message_start` - Message initiated
- `content_block_start` - Content block started
- `content_block_delta` - Incremental content chunk
- `content_block_stop` - Content block finished
- `message_delta` - Message-level delta
- `message_stop` - Message completed (includes stop_reason)

---

#### 4. messages

**Purpose**: Materialized view of complete messages (built from message_events)

```sql
CREATE TABLE messages (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    session_id UNIQUEIDENTIFIER NOT NULL,
    event_id UNIQUEIDENTIFIER NULL,     -- FK to message_events (source event)
    role NVARCHAR(50) NOT NULL,         -- 'user', 'assistant'
    content NVARCHAR(MAX) NOT NULL,
    metadata NVARCHAR(MAX) NULL,        -- JSON for tool calls, thinking, etc.
    token_count INT NULL,
    message_type NVARCHAR(20) NOT NULL DEFAULT 'text',  -- 'text', 'thinking', 'tool_use', 'tool_result'
    stop_reason NVARCHAR(20) NULL,      -- 'end_turn', 'tool_use', 'max_tokens'
    sequence_number INT NULL,           -- Links to message_events.sequence_number
    tool_use_id NVARCHAR(255) NULL,     -- Anthropic SDK tool_use block ID (e.g., toolu_01ABC123) for correlating tool_use and tool_result
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),

    -- Foreign Keys
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES message_events(id) ON DELETE NO ACTION,

    -- Constraints
    CONSTRAINT chk_messages_role CHECK (role IN ('user', 'assistant')),
    CONSTRAINT chk_messages_type CHECK (message_type IN ('text', 'thinking', 'tool_use', 'tool_result', 'error')),
    CONSTRAINT chk_messages_stop_reason CHECK (stop_reason IN ('end_turn', 'tool_use', 'max_tokens', 'stop_sequence'))
);

-- Indexes
CREATE INDEX idx_messages_session ON messages(session_id, created_at);
CREATE INDEX idx_messages_event ON messages(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX idx_messages_type ON messages(message_type);
CREATE INDEX idx_messages_stop_reason ON messages(stop_reason) WHERE stop_reason IS NOT NULL;
CREATE INDEX idx_messages_tool_use_id ON messages(tool_use_id) WHERE tool_use_id IS NOT NULL;
```

**Key Features**:
- Materialized from `message_events` (async via BullMQ)
- `stop_reason` controls agentic loop (tool_use = continue, end_turn = stop)
- `message_type` discriminates text/thinking/tool_use/tool_result
- `metadata` stores structured data (tool args, thinking blocks)
- `tool_use_id` correlates tool_use messages with their tool_result messages (same ID for both)
- `sequence_number` provides guaranteed ordering via Redis INCR (replaces timestamp-based ordering)

---

#### 5. approvals

**Purpose**: Human-in-the-loop approval requests for write operations

```sql
CREATE TABLE approvals (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    session_id UNIQUEIDENTIFIER NOT NULL,
    message_id UNIQUEIDENTIFIER NULL,             -- Message that triggered approval
    decided_by_user_id UNIQUEIDENTIFIER NULL,     -- User who approved/rejected
    action_type NVARCHAR(100) NOT NULL,           -- 'bc_create', 'bc_update', 'bc_delete'
    action_description NVARCHAR(MAX) NOT NULL,    -- Human-readable description
    action_data NVARCHAR(MAX) NULL,               -- JSON with parameters
    tool_name NVARCHAR(100) NOT NULL,             -- Tool that requires approval
    tool_args NVARCHAR(MAX) NULL,                 -- JSON tool arguments
    status NVARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'approved', 'rejected', 'expired'
    priority NVARCHAR(20) NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high'
    rejection_reason NVARCHAR(MAX) NULL,
    expires_at DATETIME2 NULL,                    -- Auto-expire after 5 minutes
    decided_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),

    -- Foreign Keys
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE NO ACTION,
    FOREIGN KEY (decided_by_user_id) REFERENCES users(id) ON DELETE NO ACTION,

    -- Constraints
    CONSTRAINT chk_approvals_status CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    CONSTRAINT chk_approvals_priority CHECK (priority IN ('low', 'medium', 'high'))
);

-- Indexes
CREATE INDEX idx_approvals_session ON approvals(session_id, created_at DESC);
CREATE INDEX idx_approvals_status ON approvals(status) WHERE status = 'pending';
CREATE INDEX idx_approvals_expires ON approvals(expires_at) WHERE status = 'pending';
CREATE INDEX idx_approvals_message ON approvals(message_id) WHERE message_id IS NOT NULL;
```

**Key Features**:
- Linked to specific message that triggered approval
- Tool name + args for execution after approval
- Auto-expiry via cron job (5-minute default)
- Priority levels for UI sorting

---

#### 6. checkpoints

**Purpose**: Session state snapshots for rollback

```sql
CREATE TABLE checkpoints (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    session_id UNIQUEIDENTIFIER NOT NULL,
    checkpoint_name NVARCHAR(255) NOT NULL,
    checkpoint_data NVARCHAR(MAX) NOT NULL,  -- JSON snapshot
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),

    -- Foreign Keys
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_checkpoints_session ON checkpoints(session_id, created_at DESC);
```

**Key Features**:
- Named checkpoints for user-triggered snapshots
- JSON snapshot includes conversation history + context
- Rollback restores session to checkpoint state

---

### Advanced Tables

#### 7. todos

**Purpose**: Hierarchical todo tracking with dependencies

```sql
CREATE TABLE todos (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    session_id UNIQUEIDENTIFIER NOT NULL,
    parent_todo_id UNIQUEIDENTIFIER NULL,        -- For hierarchical todos
    content NVARCHAR(500) NOT NULL,              -- Imperative form ("Create customer")
    activeForm NVARCHAR(500) NOT NULL,           -- Present continuous ("Creating customer")
    description NVARCHAR(MAX) NULL,
    status NVARCHAR(50) NOT NULL DEFAULT 'pending',  -- 'pending', 'in_progress', 'completed'
    [order] INT NOT NULL DEFAULT 0,              -- Display order
    dependencies NVARCHAR(MAX) NULL,             -- JSON array of todo IDs
    metadata NVARCHAR(MAX) NULL,                 -- JSON for extra data
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    started_at DATETIME2 NULL,
    completed_at DATETIME2 NULL,

    -- Foreign Keys
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_todo_id) REFERENCES todos(id) ON DELETE NO ACTION,

    -- Constraints
    CONSTRAINT chk_todos_status CHECK (status IN ('pending', 'in_progress', 'completed'))
);

-- Indexes
CREATE INDEX idx_todos_session ON todos(session_id, [order]);
CREATE INDEX idx_todos_status ON todos(status);
CREATE INDEX idx_todos_parent ON todos(parent_todo_id) WHERE parent_todo_id IS NOT NULL;
```

**Key Features**:
- Hierarchical structure (parent-child relationships)
- Dependency tracking (JSON array of IDs)
- Dual forms: content (command) + activeForm (UI display)

---

#### 8. agent_executions

**Purpose**: Agent execution metadata and performance tracking

```sql
CREATE TABLE agent_executions (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    session_id UNIQUEIDENTIFIER NOT NULL,
    agent_type NVARCHAR(100) NULL,           -- 'bc-query', 'bc-write', etc.
    action NVARCHAR(100) NOT NULL,           -- Action name
    input_data NVARCHAR(MAX) NULL,           -- JSON input
    output_data NVARCHAR(MAX) NULL,          -- JSON output
    status NVARCHAR(50) NOT NULL,            -- 'running', 'completed', 'error'
    error_message NVARCHAR(MAX) NULL,
    error_stack NVARCHAR(MAX) NULL,
    duration_ms INT NULL,
    tokens_used INT NULL,
    thinking_tokens INT NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    completed_at DATETIME2 NULL,

    -- Foreign Keys
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,

    -- Constraints
    CONSTRAINT chk_agent_executions_status CHECK (status IN ('running', 'completed', 'error', 'timeout'))
);

-- Indexes
CREATE INDEX idx_agent_executions_session ON agent_executions(session_id, created_at DESC);
CREATE INDEX idx_agent_executions_status ON agent_executions(status);
```

**Key Features**:
- Tracks DirectAgentService executions
- Performance metrics (duration, tokens)
- Error tracking with stack traces

---

#### 9. tool_permissions

**Purpose**: Per-user tool permission overrides

```sql
CREATE TABLE tool_permissions (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id UNIQUEIDENTIFIER NOT NULL,
    tool_name NVARCHAR(100) NOT NULL,
    is_allowed BIT NOT NULL DEFAULT 1,
    requires_approval BIT NOT NULL DEFAULT 0,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETDATE(),

    -- Foreign Keys
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

    -- Unique constraint
    UNIQUE (user_id, tool_name)
);

-- Indexes
CREATE INDEX idx_tool_permissions_user ON tool_permissions(user_id);
CREATE INDEX idx_tool_permissions_tool ON tool_permissions(tool_name);
```

**Key Features**:
- Granular per-user tool permissions
- Two-level control: is_allowed + requires_approval
- Overrides role-based defaults

---

#### 10. permission_presets

**Purpose**: Role-based permission templates

```sql
CREATE TABLE permission_presets (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    name NVARCHAR(100) UNIQUE NOT NULL,
    description NVARCHAR(500) NULL,
    permissions NVARCHAR(MAX) NOT NULL,  -- JSON permissions map
    is_active BIT NOT NULL DEFAULT 1,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETDATE()
);

-- Indexes
CREATE INDEX idx_permission_presets_name ON permission_presets(name);
CREATE INDEX idx_permission_presets_active ON permission_presets(is_active);
```

**Example permissions JSON**:
```json
{
  "bc_query": { "allowed": true, "requiresApproval": false },
  "bc_create": { "allowed": true, "requiresApproval": true },
  "bc_update": { "allowed": true, "requiresApproval": true },
  "bc_delete": { "allowed": false, "requiresApproval": false }
}
```

---

### Observability Tables

#### 11. audit_log

**Purpose**: Audit trail for all system actions

```sql
CREATE TABLE audit_log (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id UNIQUEIDENTIFIER NULL,
    session_id UNIQUEIDENTIFIER NULL,
    entity_id UNIQUEIDENTIFIER NULL,
    action NVARCHAR(100) NOT NULL,
    entity_type NVARCHAR(100) NULL,
    event_type NVARCHAR(100) NOT NULL,
    details NVARCHAR(MAX) NULL,      -- Human-readable description
    event_data NVARCHAR(MAX) NULL,   -- JSON event payload
    ip_address NVARCHAR(50) NULL,
    user_agent NVARCHAR(500) NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),

    -- Foreign Keys
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

-- Indexes
CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_log_session ON audit_log(session_id, created_at DESC);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_event_type ON audit_log(event_type);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);
```

**Common event_type values**:
- `user.login`, `user.logout`, `user.created`
- `session.created`, `session.deleted`
- `approval.requested`, `approval.approved`, `approval.rejected`
- `bc.query`, `bc.create`, `bc.update`, `bc.delete`
- `error.critical`, `error.warning`

---

#### 12. performance_metrics

**Purpose**: Time-series performance metrics

```sql
CREATE TABLE performance_metrics (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    session_id UNIQUEIDENTIFIER NULL,
    metric_name NVARCHAR(100) NOT NULL,
    metric_value FLOAT NOT NULL,
    metric_unit NVARCHAR(50) NULL,      -- 'ms', 'tokens', 'bytes', etc.
    tags NVARCHAR(MAX) NULL,            -- JSON for multi-dimensional metrics
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),

    -- Foreign Keys
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_performance_metrics_session ON performance_metrics(session_id, created_at);
CREATE INDEX idx_performance_metrics_name ON performance_metrics(metric_name, created_at);
```

**Example metrics**:
- `agent.duration` (value: 1234, unit: 'ms')
- `agent.tokens_used` (value: 5000, unit: 'tokens')
- `api.latency` (value: 250, unit: 'ms')
- `tool.execution_time` (value: 500, unit: 'ms')

**Example tags JSON**:
```json
{
  "tool_name": "bc_query_customers",
  "status": "success",
  "agent_type": "bc-query"
}
```

---

### File Management

#### 13. session_files

**Purpose**: Track files in session context

```sql
CREATE TABLE session_files (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    session_id UNIQUEIDENTIFIER NOT NULL,
    file_name NVARCHAR(255) NOT NULL,
    file_path NVARCHAR(500) NOT NULL,
    file_type NVARCHAR(100) NOT NULL,
    file_size_bytes BIGINT NULL,
    mime_type NVARCHAR(100) NULL,
    content_hash NVARCHAR(255) NULL,   -- SHA-256 hash for deduplication
    is_active BIT NOT NULL DEFAULT 1,
    metadata NVARCHAR(MAX) NULL,       -- JSON for extra data
    created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
    removed_at DATETIME2 NULL,

    -- Foreign Keys
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_session_files_session ON session_files(session_id, is_active);
CREATE INDEX idx_session_files_hash ON session_files(content_hash) WHERE content_hash IS NOT NULL;
```

**Key Features**:
- File metadata (no binary storage in DB)
- Content hash for deduplication
- Soft delete via `is_active` flag

---

## Foreign Key Summary (15 total)

| Parent Table | Column | Referenced Table | Column | On Delete |
|--------------|--------|------------------|--------|-----------|
| agent_executions | session_id | sessions | id | CASCADE |
| approvals | session_id | sessions | id | CASCADE |
| approvals | message_id | messages | id | NO_ACTION |
| approvals | decided_by_user_id | users | id | NO_ACTION |
| audit_log | user_id | users | id | SET_NULL |
| checkpoints | session_id | sessions | id | CASCADE |
| message_events | session_id | sessions | id | CASCADE |
| messages | session_id | sessions | id | CASCADE |
| messages | event_id | message_events | id | NO_ACTION |
| performance_metrics | session_id | sessions | id | CASCADE |
| session_files | session_id | sessions | id | CASCADE |
| sessions | user_id | users | id | CASCADE |
| todos | session_id | sessions | id | CASCADE |
| todos | parent_todo_id | todos | id | NO_ACTION |
| tool_permissions | user_id | users | id | CASCADE |

---

## Connection Configuration

### Connection String Format

```
Server=tcp:sqlsrv-bcagent-dev.database.windows.net,1433;
Database=sqldb-bcagent-dev;
User Id=bcagentadmin;
Password=<from .env>;
Encrypt=true;
TrustServerCertificate=false;
Connection Timeout=30;
```

### Environment Variables

```env
DATABASE_SERVER=sqlsrv-bcagent-dev.database.windows.net
DATABASE_NAME=sqldb-bcagent-dev
DATABASE_USER=bcagentadmin
DATABASE_PASSWORD=<secret>
```

### Code Example (mssql package)

```typescript
import sql from 'mssql';

const config = {
  server: 'tcp:sqlsrv-bcagent-dev.database.windows.net',
  database: 'sqldb-bcagent-dev',
  user: 'bcagentadmin',
  password: process.env.DATABASE_PASSWORD,
  options: {
    encrypt: true,
    trustServerCertificate: false
  },
  pool: {
    max: 10,
    min: 1,
    idleTimeoutMillis: 300000  // 5 minutes
  }
};

const pool = await sql.connect(config);
```

---

## Key Architecture Patterns

### 1. Event Sourcing

**Pattern**: Append-only event log → Materialized views

**Implementation**:
- `message_events` = Immutable event log
- `messages` = Materialized view (built async via BullMQ)
- Atomic sequence numbers via Redis INCR
- Full replay capability for debugging

**Benefits**:
- Complete audit trail
- Time-travel debugging
- CQRS pattern support
- Stream processing ready

### 2. Human-in-the-Loop (HITL)

**Pattern**: Approval requests for high-risk operations

**Implementation**:
- Agent detects write operation
- Creates `approval` record (status=pending)
- WebSocket notifies user
- User approves/rejects via UI
- Tool executed only if approved

**Benefits**:
- User control over destructive operations
- Audit trail of all approvals
- Timeout protection (auto-expire)

### 3. Hierarchical Todos

**Pattern**: Parent-child relationships + dependency tracking

**Implementation**:
- `parent_todo_id` for tree structure
- `dependencies` JSON array for cross-branch deps
- `order` field for manual sorting
- Dual forms: `content` + `activeForm`

**Benefits**:
- Complex task breakdowns
- Dependency resolution
- Progress tracking

---

## Security Considerations

### 1. Encryption at Rest

- BC tokens encrypted with AES-256-GCM
- Encryption key stored in Azure Key Vault
- Per-user token storage (not global credentials)

### 2. SQL Injection Prevention

**Always use parameterized queries**:

```typescript
// ✅ CORRECT
const result = await pool.request()
  .input('userId', sql.UniqueIdentifier, userId)
  .query('SELECT * FROM users WHERE id = @userId');

// ❌ WRONG (SQL injection risk)
const result = await pool.query(`SELECT * FROM users WHERE id = '${userId}'`);
```

### 3. Row-Level Security (Future)

Planned implementation:

```sql
CREATE SECURITY POLICY users_rls_policy
ADD FILTER PREDICATE dbo.fn_user_access(user_id) ON dbo.sessions,
ADD FILTER PREDICATE dbo.fn_user_access(user_id) ON dbo.messages;
```

---

## Common Queries

### 1. Get Session with Complete History

```sql
-- Get session metadata + message count + approval count
SELECT
    s.id AS session_id,
    s.title,
    s.is_active,
    s.created_at,
    (SELECT COUNT(*) FROM messages WHERE session_id = s.id) AS message_count,
    (SELECT COUNT(*) FROM approvals WHERE session_id = s.id AND status = 'pending') AS pending_approvals,
    (SELECT COUNT(*) FROM todos WHERE session_id = s.id AND status != 'completed') AS pending_todos
FROM sessions s
WHERE s.id = @sessionId;

-- Get all messages in order
SELECT
    id,
    role,
    content,
    message_type,
    stop_reason,
    created_at
FROM messages
WHERE session_id = @sessionId
ORDER BY sequence_number ASC;

-- Get all events for replay
SELECT
    id,
    event_type,
    sequence_number,
    timestamp,
    data
FROM message_events
WHERE session_id = @sessionId
ORDER BY sequence_number ASC;
```

### 2. Create Approval Request

```sql
-- Agent requests approval
INSERT INTO approvals (
    session_id,
    message_id,
    action_type,
    action_description,
    action_data,
    tool_name,
    tool_args,
    status,
    priority,
    expires_at
) VALUES (
    @sessionId,
    @messageId,
    'bc_create',
    'Create new customer: Acme Corp',
    '{"name": "Acme Corp", "email": "contact@acme.com"}',
    'bc_create_customer',
    '{"name": "Acme Corp", "email": "contact@acme.com"}',
    'pending',
    'high',
    DATEADD(minute, 5, GETDATE())
);

-- Auto-expire old approvals (cron job)
UPDATE approvals
SET status = 'expired'
WHERE status = 'pending'
  AND expires_at < GETDATE();
```

### 3. Event Sourcing: Append Event + Get Sequence

```typescript
// 1. Get next sequence number (atomic via Redis)
const sequenceNumber = await redisClient.incr(`session:${sessionId}:sequence`);

// 2. Append event (immutable)
await pool.request()
  .input('id', sql.UniqueIdentifier, newid())
  .input('sessionId', sql.UniqueIdentifier, sessionId)
  .input('eventType', sql.NVarChar, 'message_delta')
  .input('sequenceNumber', sql.Int, sequenceNumber)
  .input('data', sql.NVarChar, JSON.stringify(eventData))
  .query(`
    INSERT INTO message_events (id, session_id, event_type, sequence_number, data)
    VALUES (@id, @sessionId, @eventType, @sequenceNumber, @data)
  `);
```

### 4. Performance Metrics Query

```sql
-- P50, P95, P99 latency for agent operations
SELECT
    metric_name,
    COUNT(*) AS total_operations,
    AVG(metric_value) AS avg_value,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY metric_value) AS p50,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY metric_value) AS p95,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY metric_value) AS p99
FROM performance_metrics
WHERE metric_name LIKE 'agent.%'
  AND metric_unit = 'ms'
  AND created_at >= DATEADD(day, -1, GETDATE())
GROUP BY metric_name
ORDER BY avg_value DESC;
```

---

## Migration History

### Initial Schema (init-db.sql)
**Date**: 2025-01-09
**Tables**: 7 (users, sessions, messages, approvals, checkpoints, refresh_tokens, audit_log)

### Migration 001 - Advanced Features
**Date**: 2025-01-10
**Added**: todos, tool_permissions, permission_presets, agent_executions

### Migration 002 - Observability
**Date**: 2025-01-11
**Added**: performance_metrics, session_files

### Migration 003 - RBAC
**Date**: 2025-01-11
**Added**: `role` column to users

### Migration 004 - Approval Priority
**Date**: 2025-11-10
**Added**: `priority`, `expires_at` to approvals

### Migration 005 - Microsoft OAuth
**Date**: 2025-01-11
**Added**: `microsoft_id`, `microsoft_email`, `microsoft_tenant_id`, BC token columns
**Removed**: `password_hash` (now nullable for hybrid auth)

### Migration 006 - Drop Refresh Tokens
**Date**: 2025-01-11
**Removed**: `refresh_tokens` table (session cookies replace JWT)

### Migration 007 - Message Types
**Date**: 2025-11-15
**Added**: `message_type` to messages

### Migration 008 - Stop Reason
**Date**: 2025-11-17
**Added**: `stop_reason` to messages (native SDK lifecycle)

### Migration 009 - Event Sourcing (UNDOCUMENTED UNTIL NOW)
**Date**: Unknown (estimated 2025-11-18)
**Added**: `message_events` table, `event_id` + `sequence_number` to messages
**Purpose**: Implement Event Sourcing pattern for message streaming

---

## Related Documents

- **Backend Architecture**: `docs/backend/architecture-deep-dive.md`
- **WebSocket Events**: `docs/backend/websocket-contract.md`
- **SDK Messages**: `docs/backend/06-sdk-message-structures.md`
- **Authentication**: `docs/backend/authentication.md`

---

**Document Version**: 2.0 (COMPLETE REWRITE)
**Last Audited**: 2025-11-20
**Database Version**: 13/13 tables functional ✅
**Audit Script**: `backend/scripts/temp-audit-schema-v2.sql`
**Maintainer**: BC-Claude-Agent Team
