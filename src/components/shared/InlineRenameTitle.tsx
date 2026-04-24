import React, { useState, useRef, useEffect } from 'react';
import { Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface InlineRenameTitleProps {
  value: string;
  onSave: (newName: string) => Promise<void> | void;
  className?: string;
  inputClassName?: string;
  iconSize?: number;
  as?: 'h1' | 'h2' | 'h3';
}

export function InlineRenameTitle({
  value,
  onSave,
  className,
  inputClassName,
  iconSize = 14,
  as: Tag = 'h2',
}: InlineRenameTitleProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Sync external value changes
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      cancel();
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
      setEditing(false);
    } catch {
      setDraft(value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      cancel();
    }
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        disabled={saving}
        className={cn(
          'h-auto py-0.5 px-1.5 border-accent bg-transparent focus-visible:ring-1',
          inputClassName,
          className
        )}
        maxLength={200}
      />
    );
  }

  return (
    <div className="group flex items-center gap-1.5 min-w-0">
      <Tag className={cn('truncate', className)}>{value}</Tag>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
        onClick={startEdit}
        aria-label={t('inlineRename.rename')}
      >
        <Pencil style={{ width: iconSize, height: iconSize }} />
      </Button>
    </div>
  );
}
