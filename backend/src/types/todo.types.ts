/**
 * Todo List System Types
 *
 * Types for the automatic todo list tracking system.
 * Used to track agent task progress in real-time.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/**
 * Todo item stored in database
 */
export interface Todo {
  id: string;
  session_id: string;
  content: string; // Imperative form: "Create customer", "Update item"
  activeForm: string; // Present continuous form: "Creating customer", "Updating item"
  status: TodoStatus;
  order: number; // Order in the list (0-indexed)
  created_at: Date;
  started_at?: Date;
  completed_at?: Date;
}

/**
 * Request to create a new todo
 */
export interface TodoCreateRequest {
  sessionId: string;
  content: string;
  activeForm: string;
  order?: number;
}

/**
 * Request to update a todo's status
 */
export interface TodoUpdateRequest {
  todoId: string;
  status: TodoStatus;
}

/**
 * Data sent to client when todo is created
 */
export interface TodoCreatedEvent {
  sessionId: string;
  todos: Todo[];
}

/**
 * Data sent to client when todo is updated
 */
export interface TodoUpdatedEvent {
  todoId: string;
  sessionId: string;
  status: TodoStatus;
  completedAt?: Date;
}

/**
 * Data sent to client when todo is completed
 */
export interface TodoCompletedEvent {
  todoId: string;
  sessionId: string;
  status: 'completed' | 'failed';
  completedAt: Date;
}

/**
 * Plan generated from agent prompt
 */
export interface AgentPlan {
  steps: string[];
  estimatedTime?: number;
  complexity?: 'low' | 'medium' | 'high';
}

/**
 * Options for generating todos from plan
 */
export interface GenerateTodosOptions {
  sessionId: string;
  prompt: string;
  useSDKPlanning?: boolean; // Default: true - use Agent SDK in plan mode
}
