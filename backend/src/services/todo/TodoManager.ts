/**
 * Todo Manager Service
 *
 * Automatically generates and tracks todo lists for agent tasks.
 * Uses Agent SDK in 'plan' mode to generate initial task breakdown.
 *
 * Pattern based on Claude Agent SDK documentation:
 * - Use SDK with permissionMode: 'plan' for planning
 * - Generate todos from agent's plan
 * - Track progress via onPreToolUse/onPostToolUse hooks
 * - Emit real-time updates via WebSocket
 *
 * @module services/todo/TodoManager
 */

import { Server as SocketServer } from 'socket.io';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { getDatabase } from '../../config/database';
import {
  Todo,
  TodoStatus,
  TodoCreateRequest,
  TodoCreatedEvent,
  TodoUpdatedEvent,
  TodoCompletedEvent,
  AgentPlan,
  GenerateTodosOptions,
} from '../../types/todo.types';

/**
 * TodoManager class
 *
 * Manages automatic todo list generation and tracking
 */
export class TodoManager {
  private io: SocketServer;
  private static instance: TodoManager | null = null;

  private constructor(io: SocketServer) {
    this.io = io;
  }

  /**
   * Get singleton instance of TodoManager
   *
   * @param io - Socket.IO server instance
   * @returns TodoManager instance
   */
  public static getInstance(io?: SocketServer): TodoManager {
    if (!TodoManager.instance) {
      if (!io) {
        throw new Error('Socket.IO server is required to initialize TodoManager');
      }
      TodoManager.instance = new TodoManager(io);
    }
    return TodoManager.instance;
  }

  /**
   * Generate todos from user prompt using Agent SDK
   *
   * Uses Agent SDK in 'plan' mode to analyze the prompt and generate a step-by-step plan.
   * Creates todos in database and emits event to client.
   *
   * @param options - Generation options
   * @returns Array of created todos
   *
   * @example
   * const todos = await todoManager.generateFromPlan({
   *   sessionId: 'session-123',
   *   prompt: 'Create 3 customers: Acme Corp, Beta Inc, Gamma LLC'
   * });
   * // Result: [
   * //   { content: 'Create customer Acme Corp', status: 'pending' },
   * //   { content: 'Create customer Beta Inc', status: 'pending' },
   * //   { content: 'Create customer Gamma LLC', status: 'pending' }
   * // ]
   */
  public async generateFromPlan(options: GenerateTodosOptions): Promise<Todo[]> {
    const { sessionId, prompt, useSDKPlanning = true } = options;

    if (!useSDKPlanning) {
      // Fallback: Simple heuristic-based planning
      return this.generateTodosHeuristic(sessionId, prompt);
    }

    try {
      console.log(`[TodoManager] Generating todos for session ${sessionId}`);

      // Use Agent SDK in 'plan' mode to generate plan
      const planResult = query({
        prompt: `Break down this task into specific, actionable steps:\n\n"${prompt}"\n\nReturn a JSON array of step descriptions. Each step should be a clear, imperative action (e.g., "Create customer Acme Corp"). Format:\n\n{"steps": ["Step 1", "Step 2", ...]}`,
        options: {
          permissionMode: 'plan', // Read-only mode, no tool execution
          mcpServers: {}, // No MCP for planning
        },
      });

      let steps: string[] = [];
      let planText = '';

      for await (const event of planResult) {
        // Check for assistant message
        if (event.type === 'assistant') {
          // Extract text from content blocks
          for (const contentBlock of event.message.content) {
            if (contentBlock.type === 'text') {
              planText += contentBlock.text;
            }
          }
        }
      }

      // Extract JSON from response
      try {
        // Try to parse as JSON
        const jsonMatch = planText.match(/\{[\s\S]*"steps"[\s\S]*\}/);
        if (jsonMatch) {
          const plan = JSON.parse(jsonMatch[0]) as AgentPlan;
          steps = plan.steps;
        } else {
          // Fallback: Parse as markdown list
          steps = planText
            .split('\n')
            .filter(line => line.trim().match(/^[\d\-\*\.]\s+/))
            .map(line => line.replace(/^[\d\-\*\.]\s+/, '').trim())
            .filter(line => line.length > 0);
        }
      } catch {
        console.warn('[TodoManager] Failed to parse plan JSON, using heuristic fallback');
        return this.generateTodosHeuristic(sessionId, prompt);
      }

      if (steps.length === 0) {
        console.warn('[TodoManager] No steps generated, using heuristic fallback');
        return this.generateTodosHeuristic(sessionId, prompt);
      }

      console.log(`[TodoManager] Generated ${steps.length} steps from plan`);

      // Create todos in database
      const todos = await this.createTodosFromSteps(sessionId, steps);

      // Emit event to client
      const event: TodoCreatedEvent = {
        sessionId,
        todos,
      };
      this.io.to(sessionId).emit('todo:created', event);

      console.log(`[TodoManager] ✅ Created ${todos.length} todos for session ${sessionId}`);

      return todos;
    } catch (error) {
      console.error('[TodoManager] Failed to generate todos from plan:', error);
      // Fallback to heuristic method
      return this.generateTodosHeuristic(sessionId, prompt);
    }
  }

