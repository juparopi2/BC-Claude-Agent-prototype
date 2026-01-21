# Temarios LangChain para Desarrolladores TypeScript/JavaScript

Dos currículos estructurados diseñados para desarrolladores con experiencia básica en LLMs (llamadas directas) que desean dominar el ecosistema LangChain y construir sistemas multi-agente en producción. Cada temario progresa de conceptos fundamentales a patrones avanzados, con **recursos específicos** (URLs de documentación, videos, tutoriales) para cada tema.

---

# TEMARIO 1: Panorama General del Ecosistema LangChain

## Módulo 1: Fundamentos del Ecosistema (Nivel Básico)

### 1.1 Introducción a LangChain y conceptos core

**¿Qué aprenderás?** Los building blocks fundamentales que componen cualquier aplicación LLM moderna: desde prompts hasta agentes completos.

| Concepto | Definición | Cuándo usarlo |
|----------|------------|---------------|
| **Prompts** | Templates que estructuran instrucciones al LLM | Siempre - son la base de cualquier interacción |
| **Chains** | Secuencias de operaciones donde el output alimenta el siguiente paso | Workflows lineales y predecibles |
| **Tools** | Funciones que los agentes pueden invocar para realizar acciones | Cuando el LLM necesita interactuar con el mundo |
| **Agents** | Combinación de LLM + Tools con capacidad de razonamiento (ReAct) | Tareas que requieren decisiones dinámicas |
| **Memory** | Mecanismos para mantener contexto entre interacciones | Conversaciones multi-turno |
| **Retrieval** | Búsqueda de información relevante (RAG) | Cuando el LLM necesita conocimiento externo |

**Recursos:**
- 📚 **Documentación oficial LangChain.js**: https://js.langchain.com/docs/
- 📚 **Quickstart LangChain.js**: https://docs.langchain.com/oss/javascript/langchain/quickstart
- 🎓 **LangChain Academy - Intro**: https://academy.langchain.com/
- 📦 **Instalación**: `npm install langchain @langchain/core @langchain/openai`

### 1.2 Prompts y templates

**PromptTemplate** para texto simple y **ChatPromptTemplate** para conversaciones con múltiples mensajes. Los prompts son el **90% del éxito** de una aplicación LLM.

```typescript
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";

const chatPrompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant specialized in {domain}"],
  new MessagesPlaceholder("chat_history"),
  ["user", "{input}"],
]);
```

**Recursos:**
- 📚 **Prompt Templates**: https://js.langchain.com/docs/concepts/prompt_templates/
- 📚 **API Reference**: https://v03.api.js.langchain.com/classes/_langchain_core.prompts.ChatPromptTemplate.html

### 1.3 Chains: Composición con LCEL

**LCEL (LangChain Expression Language)** permite conectar componentes usando pipes (`|`). Es el paradigma funcional de LangChain.

```typescript
import { RunnableSequence, RunnablePassthrough } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

const chain = RunnableSequence.from([
  { context: retriever, question: new RunnablePassthrough() },
  prompt,
  llm,
  new StringOutputParser(),
]);
```

**Recursos:**
- 📚 **LCEL Overview**: https://docs.langchain.com/oss/javascript/langchain/overview
- 🎥 **RAG From Scratch (Videos 1-4)**: https://youtube.com/playlist?list=PLfaIDFEXuae2LXbO1_PKyVJiQ23ZztA0x

### 1.4 Tools: Extendiendo capacidades del LLM

Las Tools permiten al LLM ejecutar código, buscar información, o interactuar con APIs externas.

```typescript
import { tool } from "@langchain/core/tools";
import * as z from "zod";

const calculatorTool = tool(
  async ({ a, b, operation }) => {
    switch(operation) {
      case "add": return String(a + b);
      case "multiply": return String(a * b);
    }
  },
  {
    name: "calculator",
    description: "Perform basic math operations",
    schema: z.object({
      a: z.number(),
      b: z.number(),
      operation: z.enum(["add", "multiply"]),
    }),
  }
);
```

**Recursos:**
- 📚 **Tools Documentation**: https://docs.langchain.com/oss/javascript/langchain/tools
- 📚 **Tool Configure**: https://js.langchain.com/docs/how_to/tool_configure/

---

## Módulo 2: Diferencias entre Herramientas del Ecosistema (Nivel Básico-Intermedio)

### 2.1 Mapa del ecosistema LangChain

El ecosistema tiene **cuatro componentes principales** con diferentes niveles de abstracción:

| Herramienta | Nivel | Propósito | Usuario típico |
|-------------|-------|-----------|----------------|
| **LangChain.js** | Low-level | Framework core para apps LLM | Desarrolladores |
| **LangGraph.js** | Mid-level | Orquestación de workflows stateful | Desarrolladores senior |
| **LangSmith** | Plataforma | Observabilidad, debugging, evaluación | DevOps / ML Engineers |
| **Agent Builder** | High-level (No-code) | Crear agentes sin programar | Usuarios de negocio |

### 2.2 LangChain.js Core

**¿Qué es?** Framework fundacional con building blocks modulares: prompts, chains, output parsers, document loaders, vectorstores.

**Arquitectura:** DAG (Directed Acyclic Graph) - flujos lineales donde cada paso alimenta el siguiente.

**Cuándo usarlo:**
- ✅ Chatbots y Q&A simples
- ✅ RAG básico con documentos
- ✅ Prototipos rápidos
- ✅ Workflows lineales predecibles

**Recursos:**
- 📚 **Docs**: https://js.langchain.com/docs/
- 💻 **GitHub**: https://github.com/langchain-ai/langchainjs
- 📦 **npm**: https://www.npmjs.com/package/langchain

### 2.3 LangGraph.js

