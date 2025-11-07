# Manual Testing Guide

Comprehensive manual testing guide for BC Claude Agent backend.

## Prerequisites

1. **Backend server running**:
   ```bash
   cd backend
   npm run dev
   ```
   Server should be running on `http://localhost:3001`

2. **Database accessible**:
   - Azure SQL database configured and connected
   - Tables created (users, sessions, approvals, todos, etc.)

3. **MCP server** (optional for full testing):
   - MCP server accessible (may require Azure VPN)
   - Business Central configured

4. **Environment variables set**:
   - `ANTHROPIC_API_KEY`
   - `JWT_SECRET`
   - Database credentials
   - Redis credentials (optional)

## Quick Test Suite

### Run All Test Scripts

```bash
cd backend

# 1. Test WebSocket connection
npx ts-node scripts/test-websocket-connection.ts

# 2. Test basic chat flow
npx ts-node scripts/test-chat-flow.ts

# 3. Test approval flow
npx ts-node scripts/test-approval-flow.ts

# 4. Test approval rejection
npx ts-node scripts/test-approval-rejection.ts

# 5. Test todo tracking
npx ts-node scripts/test-todo-tracking.ts
```

## Manual Test Scenarios

### Scenario 1: Simple Query

**Goal**: Test basic agent query without tool calling.

**Steps**:
1. Connect to WebSocket (use test script or frontend)
2. Send message: "Hello, what can you do?"
3. **Expected**: Agent responds with its capabilities
4. **Verify**: No MCP tools called

**Success Criteria**:
- ✅ Message received
- ✅ Agent response streamed
- ✅ No errors

---

### Scenario 2: Read Query (Query Agent)

**Goal**: Test read-only BC query via MCP.

**Steps**:
1. Send message: "List the first 5 customers from Business Central"
2. **Expected**: Agent calls `bc_query_customers` or similar MCP tool
3. **Expected**: Results formatted and returned

**Success Criteria**:
- ✅ MCP tool called
- ✅ Results returned
- ✅ No approval requested (read-only)

**Note**: Requires MCP server access

---

### Scenario 3: Write with Approval

**Goal**: Test write operation with approval flow.

**Steps**:
1. Send message: "Create a customer named Acme Corp with email acme@example.com"
2. **Expected**: Approval request event emitted
3. Review approval summary
4. Approve the operation
5. **Expected**: Tool executes, customer created

**WebSocket Events**:
1. `todo:created` - Todos generated
2. `approval:requested` - Approval UI shows
3. User approves → `approval:response` emitted
4. `approval:resolved` - Approval confirmed
5. `agent:tool_use` - Tool called
6. `agent:tool_result` - Tool completed
7. `todo:completed` - Todo marked done
8. `agent:complete` - Agent finished

**Success Criteria**:
- ✅ Approval requested before write
- ✅ Change summary clear
- ✅ Tool executes after approval
- ✅ Customer created in BC
- ✅ Todos tracked

**Note**: Requires MCP server access

---

### Scenario 4: Approval Rejection

**Goal**: Test that rejections cancel operations.

**Steps**:
1. Send message: "Update customer X"
2. **Expected**: Approval request
3. **Reject** the operation
4. **Expected**: Agent error "Operation rejected by user"
5. **Expected**: Tool NOT executed

**Success Criteria**:
- ✅ Approval requested
- ✅ Rejection acknowledged
- ✅ Tool NOT called
- ✅ Error message clear
- ✅ Todo marked failed

---

### Scenario 5: Multi-Step Task

**Goal**: Test todo list auto-generation and tracking.

**Steps**:
1. Send message: "Create 3 customers: Acme Corp, Beta Inc, Gamma LLC"
2. **Expected**: 3 todos created automatically
3. **Expected**: Each todo updated as agent progresses
4. **Expected**: 3 approval requests (one per customer)
5. Approve each one
6. **Expected**: All todos completed

**WebSocket Events Flow**:
```
todo:created → [3 todos: pending]
↓
approval:requested (Acme Corp)
→ approve
todo:updated → [Acme Corp: in_progress]
agent:tool_use
agent:tool_result
todo:completed → [Acme Corp: completed]
↓
approval:requested (Beta Inc)
→ approve
todo:updated → [Beta Inc: in_progress]
agent:tool_use
agent:tool_result
todo:completed → [Beta Inc: completed]
↓
approval:requested (Gamma LLC)
→ approve
todo:updated → [Gamma LLC: in_progress]
agent:tool_use
agent:tool_result
todo:completed → [Gamma LLC: completed]
↓
agent:complete
```

**Success Criteria**:
- ✅ Todos auto-generated (3 items)
- ✅ Todos updated in real-time
- ✅ All todos marked completed
- ✅ 3 customers created in BC

**Note**: Requires MCP server access

---

### Scenario 6: Error Handling

**Goal**: Test error handling and recovery.

**Steps**:
1. Send invalid request: "Create customer with invalid data"
2. **Expected**: Validation error caught
3. **Expected**: Clear error message to user
4. **Expected**: Todo marked failed (not completed)

