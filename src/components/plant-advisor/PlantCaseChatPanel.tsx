import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MessageSquare, Send, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { MarkdownContent } from '@/components/chat/MarkdownContent';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { usePlantCaseImages } from '@/hooks/usePlantCaseImages';
import { usePlantIdentifications, confidenceBucket } from '@/hooks/usePlantIdentifications';
import { usePlantDiagnoses, usePlantDiagnosisInterpretations } from '@/hooks/usePlantDiagnoses';
import type { PlantCase } from '@/hooks/usePlantCases';

interface Props {
  plantCase: PlantCase;
  onBack: () => void;
}

interface Msg { role: 'user' | 'assistant'; content: string }

export function PlantCaseChatPanel({ plantCase, onBack }: Props) {
  const { t, i18n } = useTranslation();
  const { data: images = [] } = usePlantCaseImages(plantCase.id);
  const { data: idents = [] } = usePlantIdentifications(plantCase.id);
  const { data: diagnoses = [] } = usePlantDiagnoses(plantCase.id);
  const { data: interpretation } = usePlantDiagnosisInterpretations(plantCase.id);

  const confirmedIdent = idents.find((i) => i.is_confirmed) || null;
  const topIdent = confirmedIdent || idents[0] || null;
  const alts = idents.filter((i) => i.id !== topIdent?.id).slice(0, 4);
  const identBucket = confidenceBucket(topIdent?.score ?? null);

  const confirmedDiag = diagnoses.find((d) => d.is_confirmed) || null;
  const topDiag = confirmedDiag || diagnoses[0] || null;
  const diagBucket = confidenceBucket(topDiag?.score ?? null);

  const goal = plantCase.user_goal;
  const isDiagnose = goal === 'diagnose';

  const aiBest = interpretation?.interpretation?.bestCandidates?.[0] ?? null;
  const aiVsConfirmedMismatch =
    !!confirmedDiag && !!aiBest && aiBest.name && confirmedDiag.name &&
    aiBest.name.trim().toLowerCase() !== confirmedDiag.name.trim().toLowerCase();

  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(() => ([
    {
      role: 'assistant',
      content: t('plantAdvisor.chat.intro', {
        title: plantCase.title,
        defaultValue:
          'I have your plant case "{{title}}" loaded, including identification, disease candidates, and any AI interpretation. Ask me anything about it. I do not directly inspect your photos — I rely on case context, provider results, and notes.',
      }),
    },
  ]));

  const quickQuestions = useMemo<string[]>(() => {
    if (!isDiagnose) {
      return [
        t('plantAdvisor.chat.qq.identifyWhyUncertain', { defaultValue: 'Why is this identification uncertain?' }),
        t('plantAdvisor.chat.qq.identifyPhotosToImprove', { defaultValue: 'What should I photograph to improve identification?' }),
        t('plantAdvisor.chat.qq.identifyExplainAlternatives', { defaultValue: 'Explain the top alternatives.' }),
      ];
    }
    if (confirmedDiag) {
      return [
        t('plantAdvisor.chat.qq.explainConfirmed', { defaultValue: 'Explain the confirmed diagnosis.' }),
        t('plantAdvisor.chat.qq.evidenceSupports', { defaultValue: 'What evidence supports this diagnosis?' }),
        t('plantAdvisor.chat.qq.monitorNext', { defaultValue: 'What should I monitor next?' }),
      ];
    }
    if (diagnoses.length > 0) {
      return [
        t('plantAdvisor.chat.qq.aiPreferred', { defaultValue: 'Why did AI prefer this candidate?' }),
        t('plantAdvisor.chat.qq.checkVisually', { defaultValue: 'What should I check visually next?' }),
        t('plantAdvisor.chat.qq.unlikelyCandidates', { defaultValue: 'Which candidates seem unlikely and why?' }),
        t('plantAdvisor.chat.qq.extraPhotos', { defaultValue: 'What extra photos would improve confidence?' }),
      ];
    }
    return [
      t('plantAdvisor.chat.qq.uploadForDiagnosis', { defaultValue: 'What images should I upload for diagnosis?' }),
      t('plantAdvisor.chat.qq.whyConfirmPlant', { defaultValue: 'Why do I need to confirm the plant first?' }),
    ];
  }, [t, isDiagnose, confirmedDiag, diagnoses.length]);

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || pending) return;
    setInput('');
    const nextMsgs: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMsgs);
    setPending(true);
    try {
      const langCode = (i18n.language || 'en').toLowerCase().startsWith('sr') ? 'sr' : 'en';
      const { data, error } = await supabase.functions.invoke('plant-case-chat', {
        body: {
          caseId: plantCase.id,
          lang: langCode,
          messages: nextMsgs.map((m) => ({ role: m.role, content: m.content })),
        },
      });
      if (error) {
        const ctx: any = (error as any).context;
        let code: string | undefined;
        try {
          const b = ctx && typeof ctx.json === 'function' ? await ctx.json() : null;
          code = b?.error;
        } catch { /* ignore */ }
        throw new Error(code || error.message || 'chat_failed');
      }
      const reply = (data as any)?.reply;
      if (typeof reply !== 'string' || !reply.trim()) throw new Error('empty_reply');
      setMessages([...nextMsgs, { role: 'assistant', content: reply }]);
    } catch (e) {
      const msg = (e as Error).message;
      toast.error(
        t(`plantAdvisor.chat.errors.${msg}`, {
          defaultValue: t('plantAdvisor.chat.errors.generic', { defaultValue: 'Chat failed. Please try again.' }),
        }),
      );
    } finally {
      setPending(false);
    }
  };

  const confidenceLabel = (b: 'high' | 'medium' | 'low' | null | undefined) =>
    b ? t(`plantAdvisor.identify.confidence.${b}`) : null;

  const identChip =
    confirmedIdent
      ? confirmedIdent.common_name || confirmedIdent.scientific_name_without_author || confirmedIdent.scientific_name
      : topIdent
      ? topIdent.common_name || topIdent.scientific_name_without_author || topIdent.scientific_name
      : null;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-4 py-3 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <MessageSquare className="h-4 w-4 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{plantCase.title}</div>
          <div className="text-xs text-muted-foreground">{t('plantAdvisor.chat.title')}</div>
        </div>
      </div>

      {/* Context chips */}
      <div className="border-b border-border px-4 py-2 flex flex-wrap gap-1.5 bg-muted/20">
        {identChip && (
          <Badge variant={confirmedIdent ? 'default' : 'secondary'} className="text-xs">
            {identChip}
          </Badge>
        )}
        {isDiagnose && confirmedDiag && (
          <Badge variant="default" className="text-xs">
            {t('plantAdvisor.diagnose.confirmedShort', { defaultValue: 'Confirmed' })}: {confirmedDiag.name || '—'}
          </Badge>
        )}
        {isDiagnose && !confirmedDiag && topDiag && (
          <Badge variant="outline" className="text-xs">
            {t('plantAdvisor.diagnose.candidateShort', { defaultValue: 'Candidate' })}: {topDiag.name || '—'}
            {diagBucket ? ` · ${confidenceLabel(diagBucket)}` : ''}
          </Badge>
        )}
        {isDiagnose && !confirmedDiag && diagnoses.length === 0 && (
          <Badge variant="outline" className="text-xs">
            {t('plantAdvisor.chat.chips.diagnosisUnconfirmed', { defaultValue: 'Diagnosis unconfirmed' })}
          </Badge>
        )}
        {interpretation?.overall_confidence && (
          <Badge variant="outline" className="text-xs">
            {t('plantAdvisor.chat.chips.aiConfidence', { defaultValue: 'AI confidence' })}:{' '}
            {confidenceLabel(interpretation.overall_confidence)}
          </Badge>
        )}
      </div>

      {aiVsConfirmedMismatch && (
        <div className="border-b border-border px-4 py-2 bg-amber-500/10 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span>
            {t('plantAdvisor.chat.warnings.aiMismatch', {
              defaultValue: 'AI interpretation and confirmed diagnosis may differ. Review candidates before acting.',
            })}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <div className="font-medium text-foreground mb-1">{t('plantAdvisor.chat.contextHeader')}</div>
          <div>{t('plantAdvisor.fields.goal')}: {goal ? t(`plantAdvisor.goals.${goal}`) : '—'}</div>
          {plantCase.location_text && <div>{t('plantAdvisor.fields.location')}: {plantCase.location_text}</div>}
          {plantCase.crop_context && <div>{t('plantAdvisor.fields.crop')}: {plantCase.crop_context}</div>}
          <div>{t('plantAdvisor.chat.imagesAttached', { count: images.length })}</div>
          {topIdent && (
            <div className="mt-2 pt-2 border-t border-border/50">
              <div className="font-medium text-foreground">
                {confirmedIdent ? t('plantAdvisor.identify.confirmedPlant') : t('plantAdvisor.identify.suggestedPlant')}:{' '}
                {topIdent.common_name || topIdent.scientific_name_without_author || topIdent.scientific_name}
              </div>
              {topIdent.scientific_name_without_author && topIdent.common_name && (
                <div className="italic">{topIdent.scientific_name_without_author}</div>
              )}
              <div>
                {t('plantAdvisor.identify.fields.confidence')}: {topIdent.score != null ? `${Math.round(topIdent.score * 100)}%` : '—'}
                {identBucket && ` (${confidenceLabel(identBucket)})`}
              </div>
              {alts.length > 0 && (
                <div className="mt-1">
                  {t('plantAdvisor.identify.alternatives')}: {alts.map((a) => a.common_name || a.scientific_name_without_author).filter(Boolean).join(', ')}
                </div>
              )}
            </div>
          )}
          <div className="mt-2 pt-2 border-t border-border/50 italic">
            {t('plantAdvisor.chat.disclaimers.noImageInspection', {
              defaultValue: 'Chat uses case context, provider results, and notes. It may not directly inspect images unless image analysis is enabled.',
            })}
          </div>
        </div>
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-card border border-border'}`}>
              {m.role === 'user' ? m.content : <MarkdownContent content={m.content} />}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-lg px-3 py-2 text-sm flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('plantAdvisor.chat.thinking', { defaultValue: 'Thinking…' })}
            </div>
          </div>
        )}
      </div>

      {quickQuestions.length > 0 && (
        <div className="border-t border-border px-3 pt-2 flex flex-wrap gap-1.5">
          {quickQuestions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => send(q)}
              disabled={pending}
              className="text-xs px-2 py-1 rounded-md border border-border bg-muted/40 hover:bg-muted disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('plantAdvisor.chat.inputPh')}
            rows={2}
            disabled={pending}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
          />
          <Button onClick={() => send()} disabled={!input.trim() || pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