**¿Qué es?** Framework para construir **grafos de estado** con nodos y edges. Permite loops, branches condicionales, y estado persistente.

**Diferencia clave:** LangChain = pipelines lineales | LangGraph = máquinas de estado cíclicas

**Cuándo usarlo:**
- ✅ Agentes con loops de razonamiento
- ✅ Sistemas multi-agente
- ✅ Human-in-the-loop workflows
- ✅ Checkpointing y recuperación de fallos
- ✅ Aplicaciones de producción complejas

```typescript
import { StateGraph, START, END } from "@langchain/langgraph";

const workflow = new StateGraph(MessagesState)
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue, ["tools", END])
  .addEdge("tools", "agent");

const app = workflow.compile({ checkpointer: new MemorySaver() });
```

**Recursos:**
- 📚 **Docs**: https://docs.langchain.com/oss/javascript/langgraph/overview
- 📚 **Tutoriales**: https://langchain-ai.github.io/langgraphjs/tutorials/
- 💻 **GitHub**: https://github.com/langchain-ai/langgraphjs
- 🎓 **Academy Course**: https://academy.langchain.com/courses/intro-to-langgraph

### 2.4 LangSmith

**¿Qué es?** Plataforma de observabilidad end-to-end. Es el "Datadog para aplicaciones LLM".

**Capacidades:**
- Tracing estructurado de cada paso
- Debugging visual de chains y agents
- Evaluación con datasets
- Monitoreo de costos y latencia

**Recursos:**
- 📚 **Docs**: https://docs.smith.langchain.com/
- 📚 **JS/TS SDK Reference**: https://docs.smith.langchain.com/reference/js
- 🎓 **Academy Course**: https://academy.langchain.com/courses/intro-to-langsmith
- 📦 **npm**: https://www.npmjs.com/package/langsmith

### 2.5 LangSmith Agent Builder

**¿Qué es?** Constructor **no-code** para crear agentes productivos. Ideal para automatización de tareas internas sin escribir código.

**Características:**
- Configuración conversacional
- Memory incorporada que aprende de correcciones
- Triggers automáticos (email, Slack, cron)
- Human-in-the-loop para acciones sensibles

**Limitaciones:** Menos control sobre arquitectura, ideal para productividad interna, no para apps customer-facing complejas.

**Recursos:**
- 📚 **Docs**: https://docs.langchain.com/langsmith/agent-builder
- 📝 **Blog**: https://blog.langchain.com/langsmith-agent-builder/
- 🎓 **Tutorial DataCamp**: https://www.datacamp.com/tutorial/langsmith-agent-builder-tutorial

### 2.6 Árbol de decisión: ¿Cuál elegir?

```
¿Necesitas escribir código?
├── NO → LangSmith Agent Builder
└── SÍ → ¿Tu workflow tiene loops, branches, o múltiples agentes?
         ├── NO → LangChain.js
         └── SÍ → LangGraph.js
         
En todos los casos: Añade LangSmith para observabilidad desde el día 1
```

---

## Módulo 3: BAML - Alternativa para Structured Output (Nivel Intermedio)

### 3.1 ¿Qué es BAML?

**BAML (BoundaryML)** es un **lenguaje de dominio específico (DSL)** para crear funciones LLM con seguridad de tipos. Transforma prompts en funciones tipadas con esquemas explícitos.

**Filosofía:** "Los prompts son funciones con entradas y salidas definidas"

### 3.2 Características principales

| Característica | Descripción |
|----------------|-------------|
| **Type Safety** | Genera tipos TypeScript automáticamente |
| **SAP (Schema-Aligned Parsing)** | Parsea JSON malformado de LLMs |
| **Streaming tipado** | `Partial<T>` durante generación |
| **Testing sin API** | Playground VSCode integrado |
| **Transparencia** | Control total del prompt enviado |

### 3.3 Ejemplo BAML con TypeScript

**Archivo .baml:**
```baml
class Resume {
  name string
  skills string[]
  seniority SeniorityLevel
}

enum SeniorityLevel {
  JUNIOR @description("0-2 años")
  SENIOR @description("5+ años")
}

function ExtractResume(resume_text: string) -> Resume {
  client GPT4
  prompt #"Extract info: {{ resume_text }} {{ ctx.output_format }}"#
}
```

**Uso en TypeScript:**
```typescript
import { b } from "./baml_client";

// Resultado tipado automáticamente
const resume = await b.ExtractResume(rawText);
console.log(resume.seniority); // TypeScript conoce el tipo
```

### 3.4 BAML vs LangChain: Comparativa

| Aspecto | BAML | LangChain |
|---------|------|-----------|
| **Enfoque** | Extracción estructurada | Framework completo |
| **Type Safety** | Nativo, generación automática | Requiere Zod manual |
| **Parsing JSON** | Fuzzy (tolera errores) | Strict (falla con errores) |
| **Agents/RAG** | ❌ No incluido | ✅ Completo |
| **Curva aprendizaje** | ~2 horas | Más compleja |

### 3.5 Cuándo usar cada uno

**Usa BAML cuando:**
- Extracción de datos estructurados es tu caso principal
- Type safety es crítico
- Quieres control total sobre prompts
- El 95% de tu trabajo son prompts simples-moderados

**Usa LangChain cuando:**
- Necesitas agents, RAG, o memoria conversacional
- Construyes pipelines multi-paso complejos
- Requieres integraciones con muchos servicios

**Estrategia híbrida:** BAML para prompts estructurados + LangGraph para orquestación

**Recursos BAML:**
- 📚 **Docs**: https://docs.boundaryml.com/home
- 📚 **TypeScript Guide**: https://docs.boundaryml.com/guide/installation-language/typescript
- 📚 **BAML vs LangChain**: https://docs.boundaryml.com/guide/comparisons/baml-vs-langchain
- 💻 **GitHub**: https://github.com/BoundaryML/baml
- 🎮 **Playground**: https://promptfiddle.com/

