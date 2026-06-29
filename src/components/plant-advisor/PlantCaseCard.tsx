import React from 'react';
import { useTranslation } from 'react-i18next';
import { Leaf, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import type { PlantCase } from '@/hooks/usePlantCases';

interface Props {
  plantCase: PlantCase;
  onOpen: () => void;
  onDelete: () => void;
}

export function PlantCaseCard({ plantCase, onOpen, onDelete }: Props) {
  const { t } = useTranslation();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      className="group relative rounded-lg border border-border bg-card p-4 cursor-pointer hover:border-primary/40 hover:shadow-sm transition"
    >
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
          <Leaf className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-sm truncate">{plantCase.title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {formatDistanceToNow(new Date(plantCase.created_at), { addSuffix: true })}
          </p>
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <Badge variant="secondary" className="text-[10px]">{t(`plantAdvisor.statuses.${plantCase.status}`)}</Badge>
            {plantCase.user_goal && (
              <Badge variant="outline" className="text-[10px]">{t(`plantAdvisor.goals.${plantCase.user_goal}`)}</Badge>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