**Success Criteria**:
- ✅ Error caught gracefully
- ✅ User-friendly error message
- ✅ No crash
- ✅ Agent recovers

---

### Scenario 7: Session Management

**Goal**: Test session join/leave and room management.

**Steps**:
1. Connect socket 1
2. Emit `session:join` with `sessionId: "test-session"`
3. Connect socket 2
4. Emit `session:join` with same `sessionId`
5. Send message from socket 1
6. **Expected**: Both sockets receive events
7. Socket 2 emits `session:leave`
8. Send another message from socket 1
9. **Expected**: Only socket 1 receives events

**Success Criteria**:
- ✅ Multiple clients can join same session
- ✅ Events broadcasted to all clients in room
- ✅ Leave works correctly

---

## API Endpoint Tests

### Test Authentication Endpoints

```bash
# 1. Register
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test1234",
    "name": "Test User"
  }'

# 2. Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test1234"
  }'

# Save the accessToken from response

# 3. Get current user
curl -X GET http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Test Approval Endpoints

```bash
# Get pending approvals for session
curl -X GET http://localhost:3001/api/approvals/session/test-session-123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Respond to approval (requires approval ID from WebSocket event)
curl -X POST http://localhost:3001/api/approvals/APPROVAL_ID/respond \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "decision": "approved",
    "reason": "Looks good"
  }'
```

### Test Todo Endpoints

```bash
# Get todos for session
curl -X GET http://localhost:3001/api/todos/session/test-session-123 \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Test Agent Endpoint

```bash
# Execute agent query (HTTP, not streaming)
curl -X POST http://localhost:3001/api/agent/query \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What can you do?",
    "sessionId": "test-session-123"
  }'
```

---

## Troubleshooting

### WebSocket Connection Fails

**Error**: `Connection error: xhr poll error`

**Solution**:
1. Check backend is running: `curl http://localhost:3001/health`
2. Check firewall allows port 3001
3. Try different transport: `transports: ['polling']` or `['websocket']`

### Approval Timeout

**Issue**: Approval expires before user responds

**Solution**:
- Default timeout is 5 minutes
- Check `ApprovalManager.ts` line 71 for timeout configuration
- Increase timeout if needed for testing

### MCP Tools Not Available

**Issue**: `MCP Service not reachable`

**Solution**:
- This is expected when running locally (MCP requires Azure network)
- Agent will work for non-MCP operations (simple chat)
- Deploy to Azure to test BC integration fully

### Database Connection Errors

**Issue**: `Database connection not available`

**Solution**:
1. Check `.env` has correct database credentials
2. Verify Azure SQL firewall allows your IP
3. Test connection: `npx ts-node scripts/test-db-connection.ts` (if exists)

### JWT Token Expired

**Issue**: `401 Unauthorized`

**Solution**:
- Access tokens expire after 24 hours
- Refresh token: `POST /api/auth/refresh` with refresh token
- Or login again: `POST /api/auth/login`

---

## Test Checklist

Use this checklist to verify all functionality:

### Core Functionality
- [ ] WebSocket connection works
- [ ] Basic chat messages work
- [ ] Agent responds to queries
- [ ] Event streaming works

### Approval System
- [ ] Approval requested for writes
- [ ] Approval dialog shows change summary
- [ ] Approve works → tool executes
- [ ] Reject works → tool cancelled
- [ ] Approval timeout works

### Todo System
- [ ] Todos auto-generated from prompt
- [ ] Todos show in UI (pending status)
- [ ] Todos update to in_progress
- [ ] Todos update to completed/failed
- [ ] Multiple todos tracked correctly

### Authentication
- [ ] Register works
- [ ] Login works
- [ ] JWT tokens work
- [ ] Protected routes require auth
- [ ] Token refresh works

### Error Handling
- [ ] Network errors handled
- [ ] BC API errors handled
- [ ] Invalid input handled
- [ ] Timeout handled
- [ ] User-friendly error messages

### Session Management
- [ ] Multiple clients can join session
- [ ] Events broadcast to all clients
- [ ] Leave session works
- [ ] Session persistence works

---

## Performance Benchmarks

Expected response times:

- **WebSocket connection**: < 500ms
- **Simple query (no tools)**: 2-5 seconds
- **BC query (with MCP)**: 5-10 seconds
- **BC write (with approval)**: 10-30 seconds (depends on user response time)
- **Multi-step (3 operations)**: 30-60 seconds

---

## Next Steps

After manual testing passes:

1. **Automated E2E Tests** (Week 8):
   - Playwright tests
   - Integration tests
   - CI/CD pipeline

2. **Frontend Integration** (Week 5-6):
   - Connect real UI to backend
   - Test with actual user interactions

3. **Azure Deployment** (Phase 3):
   - Deploy to Azure Container Apps
   - Test with real MCP server
   - Full BC integration testing

---

**Last Updated**: 2025-01-07
**Version**: 1.0
