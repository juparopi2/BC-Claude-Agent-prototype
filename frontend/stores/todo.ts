/**
 * Todo Store
 *
 * Manages todo list state for the current session.
 * Integrates with WebSocket events (agent:event with TodoWrite tool results).
 *
 * Migration note: Replaces store/todoStore.ts with modern architecture using:
 * - types/api.ts for Todo type (not lib/types.ts)
 * - WebSocket context for real-time TodoWrite events
 */

import { create } from "zustand";
import type { Todo } from "@/types/api";

interface TodoState {
  /**
   * All todos across sessions (global cache)
   */
  todos: Todo[];

  /**
   * Todos for the current active session
   * Updated via setTodosForSession() when switching sessions
   */
  sessionTodos: Todo[];

  /**
   * Actions
   */
  addTodo: (todo: Todo) => void;
  updateTodo: (todoId: string, updates: Partial<Todo>) => void;
  removeTodo: (todoId: string) => void;
  setTodosForSession: (sessionId: string) => void;
  clearSessionTodos: () => void;
  reset: () => void;

  /**
   * Computed getters for session todos
   */
  getPendingTodos: () => Todo[];
  getInProgressTodos: () => Todo[];
  getCompletedTodos: () => Todo[];
  getTodosBySession: (sessionId: string) => Todo[];
}

/**
 * Todo store for managing task lists from agent TodoWrite tool
 *
 * Listens to WebSocket agent:event (type: tool_result, toolName: 'TodoWrite')
 * and updates todos accordingly. Integrates with useAgentEvents hook.
 */
export const useTodoStore = create<TodoState>((set, get) => ({
  // Initial state
  todos: [],
  sessionTodos: [],

  // Add or update todo (from WebSocket event)
  addTodo: (todo: Todo) => {
    set((state) => {
      const exists = state.todos.find((t) => t.id === todo.id);
      if (exists) {
        // Update existing todo
        return {
          todos: state.todos.map((t) => (t.id === todo.id ? todo : t)),
          sessionTodos: state.sessionTodos.map((t) => (t.id === todo.id ? todo : t)),
        };
      }
      // Add new todo
      return {
        todos: [...state.todos, todo],
        // Add to sessionTodos only if it matches current session
        sessionTodos: [...state.sessionTodos, todo],
      };
    });
  },

  // Update todo (status changes, etc.)
  updateTodo: (todoId: string, updates: Partial<Todo>) => {
    set((state) => ({
      todos: state.todos.map((t) => (t.id === todoId ? { ...t, ...updates } : t)),
      sessionTodos: state.sessionTodos.map((t) => (t.id === todoId ? { ...t, ...updates } : t)),
    }));
  },

  // Remove todo
  removeTodo: (todoId: string) => {
    set((state) => ({
      todos: state.todos.filter((t) => t.id !== todoId),
      sessionTodos: state.sessionTodos.filter((t) => t.id !== todoId),
    }));
  },

  // Set todos for current session (call when switching sessions)
  setTodosForSession: (sessionId: string) => {
    set((state) => ({
      sessionTodos: state.todos.filter((t) => t.sessionId === sessionId),
    }));
  },

  // Clear session todos (when switching away from session)
  clearSessionTodos: () => {
    set({ sessionTodos: [] });
  },

  // Reset store (on logout)
  reset: () => {
    set({
      todos: [],
      sessionTodos: [],
    });
  },

  // Get pending todos for current session
  getPendingTodos: () => {
    return get().sessionTodos.filter((t) => t.status === "pending");
  },

  // Get in-progress todos for current session
  getInProgressTodos: () => {
    return get().sessionTodos.filter((t) => t.status === "in_progress");
  },

  // Get completed todos for current session
  getCompletedTodos: () => {
    return get().sessionTodos.filter((t) => t.status === "completed");
  },

  // Get all todos for a specific session
  getTodosBySession: (sessionId: string) => {
    return get().todos.filter((t) => t.sessionId === sessionId);
  },
}));
