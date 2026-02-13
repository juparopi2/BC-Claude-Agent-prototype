# PRD-100: Duplicación de Eventos por Replay del Historial

**Estado**: 🔴 NO INICIADO
**Fecha**: 2026-02-13
**Fase**: 10 (Bug Resolution)
**Prioridad**: P0 - CRITICAL
**Dependencias**: Ninguna

---

## 1. Problema

Cuando se envía un segundo mensaje en la misma sesión, `BatchResultNormalizer` procesa TODO el estado de LangGraph (incluyendo mensajes históricos del turno 1), causando:

1. **Duplicación de eventos en `message_events`**: El turno 2 vuelve a persistir TODOS los eventos del turno 1. Una sesión con 2 turnos tiene 69 mensajes pero 100 eventos (31 duplicados del turno 1 reproducido).

2. **Desperdicio/brecha de números de secuencia**: `EventStore.reserveSequenceNumbers()` asigna números para eventos de replay. La tabla `messages` tiene una brecha del #38 al #68 (31 números desperdiciados). Los mensajes saltan del seq #37 al #69.

3. **Contenido de mensaje duplicado**: Los eventos #38-#67 del turno 2 son copias exactas de los eventos #3-#32 del turno 1, con los mismos `tool_use_ids`, mismos `message_ids`, pero `input_tokens: 0, output_tokens: 0`.

---

## 2. Evidencia

### Análisis de `inspect-session.ts`

```
Mensajes: 69 totales | Eventos: 100 totales
Turno 1: mensajes #1-#35, eventos #1-#35 (CORRECTO)
Turno 2: mensajes #36-#100 PERO:
  - Evento #37 = DUPLICADO del evento #2 (mismo contenido de thinking)
  - Eventos #38-#67 = REPLAY EXACTO de eventos #3-#32 del turno 1
  - Eventos #68-#95 = Eventos NUEVOS reales para turno 2
  - Eventos #96-#100 = agent_changed para turno 2
Tabla messages: #36, #37, luego SALTA a #69 (dedup funciona parcialmente)
```

### Ejemplo de Duplicación

**Evento Original (Turno 1)**:
```json
{
  "id": 15,
  "sequence_number": 13,
  "event_type": "tool_use",
  "message_id": "MSG-ABC123",
  "tool_use_id": "toolu_01ABC",
  "content": {"tool": "query_customers", "input": {...}}
}
```

**Evento Duplicado (Turno 2)**:
```json
{
  "id": 50,
  "sequence_number": 48,
  "event_type": "tool_use",
  "message_id": "MSG-ABC123",  // MISMO ID
  "tool_use_id": "toolu_01ABC",  // MISMO ID
  "content": {"tool": "query_customers", "input": {...}},  // MISMO CONTENIDO
  "input_tokens": 0,  // SIN TOKENS (evento fantasma)
  "output_tokens": 0
}
```

---

## 3. Análisis de Causa Raíz

El grafo supervisor de LangGraph retorna TODOS los mensajes en su estado después de la ejecución (históricos + nuevos). El pipeline de normalización (`BatchResultNormalizer` → `ExecutionPipeline`) no distingue entre mensajes históricos y nuevos. Procesa todo, asigna números de secuencia para todos y persiste eventos para todos.

La tabla `messages` tiene deduplicación parcial (el mismo `message_id` no se insertará dos veces), pero:
- `message_events` usa sus propios IDs, por lo que se crean duplicados
- Los números de secuencia se pre-asignan y se desperdician
- El bloque de thinking del turno 1 obtiene un nuevo `message_id`, por lo que SÍ se duplica

### Flujo Actual (Problemático)

```
1. Usuario envía mensaje turno 2
2. supervisor-graph.ts ejecuta graph.stream()
3. Estado final contiene:
   - Mensajes históricos del turno 1 (35 mensajes)
   - Mensajes nuevos del turno 2 (34 mensajes)
4. BatchResultNormalizer.normalize(state) procesa TODOS (69 mensajes)
5. EventStore.reserveSequenceNumbers(69) asigna seq #37-#105
6. PersistenceCoordinator persiste:
   - messages: dedup por message_id (sólo 34 nuevos)
   - message_events: NO dedup (69 eventos, 31 duplicados)
7. Resultado: 69 mensajes, 100 eventos, brecha seq #38-#68
```

---

## 4. Archivos a Investigar

| Archivo | Investigación | Prioridad |
|---------|---------------|-----------|
| `backend/src/modules/agents/orchestrator/supervisor-graph.ts` | Cómo se retorna el estado, qué mensajes están en el estado final | P0 |
| `backend/src/domains/agent/orchestration/ExecutionPipeline.ts` | Cómo se normalizan los eventos, se asignan secuencias | P0 |
| `backend/src/shared/providers/normalizers/BatchResultNormalizer.ts` | Cómo procesa todos vs nuevos mensajes | P0 |
| `backend/src/services/events/EventStore.ts` | Cómo funciona reserveSequenceNumbers | P1 |
| `backend/src/domains/agent/persistence/PersistenceCoordinator.ts` | Lógica de dedup para mensajes vs eventos | P1 |

---

## 5. Soluciones Propuestas

### Opción A: Delta Tracking en ExecutionPipeline (RECOMENDADA)

