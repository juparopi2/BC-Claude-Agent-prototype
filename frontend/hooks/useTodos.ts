/**
 * useTodos Hook
 *
 * Integrates todo store and WebSocket events for real-time task tracking.
 * Listens to agent:event (tool_result with toolName='TodoWrite') and manages todo state.
 *
 * Migration note: Replaces deprecated store and socket imports with:
 * - stores/todo.ts for todo state
 * - contexts/websocket.tsx for WebSocket events
 * - types/api.ts for Todo type
 */

import { useEffect, useCallback } from "react";
import { useTodoStore } from "@/stores/todo";
import { useWebSocket } from "@/contexts/websocket";
import type { Todo } from "@/types/api";

interface TodoCreatedEventData {
  sessionId: string;
  todos: Todo[];
}

interface TodoEventData {
  todo: Todo;
}

/**
 * Todo tracking hook
 *
 * Manages todo list for the current session and listens to WebSocket events.
 * Integrates with agent:event (tool_result) to track TodoWrite tool executions.
 *
 * @param sessionId - Optional session ID to filter todos
 * @returns Todo state and actions
 */
export function useTodos(sessionId?: string) {
  const { socket, isConnected } = useWebSocket();

  const {
    todos,
    sessionTodos,
    addTodo,
    updateTodo,
    removeTodo,
    setTodosForSession,
    clearSessionTodos,
    getPendingTodos,
    getInProgressTodos,
    getCompletedTodos,
  } = useTodoStore();

  // Set todos for current session when sessionId changes
  useEffect(() => {
    if (sessionId) {
      setTodosForSession(sessionId);
    } else {
      clearSessionTodos();
    }
  }, [sessionId, setTodosForSession, clearSessionTodos]);

  // Set up WebSocket event listeners
  useEffect(() => {
    if (!socket || !isConnected) return;

    // Handler: Todo created (when new todos are generated from plan)
    const handleTodoCreated = (data: TodoCreatedEventData) => {
      console.log("[useTodos] Todos created:", data.todos.length, "todos for session", data.sessionId);

      // Only add todos for current session if sessionId is specified
      if (!sessionId || data.sessionId === sessionId) {
        data.todos.forEach((todo: Todo) => addTodo(todo));
      }
    };

    // Handler: Todo updated (status changed)
    const handleTodoUpdated = (data: TodoEventData) => {
      console.log("[useTodos] Todo updated:", data.todo.id, data.todo.status);

      // Only add/update todos for current session if sessionId is specified
      if (!sessionId || data.todo.sessionId === sessionId) {
        addTodo(data.todo);
      }
    };

    // Handler: Todo completed
    const handleTodoCompleted = (data: TodoEventData) => {
      console.log("[useTodos] Todo completed:", data.todo.id);

      // Update todo status
      if (!sessionId || data.todo.sessionId === sessionId) {
        updateTodo(data.todo.id, {
          status: "completed",
          completed_at: new Date().toISOString(),
        });
      }
    };

    // Register listeners
    socket.on("todo:created", handleTodoCreated);
    socket.on("todo:updated", handleTodoUpdated);
    socket.on("todo:completed", handleTodoCompleted);

    // Cleanup listeners
    return () => {
      socket.off("todo:created", handleTodoCreated);
      socket.off("todo:updated", handleTodoUpdated);
      socket.off("todo:completed", handleTodoCompleted);
    };
  }, [socket, isConnected, sessionId, addTodo, updateTodo]);

  // Mark todo as in progress
  const markInProgress = useCallback(
    (todoId: string) => {
      updateTodo(todoId, { status: "in_progress" });
    },
    [updateTodo]
  );

  // Mark todo as completed
  const markCompleted = useCallback(
    (todoId: string) => {
      updateTodo(todoId, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });
    },
    [updateTodo]
  );

  // Get progress percentage
  const getProgress = useCallback(() => {
    if (sessionTodos.length === 0) return 0;

    const completed = getCompletedTodos().length;
    return Math.round((completed / sessionTodos.length) * 100);
  }, [sessionTodos, getCompletedTodos]);

  return {
    // State
    todos: sessionTodos, // Return session-specific todos
    allTodos: todos, // All todos across all sessions
    isLoading: false, // No loading state for local store
    error: null, // No error state for local store
    isConnected,

    // Filtered todos
    pendingTodos: getPendingTodos(),
    inProgressTodos: getInProgressTodos(),
    completedTodos: getCompletedTodos(),

    // Actions
    markInProgress,
    markCompleted,
    removeTodo,
    clearError: () => {}, // No-op for local store

    // Computed
    totalCount: sessionTodos.length,
    pendingCount: getPendingTodos().length,
    inProgressCount: getInProgressTodos().length,
    completedCount: getCompletedTodos().length,
    progress: getProgress(),
    hasActiveTodos: sessionTodos.some((t: Todo) => t.status !== "completed"),
  };
}