  /**
   * Create a single todo manually
   *
   * @param request - Todo creation request
   * @returns Created todo
   */
  public async createManualTodo(request: TodoCreateRequest): Promise<Todo> {
    const { sessionId, content, activeForm, order } = request;

    const db = getDatabase();
    if (!db) {
      throw new Error('Database connection not available');
    }

    const todoId = this.generateTodoId();
    const now = new Date();

    // Determine order if not provided
    let todoOrder = order;
    if (todoOrder === undefined) {
      const result = await db.request()
        .input('session_id', sessionId)
        .query('SELECT MAX([order]) as maxOrder FROM todos WHERE session_id = @session_id');

      todoOrder = (result.recordset[0]?.maxOrder ?? -1) + 1;
    }

    await db.request()
      .input('id', todoId)
      .input('session_id', sessionId)
      .input('content', content)
      .input('activeForm', activeForm)
      .input('status', 'pending')
      .input('order', todoOrder)
      .input('created_at', now)
      .query(`
        INSERT INTO todos (id, session_id, content, activeForm, status, [order], created_at)
        VALUES (@id, @session_id, @content, @activeForm, @status, @order, @created_at)
      `);

    const todo: Todo = {
      id: todoId,
      session_id: sessionId,
      content,
      activeForm,
      status: 'pending',
      order: todoOrder ?? 0,
      created_at: now,
    };

    // Emit event
    this.io.to(sessionId).emit('todo:created', { sessionId, todos: [todo] });

    return todo;
  }

  /**
   * Mark a todo as in progress
   *
   * @param sessionId - Session ID
   * @param todoId - Todo ID
   */
  public async markInProgress(sessionId: string, todoId: string): Promise<void> {
    await this.updateTodoStatus(sessionId, todoId, 'in_progress');
  }

  /**
   * Mark a todo as completed or failed
   *
   * @param sessionId - Session ID
   * @param todoId - Todo ID
   * @param success - Whether the task succeeded
   */
  public async markCompleted(sessionId: string, todoId: string, success: boolean): Promise<void> {
    const status: TodoStatus = success ? 'completed' : 'failed';
    await this.updateTodoStatus(sessionId, todoId, status);

    // Emit completion event
    const event: TodoCompletedEvent = {
      todoId,
      sessionId,
      status,
      completedAt: new Date(),
    };
    this.io.to(sessionId).emit('todo:completed', event);
  }

  /**
   * Get all todos for a session
   *
   * @param sessionId - Session ID
   * @returns Array of todos
   */
  public async getTodosBySession(sessionId: string): Promise<Todo[]> {
    const db = getDatabase();
    if (!db) {
      throw new Error('Database connection not available');
    }

    const result = await db.request()
      .input('session_id', sessionId)
      .query(`
        SELECT id, session_id, content, activeForm, status, [order], created_at, started_at, completed_at
        FROM todos
        WHERE session_id = @session_id
        ORDER BY [order] ASC
      `);

    return result.recordset.map((row) => ({
      id: row.id,
      session_id: row.session_id,
      content: row.content,
      activeForm: row.activeForm,
      status: row.status as TodoStatus,
      order: row.order,
      created_at: row.created_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
    }));
  }