---

## Módulo 4: Guardrails - Seguridad en Aplicaciones LLM (Nivel Intermedio)

### 4.1 ¿Qué son los Guardrails?

**Controles de seguridad programáticos** que interceptan entradas y salidas de LLMs para detectar y mitigar riesgos:

- Contenido tóxico o inapropiado
- Información personal (PII)
- Inyección de prompts / Jailbreaks
- Alucinaciones
- Contenido fuera de tema

### 4.2 Tipos de Guardrails

| Tipo | Función |
|------|---------|
| **Input Rails** | Validan entrada del usuario antes del LLM |
| **Output Rails** | Validan respuesta del LLM antes de entregarla |
| **Dialog Rails** | Controlan flujo conversacional |
| **Retrieval Rails** | Filtran chunks en RAG |
| **Execution Rails** | Validan entrada/salida de herramientas |

### 4.3 Implementación en LangChain.js

LangChain.js incluye sistema de **middleware** para guardrails:

```typescript
import { createAgent, piiRedactionMiddleware, humanInTheLoopMiddleware } from "langchain";

const agent = createAgent({
  model: "gpt-4o",
  tools: [searchTool, sendEmailTool],
  middleware: [
    // Capa 1: Filtro determinístico
    contentFilterMiddleware(["hack", "exploit"]),
    
    // Capa 2: Redacción de PII
    piiRedactionMiddleware({
      piiType: "email",
      strategy: "redact", // "mask" | "hash" | "block"
      applyToInput: true,
    }),
    
    // Capa 3: Aprobación humana para operaciones sensibles
    humanInTheLoopMiddleware({
      interruptOn: {
        send_email: { allowAccept: true, allowEdit: true },
      }
    }),
  ],
});
```

**Recursos LangChain Guardrails:**
- 📚 **Docs**: https://docs.langchain.com/oss/javascript/langchain/guardrails

### 4.4 Otras herramientas de Guardrails

| Herramienta | Características | URL |
|-------------|-----------------|-----|
| **Guardrails AI** | Hub con 100+ validadores, integración LCEL | https://guardrailsai.com/docs |
| **NeMo Guardrails** | Colang DSL, 5 tipos de rails, NVIDIA | https://docs.nvidia.com/nemo/guardrails/ |
| **OpenAI Guardrails JS** | Wrapper drop-in para OpenAI SDK | https://www.npmjs.com/package/@openai/guardrails |
| **hai-guardrails** | Librería TypeScript independiente | https://github.com/presidio-oss/hai-guardrails |

### 4.5 Patrón de capas recomendado

```
Entrada Usuario
     ↓
[Capa 1: Filtros Determinísticos - regex, keywords]
     ↓
[Capa 2: Detección PII - redactar/maskear]
     ↓
     LLM
     ↓
[Capa 3: Validación Output - toxicidad, formato]
     ↓
[Capa 4: Human-in-the-loop - operaciones sensibles]
     ↓
Respuesta Usuario
```

---

## Módulo 5: Memory y State Management (Nivel Intermedio)

### 5.1 Tipos de memoria

| Tipo | Propósito | Implementación |
|------|-----------|----------------|
| **Short-term** | Historial de conversación actual | Messages array |
| **Long-term** | Persistencia entre sesiones | Checkpointers |
| **Semantic** | Búsqueda por similitud | VectorStores |

### 5.2 Memory en LangChain.js

```typescript
import { BufferMemory } from "langchain/memory";

const memory = new BufferMemory({
  memoryKey: "chat_history",
  returnMessages: true,
});
```

**Recursos:**
- 📚 **Short-term Memory**: https://docs.langchain.com/oss/javascript/langchain/short-term-memory
- 📚 **Long-term Memory**: https://docs.langchain.com/oss/javascript/langchain/long-term-memory

### 5.3 Checkpointing en LangGraph.js

**Checkpointers** guardan el estado del grafo en cada paso, habilitando:
- Memoria entre interacciones
- Time travel (volver a estados anteriores)
- Fault-tolerance (recuperación de errores)
- Human-in-the-loop (pausar/resumir)

```typescript
import { MemorySaver } from "@langchain/langgraph-checkpoint";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

// Desarrollo
const devCheckpointer = new MemorySaver();

// Producción
const prodCheckpointer = new PostgresSaver({
  connectionString: process.env.DATABASE_URL,
});

const app = workflow.compile({ checkpointer: prodCheckpointer });

// Invocar con thread_id para persistencia
const result = await app.invoke(
  { messages: [{ role: "user", content: "Hello!" }] },
  { configurable: { thread_id: "conversation-123" } }
);
```

| Checkpointer | Uso | Paquete |
|--------------|-----|---------|
| **MemorySaver** | Desarrollo/testing | `@langchain/langgraph` |
| **SqliteSaver** | Local | `@langchain/langgraph-checkpoint-sqlite` |
| **PostgresSaver** | Producción | `@langchain/langgraph-checkpoint-postgres` |
| **MongoDBSaver** | Producción | `@langchain/langgraph-checkpoint-mongodb` |

**Recursos:**
- 📚 **Persistence Docs**: https://docs.langchain.com/oss/javascript/langgraph/persistence

---

## Módulo 6: RAG - Retrieval Augmented Generation (Nivel Intermedio-Avanzado)

### 6.1 Pipeline RAG completo

RAG extiende las capacidades del LLM con conocimiento externo. El pipeline tiene 5 etapas:

```
Load → Split → Embed → Retrieve → Generate
```

### 6.2 Implementación en TypeScript

