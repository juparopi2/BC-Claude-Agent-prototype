/**
 * Script de diagnóstico para captura de eventos crudos de la API de Claude
 *
 * Este script usa directamente el Anthropic SDK (NO LangChain) para capturar
 * TODOS los eventos del stream sin ninguna transformación, con el propósito
 * de diagnóstico y análisis.
 *
 * Uso:
 *   npx ts-node backend/scripts/diagnose-claude-response.ts
 *   npx ts-node backend/scripts/diagnose-claude-response.ts --thinking
 *   npx ts-node backend/scripts/diagnose-claude-response.ts --tools
 *   npx ts-node backend/scripts/diagnose-claude-response.ts --web-search --prompt "What is the current weather in San Francisco?"
 *   npx ts-node backend/scripts/diagnose-claude-response.ts --vision path/to/image.png
 *   npx ts-node backend/scripts/diagnose-claude-response.ts --citations --prompt "What are the key features of Business Central?"
 *   npx ts-node backend/scripts/diagnose-claude-response.ts --interleaved
 *   npx ts-node backend/scripts/diagnose-claude-response.ts --thinking --tools --prompt "List customers"
 *
 * Notas sobre características especiales:
 *
 * - Web Search: Es un "server tool" (type: web_search_20250305) que se ejecuta
 *   en los servidores de Anthropic. Requiere que la feature esté habilitada en
 *   la Console de Anthropic para tu organización. Si no está habilitada, el
 *   request puede fallar con error de permisos.
 *
 * - Citations: Requiere agregar document blocks con citations.enabled=true.
 *   Las citations permiten a Claude referenciar secciones específicas del
 *   documento en sus respuestas. El formato correcto incluye title y source.
 */

import Anthropic from '@anthropic-ai/sdk';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config({ path: path.join(__dirname, '../.env') });

// Interfaces para el reporte de diagnóstico
interface CapturedEvent {
  timestamp: number;
  eventType: string;
  index?: number;
  rawEvent: unknown;
}

interface DiagnosticReport {
  startTime: number;
  endTime: number;
  model: string;
  options: {
    thinking: boolean;
    tools: boolean;
    webSearch: boolean;
    vision: boolean;
    citations: boolean;
    interleaved: boolean;
  };
  prompt: string;
  events: CapturedEvent[];
  finalMessage?: unknown;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Configuración del CLI
const program = new Command();

program
  .name('diagnose-claude-response')
  .description('Captura eventos crudos de la API de Claude para diagnóstico')
  .option('--thinking', 'Habilita extended thinking con budget_tokens')
  .option('--tools', 'Incluye una herramienta simple para test de tool_use')
  .option('--web-search', 'Incluye el server tool de web search')
  .option('--vision <path>', 'Incluye una imagen desde un archivo')
  .option('--citations', 'Incluye un documento con citations.enabled=true')
  .option('--interleaved', 'Agrega el header beta de interleaved thinking')
  .option('--output <dir>', 'Directorio de salida', '../docs/plans/phase-0/captured-events/')
  .option('--prompt <text>', 'Prompt personalizado', 'Explain the concept of recursion in simple terms.')
  .parse();

const options = program.opts();

// Validaciones
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('Error: ANTHROPIC_API_KEY no está configurada en el archivo .env');
  process.exit(1);
}

// Cliente Anthropic
const client = new Anthropic({
  apiKey: apiKey,
});

// Constantes
const MODEL = 'claude-sonnet-4-20250514';
const THINKING_BUDGET_TOKENS = 10000;
const MAX_TOKENS = 16000; // Must be greater than thinking budget

/**
 * Crea una herramienta simple para testing de tool_use
 */
function createSimpleToolDefinition(): Anthropic.Tool {
  return {
    name: 'get_current_time',
    description: 'Returns the current time in ISO format. Use this when the user asks for the current time.',
    input_schema: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'The timezone to use (e.g., "America/New_York", "UTC"). Defaults to UTC.',
        },
      },
      required: [],
    },
  };
}

