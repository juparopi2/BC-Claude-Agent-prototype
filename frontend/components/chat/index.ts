// Local components (still in components/chat/)
export { default as ChatContainer } from './ChatContainer';
export { default as ChatInput } from './ChatInput';

// Re-export from presentation layer for backward compatibility
export {
  MessageBubble,
  ThinkingBlock,
  ThinkingDisplay, // Legacy alias
  ToolCard,
  MarkdownRenderer,
  CitationLink,
  FileAttachmentChip,
  AttachmentList,
  InputOptionsBar,
} from '@/src/presentation/chat';