```typescript
import { CheerioWebBaseLoader } from "langchain/document_loaders/web/cheerio";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { OpenAIEmbeddings, ChatOpenAI } from "@langchain/openai";
import { createRetrievalChain } from "langchain/chains/retrieval";
import { createStuffDocumentsChain } from "langchain/chains/combine_documents";

// 1. Load
const loader = new CheerioWebBaseLoader("https://example.com/docs");
const docs = await loader.load();

// 2. Split
const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});
const splits = await splitter.splitDocuments(docs);

// 3. Embed & Store
const vectorStore = await MemoryVectorStore.fromDocuments(
  splits,
  new OpenAIEmbeddings()
);

// 4. Retrieve
const retriever = vectorStore.asRetriever({ k: 5 });

// 5. Generate
const llm = new ChatOpenAI({ model: "gpt-4o" });
const prompt = ChatPromptTemplate.fromMessages([
  ["system", "Answer based on context:\n\n{context}"],
  ["human", "{input}"],
]);

const documentChain = await createStuffDocumentsChain({ llm, prompt });
const ragChain = await createRetrievalChain({
  retriever,
  combineDocsChain: documentChain,
});

const response = await ragChain.invoke({ input: "¿Qué dice el documento?" });
```

### 6.3 Mejores prácticas RAG

- **Chunk size**: 500-1000 tokens con 10-20% overlap
- **Embeddings**: OpenAI `text-embedding-3-small` o `text-embedding-3-large`
- **Retrieval**: Hybrid search (semantic + keyword) para mejor recall
- **Reranking**: Usar cross-encoders para refinar top-k results
- **Evaluation**: Medir faithfulness, answer relevancy, context recall

**Recursos:**
- 🎥 **RAG From Scratch (18 videos)**: https://youtube.com/playlist?list=PLfaIDFEXuae2LXbO1_PKyVJiQ23ZztA0x
- 💻 **Notebooks RAG**: https://github.com/langchain-ai/rag-from-scratch
- 📚 **Tutorial RAG**: https://js.langchain.com/v0.2/docs/tutorials/qa_chat_history/

---

## Módulo 7: Observabilidad con LangSmith (Nivel Intermedio-Avanzado)

### 7.1 Configuración básica

```typescript
// Variables de entorno
process.env.LANGSMITH_TRACING = "true";
process.env.LANGSMITH_API_KEY = "<YOUR-API-KEY>";
process.env.LANGSMITH_PROJECT = "my-project";

// Tracing automático con LangChain
import { ChatOpenAI } from "@langchain/openai";
const llm = new ChatOpenAI({ model: "gpt-4o" });
// Todas las llamadas se tracean automáticamente
```

### 7.2 Tracing de código personalizado

```typescript
import { traceable } from "langsmith/traceable";

const myFunction = traceable(
  async (input: string) => {
    // Tu lógica aquí
    return result;
  },
  { name: "My Custom Function", run_type: "chain" }
);
```

### 7.3 Wrapper para OpenAI directo

```typescript
import { OpenAI } from "openai";
import { wrapOpenAI } from "langsmith/wrappers";

const openai = wrapOpenAI(new OpenAI());
// Ahora todas las llamadas se tracean
```

### 7.4 Evaluaciones

**Offline evaluation** (antes de producción):
- Ejecutar sobre datasets curados
- Comparar versiones de prompts
- Detectar regresiones

**Online evaluation** (en producción):
- Evaluar interacciones reales
- Detectar degradación de calidad
- Monitoreo continuo

```typescript
import { Client } from "langsmith/client";

const client = new Client();

// Crear dataset desde traces
const dataset = await client.createDataset("Test Cases", {
  description: "Production examples",
});
```

**Recursos:**
- 📚 **Evaluation Docs**: https://docs.langchain.com/langsmith/evaluation
- 📚 **Quickstart Evaluation**: https://docs.langchain.com/langsmith/evaluation-quickstart
- 💻 **LangSmith Cookbook**: https://github.com/langchain-ai/langsmith-cookbook

---

## Módulo 8: Guía de Selección de Herramientas (Nivel Avanzado)

### 8.1 Matriz de decisión por caso de uso

| Caso de uso | Herramienta recomendada |
|-------------|------------------------|
| Chatbot simple | LangChain.js |
| RAG básico | LangChain.js |
| Extracción estructurada | BAML |
| Agente con tools | LangChain.js createAgent() |
| Workflow con loops | LangGraph.js |
| Sistema multi-agente | LangGraph.js |
| Human-in-the-loop | LangGraph.js |
| Automatización interna sin código | Agent Builder |
| Debugging producción | LangSmith |

### 8.2 Stack recomendado para producción TypeScript

```bash
# Instalación completa
npm install langchain @langchain/core @langchain/openai
npm install @langchain/langgraph @langchain/langgraph-checkpoint-postgres
npm install langsmith

# .env
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=<your-key>
OPENAI_API_KEY=<your-key>
DATABASE_URL=postgresql://...
```

### 8.3 Recursos consolidados

| Recurso | URL |
|---------|-----|
| **LangChain.js Docs** | https://js.langchain.com/docs/ |
| **LangGraph.js Docs** | https://docs.langchain.com/oss/javascript/langgraph/overview |
| **LangSmith Docs** | https://docs.smith.langchain.com/ |
| **LangChain Academy** | https://academy.langchain.com/ |
| **YouTube Channel** | https://www.youtube.com/@LangChain |
| **RAG From Scratch** | https://youtube.com/playlist?list=PLfaIDFEXuae2LXbO1_PKyVJiQ23ZztA0x |
| **GitHub LangChain.js** | https://github.com/langchain-ai/langchainjs |
| **GitHub LangGraph.js** | https://github.com/langchain-ai/langgraphjs |
| **BAML Docs** | https://docs.boundaryml.com/home |

---

# TEMARIO 2: Orquestación Multi-Agente Específica

