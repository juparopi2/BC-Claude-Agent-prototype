# Fase 4: Tests E2E con Postman/Newman

## Información de la Fase

| Campo | Valor |
|-------|-------|
| **Fase** | 4 |
| **Nombre** | Tests E2E con Postman/Newman |
| **Prerequisitos** | Fase 3 completada (tests de integración) |
| **Fase Siguiente** | Fase 5: Refactoring Estructural |

---

## Objetivo Principal

Validar el flujo completo del backend usando Postman/Newman, sin depender del frontend. Esto permite testear el sistema end-to-end de forma aislada.

---

## Success Criteria

### SC-1: Postman Collection Completa
- [ ] Collection con todos los endpoints REST
- [ ] Tests de WebSocket implementados
- [ ] Environment variables configuradas

### SC-2: Tests de Flujos Críticos
- [ ] Session creation y management
- [ ] Message flow completo
- [ ] Thinking flow con enableThinking
- [ ] Tool flow con herramientas BC

### SC-3: Newman Automation
- [ ] Scripts de ejecución funcionando
- [ ] Reportes HTML generados
- [ ] CI-ready (puede correr en pipeline)

---

## Filosofía de Esta Fase

### Principio: "Test Like a User, Not Like a Developer"

Los tests E2E simulan uso real del sistema. No conocen internals, solo usan APIs públicas.

### Ventajas de Postman/Newman

1. **UI Amigable**: Fácil de crear y debuggear tests
2. **Compartible**: Team puede usar misma collection
3. **CI/CD**: Newman permite automatización
4. **Documentación**: Collection documenta la API

---

## Consideraciones Técnicas Específicas

### Sobre WebSocket Testing en Postman

**Postman v8+** soporta WebSocket nativamente.

**Configuración Socket.IO**:
```
URL: ws://localhost:3002/socket.io/?EIO=4&transport=websocket
```

**Mensajes Socket.IO**:
- Connect: `40{"token":"{{auth_token}}"}`
- Event: `42["event_name",{payload}]`

### Sobre Tests de Thinking

**Configuración**:
```json
{
  "thinking": {
    "enableThinking": true,
    "thinkingBudget": 10000
  }
}
```

**Verificaciones**:
- `thinking_chunk` events recibidos
- `thinking_complete` antes de `message_chunk`
- Orden correcto de eventos

### Sobre Tests de Tools

**Prompts que Triggean Tools**:
- "Lista las primeras 5 compañías"
- "Muestra los clientes activos"
- Cualquier query de BC

**Verificaciones**:
- `tool_use` event con toolName y args
- `tool_result` event con success/error
- IDs coinciden entre use y result

---

## Entregables de Esta Fase

### E-1: Postman Collection
```
backend/postman/bc-agent-backend.postman_collection.json
```

### E-2: Environment File
```
backend/postman/local.postman_environment.json
```

### E-3: Newman Scripts
```
backend/scripts/run-postman-tests.sh
```

### E-4: Test Reports
```
backend/postman/reports/
```

---

## Descubrimientos y Notas

### Descubrimientos de Fase 3

_Copiar aquí descubrimientos relevantes._

### Descubrimientos de Esta Fase

_Agregar hallazgos durante ejecución._

### Prerequisitos para Fase 5

_Información que Fase 5 necesita._

---

*Última actualización: 2025-12-16*
