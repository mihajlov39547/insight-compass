import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { cn } from '@/lib/utils';
import { sanitizeAssistantAnswerForDisplay } from '@/lib/ai/sanitizeAnswer';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

function canInlineImage(src?: string): boolean {
  if (!src) return false;
  if (src.startsWith('data:') || src.startsWith('blob:')) return true;
  try {
    const url = new URL(src, window.location.origin);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

export function MarkdownContent({ content, className }: MarkdownContentProps) {
  const sanitized = sanitizeAssistantAnswerForDisplay(content);
  return (
    <div className={cn("prose-chat text-sm leading-relaxed break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          h1: ({ children }) => <h3 className="text-base font-semibold mt-4 mb-2 first:mt-0 tracking-tight">{children}</h3>,
          h2: ({ children }) => <h4 className="text-sm font-semibold mt-3 mb-1.5 first:mt-0 tracking-tight">{children}</h4>,
          h3: ({ children }) => <h5 className="text-sm font-semibold mt-2.5 mb-1 first:mt-0">{children}</h5>,
          h4: ({ children }) => <h6 className="text-sm font-medium mt-2 mb-1 first:mt-0">{children}</h6>,
          p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => <del className="line-through text-muted-foreground">{children}</del>,
          ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1 marker:text-muted-foreground">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1 marker:text-muted-foreground">{children}</ol>,
          li: ({ children, ...props }) => {
            // Task list items (GFM) come with a checkbox child
            const checked = (props as { checked?: boolean | null }).checked;
            if (checked === true || checked === false) {
              return (
                <li className="text-sm list-none -ml-5 flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    readOnly
                    className="mt-1 h-3.5 w-3.5 rounded border-border accent-accent"
                  />
                  <span>{children}</span>
                </li>
              );
            }
            return <li className="text-sm leading-relaxed">{children}</li>;
          },
          code: ({ className: codeClassName, children, ...props }) => {
            const isInline = !codeClassName;
            if (isInline) {
              return (
                <code className="bg-muted px-1.5 py-0.5 rounded text-[0.8125rem] font-mono text-foreground border border-border/50">{children}</code>
              );
            }
            const lang = codeClassName?.replace(/^language-/, '') ?? '';
            return (
              <div className="relative my-2 rounded-md border border-border bg-muted/60 overflow-hidden">
                {lang && (
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/80 border-b border-border/60 font-mono">
                    {lang}
                  </div>
                )}
                <pre className="p-3 overflow-x-auto text-xs leading-relaxed">
                  <code className="font-mono text-foreground" {...props}>{children}</code>
                </pre>
              </div>
            );
          },
          pre: ({ children }) => <>{children}</>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-accent pl-3 my-2 text-muted-foreground italic">{children}</blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-primary/80 break-all">{children}</a>
          ),
          hr: () => <hr className="my-3 border-border" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 rounded-md border border-border">
              <table className="text-xs border-collapse w-full">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
          tr: ({ children }) => <tr className="even:bg-muted/20">{children}</tr>,
          th: ({ children, style }) => (
            <th
              className="px-2.5 py-1.5 font-semibold text-left text-foreground border-b border-border whitespace-nowrap"
              style={style}
            >
              {children}
            </th>
          ),
          td: ({ children, style }) => (
            <td className="px-2.5 py-1.5 align-top" style={style}>
              {children}
            </td>
          ),
          img: ({ src, alt }) => {
            if (!canInlineImage(src)) {
              return (
                <a
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2 hover:text-primary/80 break-all"
                >
                  {alt || 'Open image'}
                </a>
              );
            }
            return (
              <img
                src={src}
                alt={alt ?? ''}
                className="my-2 max-w-full h-auto rounded-md border border-border"
                loading="lazy"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            );
          },
        }}
      >
        {sanitized}
      </ReactMarkdown>
    </div>
  );
}