## Módulo 1: Fundamentos de Agentes Orquestadores (Nivel Básico)

### 1.1 ¿Qué es un agente orquestador?

Un **agente orquestador (supervisor)** es un agente central que coordina múltiples agentes especializados. Funciona como un "gerente" que:

- Analiza la consulta del usuario
- Decide qué agente especializado debe manejar cada tarea
- Mantiene el contexto de la conversación
- Sintetiza resultados de múltiples workers

```
Usuario → Supervisor → [Worker A, Worker B, Worker C] → Supervisor → Respuesta
```

### 1.2 Patrones de diseño multi-agente

**1. Patrón Supervisor (Recomendado)**
- Comunicación hub-and-spoke
- El supervisor decide rutas
- Clara separación de responsabilidades
- Fácil debugging

**2. Patrón Network (Mesh)**
- Comunicación many-to-many
- Cada agente decide a quién pasar control
- Útil sin jerarquía clara

**3. Patrón Hierarchical (Multi-nivel)**
- Supervisores que gestionan otros supervisores
- Cada capa con responsabilidad enfocada
- Escalable y modular

```
Supervisor Principal
├── Equipo Research
│   ├── Web Search Agent
│   └── RAG Agent
└── Equipo Actions
    ├── API Agent
    └── Chart Agent
```

**Recursos:**
- 📝 **Multi-Agent Workflows**: https://blog.langchain.com/langgraph-multi-agent-workflows/
- 📝 **Choosing Architecture**: https://blog.langchain.com/choosing-the-right-multi-agent-architecture/
- 📚 **Multi-Agent Structures**: https://langchain-opentutorial.gitbook.io/langchain-opentutorial/17-langgraph/02-structures/08-langgraph-multi-agent-structures-01

---

## Módulo 2: Handoffs entre Agentes (Nivel Intermedio)

### 2.1 ¿Qué es un handoff?

**Handoff** es cuando un agente pasa el control a otro agente. Es el mecanismo fundamental de comunicación en sistemas multi-agente.

### 2.2 Implementación con Conditional Edges

```typescript
graph.addConditionalEdges(
  "supervisor",
  routingFunction,
  {
    "research": "researchAgent",
    "api": "apiAgent",
    "chart": "chartAgent",
    "end": END
  }
);

const routingFunction = (state: State) => {
  if (state.needsData) return "api";
  if (state.needsSearch) return "research";
  if (state.needsChart) return "chart";
  return "end";
};
```

### 2.3 Implementación con Command Objects (Más flexible)

```typescript
import { Command } from "@langchain/langgraph";

const handoffToRAG = tool({
  name: "transfer_to_rag",
  description: "Transfer to RAG agent for document search",
  schema: z.object({ query: z.string() }),
  func: async ({ query }) => {
    return new Command({
      goto: "ragAgent",        // Destino
      update: {                // Payload/contexto
        messages: [{ role: "user", content: query }],
        currentTask: "search"
      },
      graph: Command.PARENT    // Para subgrafos
    });
  }
});
```

### 2.4 Tipos de handoff

| Tipo | Descripción | Uso |
|------|-------------|-----|
| **Sequential** | Tareas lineales, cada agente construye sobre el anterior | Pipelines de procesamiento |
| **Conditional** | El agente decide quién es mejor para el siguiente paso | Routing dinámico |
| **Parallel** | Múltiples agentes trabajan simultáneamente (scatter-gather) | Tareas independientes |

### 2.5 Mejores prácticas para handoffs

- **Preservar contexto**: Pasar información relevante al siguiente agente
- **Limitar historial**: No pasar todo el historial, solo lo necesario
- **Definir contratos**: Cada agente debe tener inputs/outputs claros
- **Fallbacks**: Definir qué hacer si el handoff falla

---

## Módulo 3: Planificación Automática (Nivel Intermedio-Avanzado)

### 3.1 ¿Cómo puede un agente generar un plan?

El supervisor analiza la consulta y descompone en subtareas asignables:

```typescript
const supervisorPrompt = `You are a planning supervisor. Given a user request:
1. Break it into subtasks
2. Assign each subtask to the appropriate agent
3. Determine execution order

Available agents:
- api_agent: Business data queries
- rag_agent: Document search
- chart_agent: Data visualization

Respond with JSON: {
  "plan": [
    { "agent": "api_agent", "task": "Get Q4 sales data" },
    { "agent": "chart_agent", "task": "Create bar chart from sales data" }
  ]
}`;
```

### 3.2 Ejecución del plan

```typescript
const executePlan = async (state: State) => {
  const plan = JSON.parse(state.plan);
  let results = {};
  
  for (const step of plan.plan) {
    // Ejecutar cada paso secuencialmente
    const result = await executeAgent(step.agent, step.task, results);
    results[step.agent] = result;
  }
  
  return { results };
};
```

### 3.3 Planificación con Send (Parallel)

```typescript
import { Send } from "@langchain/langgraph";

const planAndDispatch = (state: State) => {
  const tasks = analyzeTasks(state.messages);
  
  // Dispatch paralelo a múltiples agentes
  return tasks.map(task => 
    new Send(task.agent, { 
      task: task.description,
      context: state.context 
    })
  );
};
```

---

## Módulo 4: Arquitectura Multi-Agente Completa (Nivel Avanzado)

### 4.1 Caso práctico: Sistema con 4 agentes especializados

**Arquitectura propuesta:**
```
                    ┌─────────────────┐
                    │   Orquestador   │
                    │   (Supervisor)  │
                    └────────┬────────┘
         ┌──────────────┬────┴────┬──────────────┐
         ▼              ▼         ▼              ▼
┌────────────────┐ ┌────────┐ ┌────────┐ ┌────────────────┐
│ Business       │ │  RAG   │ │ Chart  │ │   Orquestador  │
│ Central Agent  │ │ Agent  │ │ Agent  │ │   (Retorna)    │
└────────────────┘ └────────┘ └────────┘ └────────────────┘
```

