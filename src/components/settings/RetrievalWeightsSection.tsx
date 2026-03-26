import React, { useCallback } from 'react';
import { HelpCircle, RotateCcw } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface WeightValues {
  retrieval_chunk_weight: number;
  retrieval_question_weight: number;
  retrieval_keyword_weight: number;
}

interface Props {
  values: WeightValues;
  onChange: (values: WeightValues) => void;
}

const DEFAULTS = { retrieval_chunk_weight: 0.50, retrieval_question_weight: 0.30, retrieval_keyword_weight: 0.20 };

const WEIGHT_KEYS: (keyof WeightValues)[] = [
  'retrieval_chunk_weight',
  'retrieval_question_weight',
  'retrieval_keyword_weight',
];

const LABELS: Record<keyof WeightValues, string> = {
  retrieval_chunk_weight: 'Semantic chunk weight',
  retrieval_question_weight: 'Semantic question weight',
  retrieval_keyword_weight: 'Keyword weight',
};

const TOOLTIPS: Record<keyof WeightValues, string> = {
  retrieval_chunk_weight: 'Higher values favor direct semantic matches to actual document text.',
  retrieval_question_weight: 'Higher values favor matching against AI-generated questions associated with chunks.',
  retrieval_keyword_weight: 'Higher values favor exact wording and keyword matches.',
};

function toPercent(v: number) {
  return Math.round(v * 100);
}

export function RetrievalWeightsSection({ values, onChange }: Props) {
  const handleChange = useCallback(
    (key: keyof WeightValues, newPercent: number) => {
      const otherKeys = WEIGHT_KEYS.filter(k => k !== key);
      const total = 100;
      const clamped = Math.max(0, Math.min(100, newPercent));
      const remaining = total - clamped;

      const otherSum = otherKeys.reduce((s, k) => s + toPercent(values[k]), 0);

      let newValues: WeightValues;
      if (otherSum === 0) {
        // Distribute remaining equally
        const half = Math.floor(remaining / 2);
        newValues = {
          ...values,
          [key]: clamped / 100,
          [otherKeys[0]]: half / 100,
          [otherKeys[1]]: (remaining - half) / 100,
        };
      } else {
        // Proportionally rebalance others
        const ratio = remaining / otherSum;
        let assigned = 0;
        const result = { ...values, [key]: clamped / 100 };
        // Assign first other key proportionally, second gets remainder
        const first = Math.round(toPercent(values[otherKeys[0]]) * ratio);
        result[otherKeys[0]] = first / 100;
        assigned += first;
        result[otherKeys[1]] = (remaining - assigned) / 100;
        // Clamp to avoid negatives from rounding
        if (result[otherKeys[1]] < 0) {
          result[otherKeys[1]] = 0;
          result[otherKeys[0]] = remaining / 100;
        }
        newValues = result;
      }
      onChange(newValues);
    },
    [values, onChange]
  );

  const isDefault =
    toPercent(values.retrieval_chunk_weight) === 50 &&
    toPercent(values.retrieval_question_weight) === 30 &&
    toPercent(values.retrieval_keyword_weight) === 20;

  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Label className="text-sm font-medium">Retrieval Weights</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[260px] text-xs leading-relaxed">
                Control how search results are scored. The three weights always combine to 100%.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {!isDefault && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={() => onChange({ ...DEFAULTS })}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset to defaults
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground -mt-1">
        Adjust how much each signal contributes to search ranking. Total must equal 100%.
      </p>

      <div className="space-y-4">
        {WEIGHT_KEYS.map(key => (
          <WeightSlider
            key={key}
            label={LABELS[key]}
            tooltip={TOOLTIPS[key]}
            value={toPercent(values[key])}
            onChange={v => handleChange(key, v)}
          />
        ))}
      </div>

      <div className="flex justify-end">
        <span className="text-xs text-muted-foreground tabular-nums">
          Total: {toPercent(values.retrieval_chunk_weight) + toPercent(values.retrieval_question_weight) + toPercent(values.retrieval_keyword_weight)}%
        </span>
      </div>
    </div>
  );
}

function WeightSlider({
  label,
  tooltip,
  value,
  onChange,
}: {
  label: string;
  tooltip: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Label className="text-xs">{label}</Label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[220px] text-xs">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <span className="text-xs font-medium tabular-nums w-10 text-right">{value}%</span>
      </div>
      <Slider
        min={0}
        max={100}
        step={5}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
      />
    </div>
  );
}