Pasar el conteo de mensajes inicial al normalizador, omitir los primeros N mensajes.

**Cambios**:
```typescript
// ExecutionPipeline.ts
async execute(input: ExecutionInput, ctx: ExecutionContext) {
  const initialMessageCount = input.messages?.length ?? 0;

  const result = await this.graphRunner.run(input);

  // Normalizar sólo mensajes DESPUÉS de initialMessageCount
  const events = this.normalizer.normalize(
    result.state,
    sessionId,
    { skipFirstN: initialMessageCount }  // NUEVO
  );
}

// BatchResultNormalizer.ts
normalize(state: AgentState, sessionId: string, options?: { skipFirstN?: number }) {
  const skipCount = options?.skipFirstN ?? 0;
  const messagesToProcess = state.messages.slice(skipCount);
  // ... resto de la lógica
}
```

**Pros**:
- Mínima invasión
- No requiere cambios en LangGraph
- Fácil de testear

**Contras**:
- Asume que el orden de mensajes es estable

### Opción B: Message ID Set Comparison

Comparar IDs de mensajes del estado de entrada vs salida.

**Cambios**:
```typescript
// ExecutionPipeline.ts
async execute(input: ExecutionInput, ctx: ExecutionContext) {
  const inputMessageIds = new Set(
    input.messages?.map(m => m.id).filter(Boolean) ?? []
  );

  const result = await this.graphRunner.run(input);

  // Filtrar mensajes que NO estaban en la entrada
  const newMessages = result.state.messages.filter(
    msg => !inputMessageIds.has(msg.id)
  );

  const events = this.normalizer.normalize(
    { ...result.state, messages: newMessages },
    sessionId
  );
}
```

**Pros**:
- Más robusto (no depende del orden)
- Semánticamente correcto

**Contras**:
- Más complejo
- Requiere que todos los mensajes tengan IDs

### Opción C: Turn ID Tagging (Más Invasivo)

Agregar un `turn_id` a los mensajes antes de la ejecución del grafo.

**Pros**:
- Información explícita de turno disponible en toda la pipeline

**Contras**:
- Requiere cambios en el esquema de estado de LangGraph
- Afecta serialización/deserialización

---

## 6. Decisión Recomendada

**Opción A: Delta Tracking** por:
- Simplicidad de implementación
- No requiere cambios en el esquema de LangGraph
- Bajo riesgo
- Suficiente para el caso de uso actual (ejecución secuencial de turnos)

---

## 7. Criterios de Éxito

### Funcionales
- [ ] El segundo turno NO crea eventos duplicados en `message_events`
- [ ] Los números de secuencia son continuos (sin brechas entre turnos)
- [ ] El conteo de eventos coincide con el conteo de mensajes (ratio 1:1)
- [ ] Los eventos de thinking del turno 1 no se duplican en el turno 2

### Validación
```typescript
// Test: Segundo turno no duplica eventos
it('should not duplicate events from previous turns', async () => {
  // Turn 1
  const result1 = await orchestrator.execute(prompt1, session, callback);
  const events1 = await getMessageEvents(session.id);

  // Turn 2
  const result2 = await orchestrator.execute(prompt2, session, callback);
  const events2 = await getMessageEvents(session.id);

  // Verificar que NO hay eventos duplicados
  const eventIds1 = new Set(events1.map(e => e.message_id));
  const eventIds2 = events2.map(e => e.message_id);
  const duplicates = eventIds2.filter(id => eventIds1.has(id));

  expect(duplicates).toHaveLength(0);
});
```

### Métricas
- **Antes**: 2 turnos = 69 mensajes, 100 eventos (45% overhead)
- **Después**: 2 turnos = 69 mensajes, 69 eventos (0% overhead)

---

## 8. Riesgos y Mitigación

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Mensajes fuera de orden en el estado | Baja | Alto | Validación: assert que los primeros N mensajes coinciden con el historial |
| Mensajes sin ID | Baja | Alto | Validación: todos los mensajes de LangGraph deben tener ID |
| Regresión en sesiones existentes | Media | Medio | Pruebas E2E con sesiones multi-turno |

---

## 9. Plan de Implementación

### Fase 1: Investigación (1h)
- [ ] Confirmar que el estado de LangGraph contiene mensajes históricos
- [ ] Verificar que el orden de mensajes es estable entre ejecuciones
- [ ] Documentar estructura exacta del estado retornado

### Fase 2: Implementación (2h)
- [ ] Agregar parámetro `skipFirstN` a `BatchResultNormalizer.normalize()`
- [ ] Modificar `ExecutionPipeline.execute()` para pasar conteo inicial
- [ ] Agregar logging para verificar conteo de mensajes procesados

### Fase 3: Testing (2h)
- [ ] Test unitario: normalizer con skipFirstN
- [ ] Test integración: 2 turnos, verificar conteo de eventos
- [ ] Test E2E: sesión real, inspeccionar DB después de 2 turnos

### Fase 4: Validación (1h)
- [ ] Ejecutar `inspect-session.ts` en sesión de prueba
- [ ] Verificar que eventos == mensajes
- [ ] Verificar que secuencias son continuas

---

## 10. Changelog

| Fecha | Autor | Cambios |
|-------|-------|---------|
| 2026-02-13 | Juan Pablo | Creación inicial del PRD |