### 4.2 Implementación completa en TypeScript

```typescript
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph-checkpoint";

// ============================================
// 1. DEFINIR ESTADO COMPARTIDO
// ============================================
const OrchestratorState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => prev.concat(next),
    default: () => []
  }),
  activeAgent: Annotation<string>(),
  apiData: Annotation<any>(),
  ragContext: Annotation<string[]>(),
  chartConfig: Annotation<any>()
});

// ============================================
// 2. AGENTE: BUSINESS CENTRAL (API)
// ============================================
const businessCentralAgent = async (state: typeof OrchestratorState.State) => {
  const query = extractApiQuery(state.messages);
  
  // Llamada a Business Central API
  const response = await fetch(
    `${BC_BASE_URL}/api/v2.0/companies(${COMPANY_ID})/salesInvoices`,
    {
      headers: {
        'Authorization': `Bearer ${BC_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
  const data = await response.json();
  
  return {
    messages: [{ 
      role: "ai", 
      content: `Retrieved ${data.value.length} records from Business Central` 
    }],
    apiData: data.value
  };
};

// ============================================
// 3. AGENTE: RAG (AZURE AI SEARCH)
// ============================================
const ragAgent = async (state: typeof OrchestratorState.State) => {
  const question = getLastUserMessage(state.messages);
  
  // Búsqueda vectorial en Azure AI Search
  const searchClient = new SearchClient(
    AZURE_SEARCH_ENDPOINT,
    AZURE_SEARCH_INDEX,
    new AzureKeyCredential(AZURE_SEARCH_KEY)
  );
  
  const results = await searchClient.search(question, {
    vectorQueries: [{
      kind: "vector",
      vector: await getEmbedding(question),
      kNearestNeighborsCount: 5,
      fields: ["contentVector"]
    }],
    select: ["content", "title"]
  });
  
  const context = [];
  for await (const result of results.results) {
    context.push(result.document.content);
  }
  
  // Generar respuesta con contexto
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  const answer = await llm.invoke([
    { role: "system", content: `Context:\n${context.join("\n\n")}` },
    { role: "user", content: question }
  ]);
  
  return {
    messages: [answer],
    ragContext: context
  };
};

// ============================================
// 4. AGENTE: GRAFICADOR (TREMOR)
// ============================================
const chartAgent = async (state: typeof OrchestratorState.State) => {
  const data = state.apiData || state.ragContext;
  
  // Generar configuración de gráfico para Tremor
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  const chartSpec = await llm.invoke([
    { 
      role: "system", 
      content: `Generate a Tremor chart config for this data. 
      Output JSON with: { type, data, categories, index, colors }` 
    },
    { role: "user", content: JSON.stringify(data) }
  ]);
  
  const config = JSON.parse(chartSpec.content);
  
  return {
    messages: [{ 
      role: "ai", 
      content: `Chart generated: ${config.type}` 
    }],
    chartConfig: config
  };
};

// ============================================
// 5. SUPERVISOR/ORQUESTADOR
// ============================================
const supervisorPrompt = `You are a supervisor managing specialized agents:

AGENTS:
- bc_agent: Queries Microsoft Business Central API for business data
- rag_agent: Searches internal documents using Azure AI Search
- chart_agent: Creates visualizations with Tremor from data

RULES:
1. Analyze the user request
2. Decide which agent(s) to invoke
3. For visualizations, first get data (bc_agent or rag_agent), then chart_agent

Respond JSON: { "next": "agent_name" | "FINISH", "reason": "..." }`;

const supervisor = async (state: typeof OrchestratorState.State) => {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const response = await llm.invoke([
    { role: "system", content: supervisorPrompt },
    ...state.messages,
    { role: "user", content: `Current state: apiData=${!!state.apiData}, ragContext=${!!state.ragContext}` }
  ]);
  
  const decision = JSON.parse(response.content);
  
  return {
    messages: [{ role: "ai", content: `Routing to: ${decision.next}` }],
    activeAgent: decision.next
  };
};

// ============================================
// 6. ROUTING FUNCTION
// ============================================
const routeToAgent = (state: typeof OrchestratorState.State): string => {
  const agent = state.activeAgent;
  
  switch(agent) {
    case "bc_agent": return "businessCentralAgent";
    case "rag_agent": return "ragAgent";
    case "chart_agent": return "chartAgent";
    case "FINISH": return END;
    default: return "supervisor";
  }
};

// ============================================
// 7. CONSTRUIR EL GRAFO
// ============================================
const workflow = new StateGraph(OrchestratorState)
  // Nodos
  .addNode("supervisor", supervisor)
  .addNode("businessCentralAgent", businessCentralAgent)
  .addNode("ragAgent", ragAgent)
  .addNode("chartAgent", chartAgent)
  
  // Flujo
  .addEdge(START, "supervisor")
  .addConditionalEdges("supervisor", routeToAgent)
  .addEdge("businessCentralAgent", "supervisor")
  .addEdge("ragAgent", "supervisor")
  .addEdge("chartAgent", "supervisor");

// ============================================
// 8. COMPILAR CON PERSISTENCIA
// ============================================
const checkpointer = new MemorySaver(); // Usar PostgresSaver en producción

const app = workflow.compile({ 
  checkpointer,
  // Opcional: interrumpir para aprobación humana
  // interruptBefore: ["businessCentralAgent"]
});

// ============================================
// 9. EJECUTAR
// ============================================
const result = await app.invoke({
  messages: [{ 
    role: "user", 
    content: "Muéstrame las ventas de Q4 2025 en un gráfico de barras" 
  }]
}, {
  configurable: { thread_id: "user-session-456" }
});

