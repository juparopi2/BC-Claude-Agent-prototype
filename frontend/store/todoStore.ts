import { create } from 'zustand';
import type { Todo } from '@/lib/types';

interface TodoState {
  // Todos
  todos: Todo[];
  sessionTodos: Todo[]; // Todos for current session
  isLoading: boolean;
  error: string | null;

  // Actions
  addTodo: (todo: Todo) => void;
  updateTodo: (todoId: string, updates: Partial<Todo>) => void;
  removeTodo: (todoId: string) => void;
  setTodosForSession: (sessionId: string) => void;
  clearSessionTodos: () => void;
  clearError: () => void;
  reset: () => void;

  // Computed getters
  getPendingTodos: () => Todo[];
  getInProgressTodos: () => Todo[];
  getCompletedTodos: () => Todo[];
  getTodosBySession: (sessionId: string) => Todo[];
}

export const useTodoStore = create<TodoState>((set, get) => ({
  // Initial state
  todos: [],
  sessionTodos: [],
  isLoading: false,
  error: null,

  // Add todo (from WebSocket event)
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
        // Add to sessionTodos only if it's for the current session
        sessionTodos: [...state.sessionTodos, todo],
      };
    });
  },

  // Update todo (status changes, etc.)
  updateTodo: (todoId: string, updates: Partial<Todo>) => {
    set((state) => ({
      todos: state.todos.map((t) =>
        t.id === todoId ? { ...t, ...updates } : t
      ),
      sessionTodos: state.sessionTodos.map((t) =>
        t.id === todoId ? { ...t, ...updates } : t
      ),
    }));
  },

  // Remove todo
  removeTodo: (todoId: string) => {
    set((state) => ({
      todos: state.todos.filter((t) => t.id !== todoId),
      sessionTodos: state.sessionTodos.filter((t) => t.id !== todoId),
    }));
  },

  // Set todos for current session
  setTodosForSession: (sessionId: string) => {
    set((state) => ({
      sessionTodos: state.todos.filter((t) => t.sessionId === sessionId),
    }));
  },

  // Clear session todos (when switching sessions)
  clearSessionTodos: () => {
    set({ sessionTodos: [] });
  },

  // Clear error
  clearError: () => set({ error: null }),

  // Reset store
  reset: () => {
    set({
      todos: [],
      sessionTodos: [],
      isLoading: false,
      error: null,
    });
  },

  // Get pending todos
  getPendingTodos: () => {
    return get().sessionTodos.filter((t) => t.status === 'pending');
  },

  // Get in-progress todos
  getInProgressTodos: () => {
    return get().sessionTodos.filter((t) => t.status === 'in_progress');
  },

  // Get completed todos
  getCompletedTodos: () => {
    return get().sessionTodos.filter((t) => t.status === 'completed');
  },

  // Get todos by session ID
  getTodosBySession: (sessionId: string) => {
    return get().todos.filter((t) => t.sessionId === sessionId);
  },
}));
