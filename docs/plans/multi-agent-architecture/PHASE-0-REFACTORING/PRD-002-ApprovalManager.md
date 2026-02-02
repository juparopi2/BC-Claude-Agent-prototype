# PRD-002: Human-in-the-Loop with interrupt()

**Estado**: Draft
**Prioridad**: Media
**Dependencias**: PRD-030 (Supervisor Integration)
**Bloquea**: Ninguno

---

## 1. Objetivo

Implementar flujos Human-in-the-Loop usando `interrupt()` nativo de LangGraph para operaciones que requieren aprobación humana.

---

## 2. Arquitectura

```
User Request
    │
    ▼
┌─────────────────────────────┐
│     Supervisor Graph        │
│                             │
│  ┌─────────────────────┐   │
│  │  Agent executes     │   │
│  │  ...                │   │
│  │  if (sensitive) {   │   │
│  │    interrupt()  ────┼───┼──► Pausa y guarda estado
│  │  }                  │   │
│  └─────────────────────┘   │
└─────────────────────────────┘
              │
              ▼
       Client shows UI
              │
              ▼
       User approves/rejects
              │
              ▼
┌─────────────────────────────┐
│   graph.invoke(decision)    │◄── Resume con decisión
│   interrupt() returns       │
│   execution continues       │
└─────────────────────────────┘
```

---

## 3. Implementación

### 3.1 Básico: Pausar para Aprobación

```typescript
import { interrupt } from "@langchain/langgraph";

const sensitiveToolNode = async (state) => {
  // Verificar si requiere aprobación
  if (isSensitiveOperation(state.toolCall)) {
    // Pausar ejecución - estado se guarda en checkpointer
    const approved = interrupt({
      type: "approval_request",
      toolName: state.toolCall.name,
      args: state.toolCall.args,
      summary: generateSummary(state.toolCall),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });

    // approved contiene la respuesta del usuario
    if (!approved) {
      return {
        messages: [new AIMessage("Operation cancelled by user.")],
      };
    }

    // Si el usuario modificó los args
    if (approved.modifiedArgs) {
      state.toolCall.args = approved.modifiedArgs;
    }
  }

  // Ejecutar operación
  return await executeTool(state.toolCall);
};
```

### 3.2 Flujo Completo

```typescript
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

// Compilar grafo con checkpointer (requerido para interrupt)
const checkpointer = PostgresSaver.fromConnString(process.env.DATABASE_URL);
const graph = workflow.compile({ checkpointer });

// Paso 1: Usuario envía request
const config = { configurable: { thread_id: sessionId } };
const result1 = await graph.invoke(
  { messages: [new HumanMessage("Create invoice for customer ABC")] },
  config
);

// Si hay interrupción, result1 contiene __interrupt__
if (result1.__interrupt__) {
  const interruptData = result1.__interrupt__;

  // Paso 2: Enviar al frontend
  socket.emit("approval_request", {
    sessionId,
    ...interruptData,
  });

  // Paso 3: Usuario decide (async)
  // ... esperar respuesta del usuario ...
}

// Paso 4: Resumir con decisión del usuario
const userDecision = {
  approved: true,
  // O modifiedArgs si el usuario editó
};

const result2 = await graph.invoke(
  userDecision, // Este valor se retorna de interrupt()
  config // Mismo thread_id para resumir
);
```

### 3.3 WebSocket Handler

```typescript
// Backend: Manejar respuesta de aprobación
socket.on("approval_response", async ({ sessionId, approved, modifiedArgs, reason }) => {
  try {
    // Validar ownership
    await validateSessionOwnership(socket.userId, sessionId);

    // Construir decisión
    const decision = approved
      ? { approved: true, modifiedArgs }
      : { approved: false, reason };

    // Resumir grafo
    const result = await graph.invoke(
      decision,
      { configurable: { thread_id: sessionId } }
    );

    // Enviar resultado
    socket.emit("message", {
      sessionId,
      content: result.messages[result.messages.length - 1].content,
    });
  } catch (error) {
    socket.emit("error", { message: error.message });
  }
});
```

---

## 4. Operaciones Sensibles

### 4.1 Definir qué Requiere Aprobación

```typescript
const SENSITIVE_OPERATIONS = [
  "create_invoice",
  "update_customer",
  "delete_order",
  "post_journal_entry",
  "send_email",
];

function isSensitiveOperation(toolCall: ToolCall): boolean {
  return SENSITIVE_OPERATIONS.includes(toolCall.name);
}
```

