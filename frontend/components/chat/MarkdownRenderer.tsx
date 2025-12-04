'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const { theme } = useTheme();

  const components: Components = {
    // Headings with distinct sizes
    h1: ({ children }) => (
      <h1 className="text-4xl font-extrabold text-foreground">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-3xl font-bold text-foreground">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-2xl font-semibold text-foreground">{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 className="text-xl font-semibold text-foreground">{children}</h4>
    ),
    h5: ({ children }) => (
      <h5 className="text-lg font-medium text-foreground">{children}</h5>
    ),
    h6: ({ children }) => (
      <h6 className="text-base font-medium text-foreground">{children}</h6>
    ),

    // Paragraphs
    p: ({ children }) => (
      <p className="text-sm leading-7">{children}</p>
    ),

    // Lists with bullets/numbers
    ul: ({ children }) => (
      <ul className="my-2 ml-4 list-disc space-y-2 text-sm">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 ml-4 list-decimal space-y-2 text-sm">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="text-foreground">{children}</li>
    ),

    // Blockquotes
    blockquote: ({ children }) => (
      <blockquote className="my-4 border-l-4 border-border pl-4 italic text-muted-foreground">
        {children}
      </blockquote>
    ),

    // Tables
    table: ({ children }) => (
      <div className="my-4 overflow-x-auto">
        <table className="min-w-full border-collapse border border-border">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="bg-muted">{children}</thead>
    ),
    tbody: ({ children }) => (
      <tbody>{children}</tbody>
    ),
    tr: ({ children }) => (
      <tr className="border-b border-border">{children}</tr>
    ),
    th: ({ children }) => (
      <th className="px-4 py-2 text-left font-semibold border border-border">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-4 py-2 border border-border">{children}</td>
    ),

    // Text formatting
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }) => (
      <em className="italic text-foreground">{children}</em>
    ),

    // Horizontal rule
    hr: () => (
      <hr className="my-8 border-t border-border" />
    ),

    // Links
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-primary underline hover:text-primary/80 transition-colors"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    ),

    // Code (keep existing code renderer but update styling)
    code(props) {
      const { node, className, children, ...rest } = props;
      const match = /language-(\w+)/.exec(className || '');
      const isCodeBlock = match && String(children).includes('\n');

      return isCodeBlock ? (
        <SyntaxHighlighter
          style={theme === 'dark' ? oneDark : oneLight}
          language={match[1]}
          PreTag="div"
          customStyle={{
            margin: '1rem 0',
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
          }}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      ) : (
        <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono font-semibold text-foreground" {...rest}>
          {children}
        </code>
      );
    },
  };

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