console.log(result.chartConfig); // Configuración Tremor lista para renderizar
```

### 4.3 Componente React con Tremor

```tsx
import { BarChart, Card, Title } from "@tremor/react";

function SalesChart({ config }) {
  return (
    <Card>
      <Title>{config.title}</Title>
      <BarChart
        data={config.data}
        index={config.index}
        categories={config.categories}
        colors={config.colors}
      />
    </Card>
  );
}
```

---

## Módulo 5: State Management entre Múltiples Agentes (Nivel Avanzado)

### 5.1 Diseño del estado compartido

**Principios clave:**
- **Immutabilidad**: Cada actualización crea nuevo estado
- **Reducers**: Definen cómo se combinan actualizaciones
- **Tipado fuerte**: TypeScript + Zod para validación

```typescript
const MultiAgentState = Annotation.Root({
  // Mensajes: se concatenan
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) => {
      if (Array.isArray(right)) return left.concat(right);
      return left.concat([right]);
    },
    default: () => []
  }),
  
  // Último valor gana
  activeAgent: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "supervisor"
  }),
  
  // Merge de objetos (cada agente añade su resultado)
  agentResults: Annotation<Record<string, any>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({})
  }),
  
  // Flags de control
  needsHumanApproval: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false
  })
});
```

### 5.2 Patrones de comunicación

**1. Message Passing (Recomendado)**
```typescript
// Cada agente añade mensajes al historial compartido
return { 
  messages: [{ role: "ai", content: result }] 
};
```

**2. Shared Scratchpad**
```typescript
// Área de trabajo compartida para notas intermedias
return { 
  scratchpad: [...state.scratchpad, newNote] 
};
```

**3. Result Aggregation**
```typescript
// Cada agente deposita su resultado en un objeto compartido
return { 
  agentResults: { [agentName]: myResult } 
};
```

### 5.3 Isolation patterns

Para evitar que agentes interfieran entre sí:

```typescript
// Cada agente solo ve lo que necesita
const agentView = {
  messages: state.messages.slice(-10), // Solo últimos 10 mensajes
  context: state.agentResults.rag, // Solo resultado de RAG
};
```

---

## Módulo 6: Testing y Debugging de Sistemas Multi-Agente (Nivel Avanzado)

### 6.1 Unit testing de nodos individuales

```typescript
import { describe, test, expect } from "vitest";

describe("Business Central Agent", () => {
  test("should extract data correctly", async () => {
    const state = { 
      messages: [{ role: "user", content: "Get Q4 sales" }],
      apiData: null,
      ragContext: [],
      chartConfig: null,
      activeAgent: "bc_agent"
    };
    
    const result = await businessCentralAgent(state);
    
    expect(result.apiData).toBeDefined();
    expect(result.apiData.length).toBeGreaterThan(0);
  });
  
  test("should handle API errors gracefully", async () => {
    // Mock API failure
    const result = await businessCentralAgent(stateWithBadAuth);
    
    expect(result.messages[0].content).toContain("error");
  });
});
```

### 6.2 Integration testing del grafo completo

```typescript
describe("Full Orchestration Flow", () => {
  test("should route through correct agents for chart request", async () => {
    const result = await app.invoke({
      messages: [{ 
        role: "user", 
        content: "Show me sales data in a chart" 
      }]
    }, {
      configurable: { thread_id: "test-1" }
    });
    
    // Verificar que pasó por los agentes correctos
    expect(result.apiData).toBeDefined();
    expect(result.chartConfig).toBeDefined();
    expect(result.chartConfig.type).toBe("bar");
  });
});
```

### 6.3 Debugging con LangSmith

```typescript
// Habilitar tracing detallado
process.env.LANGSMITH_TRACING = "true";
process.env.LANGSMITH_PROJECT = "multi-agent-debug";

// Tags para filtrar en LangSmith
const config = {
  configurable: { thread_id: "debug-session" },
  tags: ["multi-agent", "testing"],
  metadata: { user: "test-user", scenario: "chart-generation" }
};

const result = await app.invoke(input, config);
```

**En LangSmith podrás ver:**
- Flujo completo entre agentes
- Decisiones del supervisor
- Inputs/outputs de cada nodo
- Tiempos de ejecución
- Tokens consumidos

### 6.4 Simulation testing

```typescript
// Simular usuario virtual para testing end-to-end
const simulatedUser = async (state: State) => {
  const llm = new ChatOpenAI({ model: "gpt-4o" });
  
  const response = await llm.invoke([
    { 
      role: "system", 
      content: "You are a user testing a business intelligence assistant. Ask questions about sales, inventory, and request charts."
    },
    ...state.messages
  ]);
  
  return { messages: [response] };
};
```

### 6.5 Herramientas de evaluación

| Herramienta | Propósito | URL |
|-------------|-----------|-----|
| **LangSmith** | Tracing, evaluación de trayectorias | https://smith.langchain.com/ |
| **LangGraph Studio** | Debugging visual de grafos | https://github.com/langchain-ai/langgraph-studio |
| **Langfuse** | Observabilidad open-source | https://langfuse.com/ |
| **Promptfoo** | Red teaming, evaluación adversarial | https://promptfoo.dev/ |

---

## Módulo 7: Escalabilidad y Patrones de Producción (Nivel Avanzado)

### 7.1 Estrategias de escalabilidad

**Horizontal Scaling**
- LangGraph Cloud maneja task queues auto-escalables
- Cada request es independiente con su thread_id

**Parallel Execution**
```typescript
import { Send } from "@langchain/langgraph";

const scatterGather = (state: State) => {
  // Dispatch paralelo a múltiples workers
  return state.tasks.map(task => 
    new Send("workerAgent", { task })
  );
};
```

**Caching**
```typescript
// Cachear respuestas de LLM repetidas
import { InMemoryCache } from "langchain/cache";