### 4.2 Wrapper para Tools Sensibles

```typescript
import { interrupt } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";

function wrapWithApproval<T extends StructuredToolInterface>(
  originalTool: T,
  generateSummary: (args: unknown) => string
): T {
  return {
    ...originalTool,
    func: async (args) => {
      const approved = interrupt({
        type: "approval_request",
        toolName: originalTool.name,
        args,
        summary: generateSummary(args),
      });

      if (!approved) {
        return "Operation cancelled by user";
      }

      return originalTool.func(approved.modifiedArgs ?? args);
    },
  };
}

// Uso
const safeCreateInvoice = wrapWithApproval(
  createInvoiceTool,
  (args) => `Create invoice for ${args.customerId} - Amount: ${args.amount}`
);
```

---

## 5. Frontend Integration

### 5.1 React Component

```tsx
interface ApprovalRequest {
  toolName: string;
  args: Record<string, unknown>;
  summary: string;
  expiresAt: string;
}

function ApprovalDialog({ request, onRespond }: {
  request: ApprovalRequest;
  onRespond: (approved: boolean, modifiedArgs?: Record<string, unknown>) => void;
}) {
  const [editedArgs, setEditedArgs] = useState(request.args);

  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approval Required</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p>{request.summary}</p>

          <div className="bg-muted p-4 rounded">
            <pre>{JSON.stringify(editedArgs, null, 2)}</pre>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onRespond(false)}
            >
              Reject
            </Button>
            <Button
              onClick={() => onRespond(true, editedArgs)}
            >
              Approve
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### 5.2 Zustand Store

```typescript
interface ApprovalStore {
  pendingApproval: ApprovalRequest | null;
  setPendingApproval: (approval: ApprovalRequest | null) => void;
  respond: (approved: boolean, modifiedArgs?: Record<string, unknown>) => void;
}

const useApprovalStore = create<ApprovalStore>((set, get) => ({
  pendingApproval: null,

  setPendingApproval: (approval) => set({ pendingApproval: approval }),

  respond: async (approved, modifiedArgs) => {
    const { pendingApproval } = get();
    if (!pendingApproval) return;

    socket.emit("approval_response", {
      sessionId: currentSessionId,
      approved,
      modifiedArgs,
    });

    set({ pendingApproval: null });
  },
}));
```

---

## 6. Tests

```typescript
describe("interrupt() flow", () => {
  it("pauses execution for approval", async () => {
    const result = await graph.invoke(
      { messages: [new HumanMessage("Create invoice")] },
      { configurable: { thread_id: "test-1" } }
    );

    expect(result.__interrupt__).toBeDefined();
    expect(result.__interrupt__.type).toBe("approval_request");
  });

  it("resumes with approval", async () => {
    // First invoke - triggers interrupt
    await graph.invoke(input, config);

    // Resume with approval
    const result = await graph.invoke(
      { approved: true },
      config
    );

    expect(result.__interrupt__).toBeUndefined();
    expect(result.messages).toContainEqual(
      expect.objectContaining({ content: expect.stringContaining("created") })
    );
  });

  it("cancels on rejection", async () => {
    await graph.invoke(input, config);

    const result = await graph.invoke(
      { approved: false, reason: "Wrong customer" },
      config
    );

    expect(result.messages).toContainEqual(
      expect.objectContaining({ content: expect.stringContaining("cancelled") })
    );
  });
});
```

---

## 7. Criterios de Aceptación

- [ ] `interrupt()` pausa ejecución correctamente
- [ ] Estado persiste en checkpointer
- [ ] Resume funciona con thread_id
- [ ] Frontend muestra diálogo de aprobación
- [ ] Usuario puede aprobar/rechazar/editar
- [ ] Expiración manejada (opcional)
- [ ] `npm run verify:types` pasa

---

## 8. Archivos a Crear/Modificar

- `backend/src/modules/agents/approval/sensitive-tools.ts`
- `backend/src/services/websocket/handlers/approval.handler.ts`
- `frontend/src/domains/chat/stores/approval.store.ts`
- `frontend/src/components/chat/ApprovalDialog.tsx`

---

## 9. Estimación

- **Backend**: 2-3 días
- **Frontend**: 2-3 días
- **Testing**: 1-2 días
- **Total**: 5-8 días

---

## 10. Changelog

| Fecha | Versión | Cambios |
|-------|---------|---------|
| 2026-02-02 | 1.0 | Initial draft with interrupt() pattern |
