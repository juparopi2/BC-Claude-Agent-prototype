import { useEffect, useCallback } from 'react';
import { useTodoStore, type Todo } from '@/store';
import { useSocket } from './useSocket';
import { socketTodoApi, SocketEvent, type TodoEventData } from '@/lib/socket';

/**
 * Hook for todo tracking
 * Integrates with todoStore and WebSocket for real-time todo updates
 */
export function useTodos(sessionId?: string) {
  const { socket, isConnected } = useSocket();

  const {
    todos,
    sessionTodos,
    isLoading,
    error,
    addTodo,
    updateTodo,
    removeTodo,
    setTodosForSession,
    clearSessionTodos,
    clearError,
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

    // Todo updated (created or status changed)
    const handleTodoUpdated = (data: TodoEventData) => {
      console.log('[useTodos] Todo updated:', data.todo.id, data.todo.status);

      // Only add/update todos for current session if sessionId is specified
      if (!sessionId || data.todo.sessionId === sessionId) {
        addTodo(data.todo);
      }
    };

    // Todo completed
    const handleTodoCompleted = (data: TodoEventData) => {
      console.log('[useTodos] Todo completed:', data.todo.id);

      // Update todo status
      if (!sessionId || data.todo.sessionId === sessionId) {
        updateTodo(data.todo.id, {
          status: 'completed',
          completed_at: new Date().toISOString(),
        });
      }
    };

    // Register listeners
    socketTodoApi.onTodoUpdated(handleTodoUpdated);
    socketTodoApi.onTodoCompleted(handleTodoCompleted);

    // Cleanup listeners
    return () => {
      socket.off(SocketEvent.TODO_UPDATED, handleTodoUpdated);
      socket.off(SocketEvent.TODO_COMPLETED, handleTodoCompleted);
    };
  }, [socket, isConnected, sessionId, addTodo, updateTodo]);

  // Mark todo as in progress
  const markInProgress = useCallback(
    (todoId: string) => {
      updateTodo(todoId, { status: 'in_progress' });
    },
    [updateTodo]
  );

  // Mark todo as completed
  const markCompleted = useCallback(
    (todoId: string) => {
      updateTodo(todoId, {
        status: 'completed',
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
    isLoading,
    error,
    isConnected,

    // Filtered todos
    pendingTodos: getPendingTodos(),
    inProgressTodos: getInProgressTodos(),
    completedTodos: getCompletedTodos(),

    // Actions
    markInProgress,
    markCompleted,
    removeTodo,
    clearError,

    // Computed
    totalCount: sessionTodos.length,
    pendingCount: getPendingTodos().length,
    inProgressCount: getInProgressTodos().length,
    completedCount: getCompletedTodos().length,
    progress: getProgress(),
    hasActiveTodos: sessionTodos.some((t) => t.status !== 'completed'),
  };
}
