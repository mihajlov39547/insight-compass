import React from 'react';
import {
  Bold, Italic, Heading1, Heading2, Heading3, List, ListOrdered, Code, Type,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface NoteFormatToolbarProps {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
}

type FormatAction = {
  icon: React.ElementType;
  label: string;
  action: (ta: HTMLTextAreaElement, value: string) => string;
};

function wrapSelection(ta: HTMLTextAreaElement, value: string, before: string, after: string): string {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = value.slice(start, end);
  const replacement = selected ? `${before}${selected}${after}` : `${before}text${after}`;
  const result = value.slice(0, start) + replacement + value.slice(end);
  // Schedule cursor positioning
  setTimeout(() => {
    if (selected) {
      ta.selectionStart = start + before.length;
      ta.selectionEnd = start + before.length + selected.length;
    } else {
      ta.selectionStart = start + before.length;
      ta.selectionEnd = start + before.length + 4; // select "text"
    }
    ta.focus();
  }, 0);
  return result;
}

function prefixLine(ta: HTMLTextAreaElement, value: string, prefix: string): string {
  const start = ta.selectionStart;
  // Find line start
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const result = value.slice(0, lineStart) + prefix + value.slice(lineStart);
  setTimeout(() => {
    ta.selectionStart = ta.selectionEnd = start + prefix.length;
    ta.focus();
  }, 0);
  return result;
}

function insertList(ta: HTMLTextAreaElement, value: string, ordered: boolean): string {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = value.slice(start, end);
  const lines = selected ? selected.split('\n') : ['Item 1', 'Item 2'];
  const formatted = lines
    .map((line, i) => (ordered ? `${i + 1}. ${line}` : `- ${line}`))
    .join('\n');
  const needsNewlineBefore = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
  const result = value.slice(0, start) + needsNewlineBefore + formatted + value.slice(end);
  setTimeout(() => {
    ta.selectionStart = start + needsNewlineBefore.length;
    ta.selectionEnd = start + needsNewlineBefore.length + formatted.length;
    ta.focus();
  }, 0);
  return result;
}

const actions: FormatAction[] = [
  { icon: Type, label: 'Normal text', action: (ta, v) => v },
  { icon: Heading1, label: 'Heading 1', action: (ta, v) => prefixLine(ta, v, '# ') },
  { icon: Heading2, label: 'Heading 2', action: (ta, v) => prefixLine(ta, v, '## ') },
  { icon: Heading3, label: 'Heading 3', action: (ta, v) => prefixLine(ta, v, '### ') },
];

const inlineActions: FormatAction[] = [
  { icon: Bold, label: 'Bold', action: (ta, v) => wrapSelection(ta, v, '**', '**') },
  { icon: Italic, label: 'Italic', action: (ta, v) => wrapSelection(ta, v, '*', '*') },
  { icon: Code, label: 'Inline code', action: (ta, v) => wrapSelection(ta, v, '`', '`') },
];

const listActions: FormatAction[] = [
  { icon: List, label: 'Bullet list', action: (ta, v) => insertList(ta, v, false) },
  { icon: ListOrdered, label: 'Numbered list', action: (ta, v) => insertList(ta, v, true) },
];

export function NoteFormatToolbar({ textareaRef, value, onChange }: NoteFormatToolbarProps) {
  const handleAction = (action: FormatAction['action']) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const newValue = action(ta, value);
    if (newValue !== value) {
      onChange(newValue);
    }
  };

  const ToolbarButton = ({ item }: { item: FormatAction }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => handleAction(item.action)}
        >
          <item.icon className="h-3.5 w-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">{item.label}</TooltipContent>
    </Tooltip>
  );

  return (
    <div className="flex items-center gap-0.5 px-1 py-1 rounded-md border border-border bg-muted/30">
      {actions.map((item) => (
        <ToolbarButton key={item.label} item={item} />
      ))}
      <Separator orientation="vertical" className="mx-1 h-5" />
      {inlineActions.map((item) => (
        <ToolbarButton key={item.label} item={item} />
      ))}
      <Separator orientation="vertical" className="mx-1 h-5" />
      {listActions.map((item) => (
        <ToolbarButton key={item.label} item={item} />
      ))}
    </div>
  );
}
