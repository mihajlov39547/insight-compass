import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MessageSquare, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownContent } from '@/components/chat/MarkdownContent';
import { usePlantCaseImages } from '@/hooks/usePlantCaseImages';
import type { PlantCase } from '@/hooks/usePlantCases';

interface Props {
  plantCase: PlantCase;
  onBack: () => void;
}

interface Msg { role: 'user' | 'assistant'; content: string }

export function PlantCaseChatPanel({ plantCase, onBack }: Props) {
  const { t } = useTranslation();
  const { data: images = [] } = usePlantCaseImages(plantCase.id);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Msg[]>(() => ([
    {
      role: 'assistant',
      content: t('plantAdvisor.chat.intro', {
        title: plantCase.title,
        defaultValue:
          'I have your plant case "{{title}}" loaded. Image-based plant identification and disease diagnosis will be added in the next phase. For now I can only discuss the notes and context you have provided — I will not pretend to identify the plant from the photos.',
      }),
    },
  ]));

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    const next: Msg[] = [
      ...messages,
      { role: 'user', content: text },
      {
        role: 'assistant',
        content: t('plantAdvisor.chat.placeholderReply', {
          defaultValue:
            'Noted. Phase 1 of Plant Advisor does not call any plant identification or diagnosis API yet, so I cannot analyze the uploaded images. Once that is wired up I will use your notes, location, crop context, and image roles to give you a grounded answer.',
        }),
      },
    ];
    setMessages(next);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-4 py-3 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack}><ArrowLeft className="h-4 w-4" /></Button>
        <MessageSquare className="h-4 w-4 text-primary" />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{plantCase.title}</div>
          <div className="text-xs text-muted-foreground">{t('plantAdvisor.chat.title')}</div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <div className="font-medium text-foreground mb-1">{t('plantAdvisor.chat.contextHeader')}</div>
          <div>{t('plantAdvisor.fields.goal')}: {plantCase.user_goal ? t(`plantAdvisor.goals.${plantCase.user_goal}`) : '—'}</div>
          {plantCase.location_text && <div>{t('plantAdvisor.fields.location')}: {plantCase.location_text}</div>}
          {plantCase.crop_context && <div>{t('plantAdvisor.fields.crop')}: {plantCase.crop_context}</div>}
          <div>{t('plantAdvisor.chat.imagesAttached', { count: images.length })}</div>
        </div>
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-card border border-border'}`}>
              {m.role === 'user' ? m.content : <MarkdownContent content={m.content} />}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('plantAdvisor.chat.inputPh')}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
          />
          <Button onClick={send} disabled={!input.trim()}><Send className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>
  );
}