  /**
   * Update todo status
   *
   * @param sessionId - Session ID
   * @param todoId - Todo ID
   * @param status - New status
   */
  private async updateTodoStatus(sessionId: string, todoId: string, status: TodoStatus): Promise<void> {
    const db = getDatabase();
    if (!db) {
      throw new Error('Database connection not available');
    }

    const now = new Date();
    const startedAtUpdate = status === 'in_progress' ? ', started_at = @now' : '';
    const completedAtUpdate = (status === 'completed' || status === 'failed') ? ', completed_at = @now' : '';

    await db.request()
      .input('id', todoId)
      .input('status', status)
      .input('now', now)
      .query(`
        UPDATE todos
        SET status = @status${startedAtUpdate}${completedAtUpdate}
        WHERE id = @id
      `);

    // Emit update event
    const event: TodoUpdatedEvent = {
      todoId,
      sessionId,
      status,
      completedAt: (status === 'completed' || status === 'failed') ? now : undefined,
    };
    this.io.to(sessionId).emit('todo:updated', event);

    console.log(`[TodoManager] Todo ${todoId} → ${status}`);
  }

  /**
   * Create todos from steps array
   *
   * @param sessionId - Session ID
   * @param steps - Array of step descriptions
   * @returns Array of created todos
   */
  private async createTodosFromSteps(sessionId: string, steps: string[]): Promise<Todo[]> {
    const db = getDatabase();
    if (!db) {
      throw new Error('Database connection not available');
    }

    const todos: Todo[] = [];
    const now = new Date();

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (!step) continue; // Skip undefined steps

      const todoId = this.generateTodoId();

      // Generate active form (present continuous)
      const activeForm = this.toActiveForm(step);

      await db.request()
        .input('id', todoId)
        .input('session_id', sessionId)
        .input('content', step)
        .input('activeForm', activeForm)
        .input('status', 'pending')
        .input('order', i)
        .input('created_at', now)
        .query(`
          INSERT INTO todos (id, session_id, content, activeForm, status, [order], created_at)
          VALUES (@id, @session_id, @content, @activeForm, @status, @order, @created_at)
        `);

      todos.push({
        id: todoId,
        session_id: sessionId,
        content: step,
        activeForm,
        status: 'pending',
        order: i,
        created_at: now,
      });
    }

    return todos;
  }

  /**
   * Generate todos using simple heuristics (fallback)
   *
   * @param sessionId - Session ID
   * @param prompt - User prompt
   * @returns Array of created todos
   */
  private async generateTodosHeuristic(sessionId: string, prompt: string): Promise<Todo[]> {
    console.log('[TodoManager] Using heuristic todo generation (simple fallback)');

    // Create one generic todo with the full prompt
    // This is more reliable than trying to parse specific patterns with regex
    const step = prompt.length > 100 ? `${prompt.substring(0, 97)}...` : prompt;

    return this.createTodosFromSteps(sessionId, [step]);
  }

  /**
   * Convert imperative form to present continuous (active form)
   *
   * @param imperative - Imperative form (e.g., "Create customer")
   * @returns Present continuous form (e.g., "Creating customer")
   */
  private toActiveForm(imperative: string): string {
    // Basic conversion rules
    const verbMap: Record<string, string> = {
      'create': 'creating',
      'update': 'updating',
      'delete': 'deleting',
      'fetch': 'fetching',
      'query': 'querying',
      'validate': 'validating',
      'analyze': 'analyzing',
      'generate': 'generating',
      'send': 'sending',
      'process': 'processing',
    };

    const firstWord = imperative.split(' ')[0]?.toLowerCase() || imperative.toLowerCase();
    const rest = imperative.substring(firstWord.length).trim();

    const activeVerb = verbMap[firstWord] || `${firstWord}ing`;
    return `${activeVerb.charAt(0).toUpperCase()}${activeVerb.slice(1)} ${rest}`;
  }

  /**
   * Generate unique todo ID
   *
   * @returns Unique todo ID
   */
  private generateTodoId(): string {
    return `todo-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * Get singleton instance of TodoManager
 *
 * @param io - Socket.IO server instance (required on first call)
 * @returns TodoManager instance
 */
export function getTodoManager(io?: SocketServer): TodoManager {
  return TodoManager.getInstance(io);
}
