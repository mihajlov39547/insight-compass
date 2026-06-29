import React, { useState } from 'react';
import { PlantAdvisorDashboard } from './PlantAdvisorDashboard';
import { PlantCaseForm } from './PlantCaseForm';
import { PlantCaseDetail } from './PlantCaseDetail';
import { PlantCaseChatPanel } from './PlantCaseChatPanel';
import { usePlantCase, type PlantCase } from '@/hooks/usePlantCases';

type Mode =
  | { kind: 'dashboard' }
  | { kind: 'new' }
  | { kind: 'detail'; caseId: string }
  | { kind: 'edit'; caseId: string }
  | { kind: 'chat'; caseId: string };

export function PlantAdvisorView() {
  const [mode, setMode] = useState<Mode>({ kind: 'dashboard' });
  const activeId = mode.kind !== 'dashboard' && mode.kind !== 'new' ? mode.caseId : null;
  const { data: activeCase } = usePlantCase(activeId);

  if (mode.kind === 'new') {
    return (
      <div className="flex-1 overflow-auto">
        <PlantCaseForm
          onSaved={(c) => setMode({ kind: 'detail', caseId: c.id })}
          onCancel={() => setMode({ kind: 'dashboard' })}
        />
      </div>
    );
  }

  if (mode.kind === 'edit' && activeCase) {
    return (
      <div className="flex-1 overflow-auto">
        <PlantCaseForm
          initial={activeCase}
          onSaved={(c) => setMode({ kind: 'detail', caseId: c.id })}
          onCancel={() => setMode({ kind: 'detail', caseId: activeCase.id })}
        />
      </div>
    );
  }

  if (mode.kind === 'detail' && activeCase) {
    return (
      <div className="flex-1 overflow-auto">
        <PlantCaseDetail
          plantCase={activeCase}
          onBack={() => setMode({ kind: 'dashboard' })}
          onEdit={() => setMode({ kind: 'edit', caseId: activeCase.id })}
          onOpenChat={() => setMode({ kind: 'chat', caseId: activeCase.id })}
          onDeleted={() => setMode({ kind: 'dashboard' })}
        />
      </div>
    );
  }

  if (mode.kind === 'chat' && activeCase) {
    return (
      <PlantCaseChatPanel
        plantCase={activeCase}
        onBack={() => setMode({ kind: 'detail', caseId: activeCase.id })}
      />
    );
  }

  return (
    <PlantAdvisorDashboard
      onNewScan={() => setMode({ kind: 'new' })}
      onOpenCase={(c) => setMode({ kind: 'detail', caseId: c.id })}
    />
  );
}