/**
 * Simula la ejecución de la herramienta
 */
function executeSimpleTool(toolName: string, toolInput: unknown): string {
  if (toolName === 'get_current_time') {
    const input = toolInput as { timezone?: string };
    const timezone = input.timezone || 'UTC';
    const now = new Date();
    return JSON.stringify({
      time: now.toISOString(),
      timezone: timezone,
      unix_timestamp: Math.floor(now.getTime() / 1000),
    });
  }
  return JSON.stringify({ error: 'Unknown tool' });
}

/**
 * Lee una imagen desde el filesystem y la convierte a base64
 */
function readImageAsBase64(imagePath: string): { data: string; mediaType: string } {
  const absolutePath = path.resolve(imagePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Image file not found: ${absolutePath}`);
  }

  const buffer = fs.readFileSync(absolutePath);
  const base64 = buffer.toString('base64');

  // Detectar media type por extensión
  const ext = path.extname(absolutePath).toLowerCase();
  const mediaTypeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };

  const mediaType = mediaTypeMap[ext] || 'image/jpeg';

  return { data: base64, mediaType };
}

/**
 * Construye los mensajes según las opciones seleccionadas
 */
function buildMessages(): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  // Construir contenido del mensaje
  const content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam> = [];

  // Texto del prompt
  content.push({
    type: 'text',
    text: options.prompt,
  });

  // Vision: agregar imagen si se especificó
  if (options.vision) {
    try {
      const { data, mediaType } = readImageAsBase64(options.vision);
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: data,
        },
      });
      console.log(`✓ Image loaded from: ${options.vision}`);
    } catch (error) {
      const err = error as Error;
      console.error(`✗ Failed to load image: ${err.message}`);
      process.exit(1);
    }
  }

  // Citations: agregar documento si se especificó
  if (options.citations) {
    const sampleDocument = `# Business Central Overview

Microsoft Dynamics 365 Business Central is a comprehensive business management solution designed for small to medium-sized organizations. It helps manage financials, operations, supply chain, and customer relationships in one integrated platform.

## Key Features

- Financial Management
- Supply Chain Management
- Project Management
- Manufacturing
- Service Management
- Analytics and Reporting

Business Central offers both cloud and on-premises deployment options.`;

    // Citations require document blocks with citations.enabled=true
    content.push({
      type: 'document',
      source: {
        type: 'text',
        media_type: 'text/plain',
        data: sampleDocument,
      },
      title: 'Business Central Overview',
      citations: { enabled: true },
    } as Anthropic.DocumentBlockParam);
    console.log('✓ Document added with citations.enabled=true');
  }

  messages.push({
    role: 'user',
    content: content,
  });

  return messages;
}

/**
 * Construye server tools (como web search) según las opciones
 * Server tools tienen un formato diferente a client tools
 */
function buildServerTools(): Array<{ type: string; name: string; max_uses?: number }> {
  const serverTools: Array<{ type: string; name: string; max_uses?: number }> = [];

  if (options.webSearch) {
    // Web search es un server tool que se ejecuta en Anthropic
    serverTools.push({
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 3,
    });
    console.log('✓ Web search server tool added (type: web_search_20250305, max_uses: 3)');
  }

  return serverTools;
}

/**
 * Construye las herramientas según las opciones seleccionadas
 * Combina client tools (como get_current_time) con server tools (como web_search)
 */
function buildTools(): Anthropic.Tool[] | undefined {
  const tools: Anthropic.Tool[] = [];

  // Client tools (herramientas que ejecutamos localmente)
  if (options.tools) {
    tools.push(createSimpleToolDefinition());
    console.log('✓ Simple client tool (get_current_time) added');
  }

  // Server tools (herramientas que ejecuta Anthropic)
  const serverTools = buildServerTools();
  if (serverTools.length > 0) {
    // Server tools se agregan al mismo array pero con formato diferente
    // El SDK de Anthropic puede no tener tipos exactos, usamos type assertion
    tools.push(...(serverTools as unknown as Anthropic.Tool[]));
  }

  return tools.length > 0 ? tools : undefined;
}

/**
 * Construye el objeto de thinking si está habilitado
 */
function buildThinking(): { type: 'enabled'; budget_tokens: number } | undefined {
  if (options.thinking) {
    console.log(`✓ Extended thinking enabled (budget: ${THINKING_BUDGET_TOKENS} tokens)`);
    return {
      type: 'enabled',
      budget_tokens: THINKING_BUDGET_TOKENS,
    };
  }
  return undefined;
}

/**
 * Construye los headers extra si están habilitados
 */
function buildExtraHeaders(): Record<string, string> | undefined {
  if (options.interleaved) {
    console.log('✓ Interleaved thinking beta header added');
    return {
      'anthropic-beta': 'interleaved-thinking-2025-05-14',
    };
  }
  return undefined;
}

/**
 * Captura eventos del stream sin ninguna transformación
 */
async function captureClaudeEvents(): Promise<DiagnosticReport> {
  const startTime = Date.now();
  const capturedEvents: CapturedEvent[] = [];

  console.log('\n=== Starting Claude API Stream Capture ===\n');
  console.log(`Model: ${MODEL}`);
  console.log(`Prompt: "${options.prompt}"`);
  console.log(`Options: ${JSON.stringify({
    thinking: options.thinking,
    tools: options.tools,
    webSearch: options.webSearch,
    vision: Boolean(options.vision),
    citations: options.citations,
    interleaved: options.interleaved,
  })}\n`);

  // Construir parámetros de la API
  const messages = buildMessages();
  const tools = buildTools();
  const thinking = buildThinking();
  const extraHeaders = buildExtraHeaders();

  // Realizar llamada al stream
  let finalMessage: unknown;
  let usage: { input_tokens: number; output_tokens: number } | undefined;
  let turnCount = 1;

  // Loop agentic: continuar mientras Claude pida herramientas
  while (true) {
    console.log(`\n--- Turn ${turnCount} ---\n`);

    // Construir parámetros para el stream
    const streamParams: Anthropic.MessageCreateParams = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: messages,
    };

    if (tools) {
      streamParams.tools = tools;
    }

    if (thinking) {
      streamParams.thinking = thinking;
    }

    // Usar messages.stream() del SDK
    const stream = extraHeaders
      ? client.messages.stream(streamParams, { headers: extraHeaders })
      : client.messages.stream(streamParams);

    let currentMessageContent: Anthropic.Message | undefined;
    let toolUseBlocks: Array<{ id: string; name: string; input: unknown }> = [];

    // Capturar TODOS los eventos del stream
    for await (const event of stream) {
      const capturedEvent: CapturedEvent = {
        timestamp: Date.now(),
        eventType: event.type,
        rawEvent: event,
      };

      // Agregar index si el evento tiene content block
      if ('index' in event) {
        capturedEvent.index = event.index as number;
      }

      capturedEvents.push(capturedEvent);

      // Log de cada evento (breve)
      if (event.type === 'message_start') {
        console.log(`[${event.type}]`);
        currentMessageContent = event.message;
      } else if (event.type === 'content_block_start') {
        const contentType = event.content_block.type;
        console.log(`[${event.type}] index=${event.index} type=${contentType}`);
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          process.stdout.write(event.delta.text);
        } else if (event.delta.type === 'thinking_delta') {
          process.stdout.write(`[thinking: ${event.delta.thinking}]`);
        } else if (event.delta.type === 'input_json_delta') {
          process.stdout.write(`[input_json: ${event.delta.partial_json}]`);
        }
      } else if (event.type === 'content_block_stop') {
        console.log(`\n[${event.type}] index=${event.index}`);
      } else if (event.type === 'message_delta') {
        console.log(`[${event.type}] stop_reason=${event.delta.stop_reason || 'null'}`);
        if (event.usage) {
          usage = {
            input_tokens: event.usage.input_tokens || 0,
            output_tokens: event.usage.output_tokens || 0,
          };
        }
      } else if (event.type === 'message_stop') {
        console.log(`[${event.type}]`);
      } else {
        console.log(`[${event.type}]`);
      }
    }

    // Obtener el mensaje final
    finalMessage = await stream.finalMessage();

    // Verificar si hay tool_use blocks para ejecutar
    if (typeof finalMessage === 'object' && finalMessage !== null && 'content' in finalMessage) {
      const message = finalMessage as Anthropic.Message;

      for (const block of message.content) {
        if (block.type === 'tool_use') {
          toolUseBlocks.push({
            id: block.id,
            name: block.name,
            input: block.input,
          });
        }
      }
    }

    // Si no hay herramientas, terminamos
    if (toolUseBlocks.length === 0) {
      break;
    }

    // Ejecutar herramientas y agregar resultados a messages
    console.log(`\n✓ Executing ${toolUseBlocks.length} tool(s)...\n`);

    // Agregar mensaje del asistente
    if (typeof finalMessage === 'object' && finalMessage !== null && 'content' in finalMessage) {
      const message = finalMessage as Anthropic.Message;
      messages.push({
        role: 'assistant',
        content: message.content,
      });
    }

    // Agregar resultados de herramientas
    const toolResults: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map((toolUse) => {
      console.log(`  - Executing ${toolUse.name}...`);
      const result = executeSimpleTool(toolUse.name, toolUse.input);
      console.log(`    Result: ${result}`);

      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
      };
    });

    messages.push({
      role: 'user',
      content: toolResults,
    });

    turnCount++;

    // Prevenir loops infinitos
    if (turnCount > 10) {
      console.log('\n⚠ Maximum turn count reached (10), stopping...');
      break;
    }
  }

  const endTime = Date.now();

  console.log('\n\n=== Stream Capture Complete ===\n');
  console.log(`Total events captured: ${capturedEvents.length}`);
  console.log(`Duration: ${endTime - startTime}ms`);
  if (usage) {
    console.log(`Usage: ${usage.input_tokens} input tokens, ${usage.output_tokens} output tokens`);
  }

  // Construir reporte
  const report: DiagnosticReport = {
    startTime,
    endTime,
    model: MODEL,
    options: {
      thinking: options.thinking,
      tools: options.tools,
      webSearch: options.webSearch,
      vision: Boolean(options.vision),
      citations: options.citations,
      interleaved: options.interleaved,
    },
    prompt: options.prompt,
    events: capturedEvents,
    finalMessage,
    usage,
  };

  return report;
}

/**
 * Guarda el reporte en un archivo JSON
 */
function saveReport(report: DiagnosticReport): string {
  const outputDir = path.resolve(options.output);

  // Crear directorio si no existe
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Construir nombre del archivo
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const modeFlags: string[] = [];

  if (report.options.thinking) modeFlags.push('thinking');
  if (report.options.tools) modeFlags.push('tools');
  if (report.options.webSearch) modeFlags.push('web-search');
  if (report.options.vision) modeFlags.push('vision');
  if (report.options.citations) modeFlags.push('citations');
  if (report.options.interleaved) modeFlags.push('interleaved');

  const mode = modeFlags.length > 0 ? modeFlags.join('-') : 'basic';
  const filename = `${timestamp}-${mode}-diagnostic.json`;
  const filepath = path.join(outputDir, filename);

  // Guardar reporte
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf-8');

  return filepath;
}

/**
 * Función principal
 */
async function main(): Promise<void> {
  try {
    // Capturar eventos
    const report = await captureClaudeEvents();

    // Guardar reporte
    const filepath = saveReport(report);

    console.log(`\n✓ Diagnostic report saved to: ${filepath}\n`);
  } catch (error) {
    const err = error as Error;
    console.error('\n✗ Error during diagnostic capture:\n');
    console.error(err);
    process.exit(1);
  }
}

// Ejecutar
main();