const llm = new ChatOpenAI({
  model: "gpt-4o",
  cache: new InMemoryCache()
});
```

### 7.2 Optimización de costos

| Estrategia | Impacto |
|------------|---------|
| Limitar historial pasado a sub-agentes | -40-50% tokens |
| Usar modelos pequeños para routing | -60% costo |
| Cachear embeddings y búsquedas | -30% latencia |
| Batch requests cuando sea posible | -20% overhead |

```typescript
// Limitar historial
const limitedMessages = state.messages.slice(-5);

// Modelo pequeño para routing
const routerLLM = new ChatOpenAI({ model: "gpt-4o-mini" });
const workerLLM = new ChatOpenAI({ model: "gpt-4o" });
```

### 7.3 Patrones de producción

**1. Modularidad**
```
/src
  /agents
    supervisor.ts
    businessCentral.ts
    rag.ts
    chart.ts
  /tools
    bcApi.ts
    azureSearch.ts
  /state
    schema.ts
    reducers.ts
  /graph
    workflow.ts
```

**2. Error Boundaries**
```typescript
const safeAgent = async (state: State) => {
  try {
    return await riskyOperation(state);
  } catch (error) {
    console.error("Agent failed:", error);
    return {
      messages: [{ role: "ai", content: "Operation failed, trying fallback" }],
      error: error.message
    };
  }
};
```

**3. Human-in-the-Loop**
```typescript
const app = workflow.compile({
  checkpointer,
  interruptBefore: ["businessCentralAgent"] // Pausar para aprobación
});

// Continuar después de aprobación
await app.invoke(null, { 
  configurable: { thread_id: "..." } 
});
```

**4. Rate Limiting**
```typescript
import { RateLimiter } from "limiter";

const limiter = new RateLimiter({
  tokensPerInterval: 100,
  interval: "minute"
});

const rateLimitedAgent = async (state: State) => {
  await limiter.removeTokens(1);
  return await actualAgent(state);
};
```

### 7.4 Deployment con LangGraph Cloud

```yaml
# langgraph.json
{
  "graphs": {
    "orchestrator": "./src/graph/workflow.ts:app"
  },
  "dependencies": ["@langchain/langgraph", "@langchain/openai"]
}
```

```bash
# Deploy
langgraph cloud deploy
```

**Recursos:**
- 📚 **LangGraph Cloud**: https://www.langchain.com/langgraph
- 📚 **State of AI Agents**: https://www.langchain.com/stateofaiagents
- 📚 **Production Patterns**: https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph

---

## Recursos Consolidados por Nivel

### Nivel Básico (Semanas 1-2)
| Recurso | Tipo | URL |
|---------|------|-----|
| LangChain.js Quickstart | Docs | https://docs.langchain.com/oss/javascript/langchain/quickstart |
| RAG From Scratch (Videos 1-4) | Video | https://youtube.com/playlist?list=PLfaIDFEXuae2LXbO1_PKyVJiQ23ZztA0x |
| LangChain Academy - Intro | Curso | https://academy.langchain.com/ |

### Nivel Intermedio (Semanas 3-4)
| Recurso | Tipo | URL |
|---------|------|-----|
| LangGraph Academy | Curso | https://academy.langchain.com/courses/intro-to-langgraph |
| LangSmith Academy | Curso | https://academy.langchain.com/courses/intro-to-langsmith |
| RAG From Scratch (Videos 5-11) | Video | https://youtube.com/playlist?list=PLfaIDFEXuae2LXbO1_PKyVJiQ23ZztA0x |
| Multi-Agent Blog | Artículo | https://blog.langchain.com/langgraph-multi-agent-workflows/ |

### Nivel Avanzado (Semanas 5-8)
| Recurso | Tipo | URL |
|---------|------|-----|
| Choosing Multi-Agent Architecture | Artículo | https://blog.langchain.com/choosing-the-right-multi-agent-architecture/ |
| RAG From Scratch (Videos 12-18) | Video | https://youtube.com/playlist?list=PLfaIDFEXuae2LXbO1_PKyVJiQ23ZztA0x |
| LangSmith Cookbook | Código | https://github.com/langchain-ai/langsmith-cookbook |
| Agents from Scratch TS | Código | https://github.com/langchain-ai/agents-from-scratch-ts |
| Deep Agents Course | Curso | https://academy.langchain.com/ |

### Documentación Oficial
| Herramienta | URL |
|-------------|-----|
| LangChain.js | https://js.langchain.com/docs/ |
| LangGraph.js | https://docs.langchain.com/oss/javascript/langgraph/overview |
| LangSmith | https://docs.smith.langchain.com/ |
| Agent Builder | https://docs.langchain.com/langsmith/agent-builder |
| BAML | https://docs.boundaryml.com/home |
| Guardrails AI | https://guardrailsai.com/docs |

### Repositorios GitHub
| Repo | URL |
|------|-----|
| LangChain.js | https://github.com/langchain-ai/langchainjs |
| LangGraph.js | https://github.com/langchain-ai/langgraphjs |
| RAG From Scratch Notebooks | https://github.com/langchain-ai/rag-from-scratch |
| BAML | https://github.com/BoundaryML/baml |

### NPM Packages
```bash
# Core
npm install langchain @langchain/core @langchain/openai

# LangGraph
npm install @langchain/langgraph
npm install @langchain/langgraph-checkpoint
npm install @langchain/langgraph-checkpoint-postgres

# Observability
npm install langsmith

# BAML (opcional)
npm install @boundaryml/baml
```

---

Este temario proporciona una ruta de aprendizaje completa desde conceptos básicos de LangChain hasta la implementación de sistemas multi-agente en producción, con recursos específicos para cada etapa del aprendizaje.