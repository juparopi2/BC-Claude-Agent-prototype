# Fase 3: Tests de Integración (Service-to-Service)

## Información de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 3 |
| **Nombre** | Tests de Integración |
| **Prerequisitos** | Fase 2 completada (tests unitarios) |
| **Fase Siguiente** | Fase 4: Tests E2E con Postman |

---

## Objetivo Principal

Validar que los servicios funcionan correctamente juntos, verificando las integraciones entre DirectAgentService, EventStore, MessageQueue, y ChatMessageHandler.

---

## Success Criteria

### SC-1: Agent + EventStore Integration
- [ ] Tests de persistencia de eventos
- [ ] Tests de ordering (sequenceNumber)
- [ ] Tests de concurrent writes

### SC-2: Agent + MessageQueue Integration
- [ ] Tests de enqueue
- [ ] Tests de job payload
- [ ] Tests de error handling

### SC-3: WebSocket + Agent Integration
- [ ] Tests de flujo completo chat message
- [ ] Tests de relay de eventos
- [ ] Tests de error handling

---

## Filosofía de Esta Fase

### Principio: "Integration Tests Catch What Unit Tests Miss"

Los tests de integración verifican que los componentes funcionan juntos correctamente. Un test unitario puede pasar pero la integración puede fallar.

### Alcance de Tests de Integración

| Tipo | Alcance | Ejemplo |
|------|---------|---------|
| Unit | Una función/clase | StreamAdapter.processChunk() |
| Integration | Múltiples servicios | DirectAgentService → EventStore |
| E2E | Sistema completo | WebSocket → Claude → WebSocket |

---

## Consideraciones Técnicas Específicas

### Sobre EventStore Integration

**Verificaciones Clave**:
- Sequence numbers son únicos y ordenados
- Eventos se persisten completamente
- Concurrent writes no causan conflictos

**Setup**:
- Usar test database o mock in-memory
- Reset state entre tests

### Sobre MessageQueue Integration

**Verificaciones Clave**:
- Jobs se encolan correctamente
- Payload tiene todos los campos requeridos
- Failures se manejan gracefully

**Setup**:
- Mock BullMQ o usar test queue
- Verificar job data sin ejecutar workers

### Sobre WebSocket + Agent Integration

**Verificaciones Clave**:
- user_message_confirmed emitido después de save
- Todos los agent events relayed
- Errors emitidos a socket

**Setup**:
- Mock Socket.IO server
- Spy en emit calls

---

## Entregables de Esta Fase

### E-1: Agent + EventStore Tests
```
backend/src/__tests__/integration/agent-eventstore.test.ts
```

### E-2: Agent + MessageQueue Tests
```
backend/src/__tests__/integration/agent-messagequeue.test.ts
```

### E-3: WebSocket + Agent Tests
```
backend/src/__tests__/integration/websocket-agent.test.ts
```

---

## Descubrimientos y Notas

### Descubrimientos de Fase 2

_Copiar aquí descubrimientos relevantes._

### Descubrimientos de Esta Fase

_Agregar hallazgos durante ejecución._

### Prerequisitos para Fase 4

_Información que Fase 4 necesita._

---

*Última actualización: 2025-12-16*
