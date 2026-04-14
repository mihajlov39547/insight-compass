import React, { useEffect, useState } from 'react';
import { Settings, RotateCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useApp } from '@/contexts/useApp';
import { useUserSettings, useSaveUserSettings, GeneralSettings } from '@/hooks/useUserSettings';
import { modelOptions } from '@/data/mockData';
import { toast } from 'sonner';
import { RetrievalWeightsSection } from '@/components/settings/RetrievalWeightsSection';
import { supabase } from '@/integrations/supabase/client';

export function SettingsDialog() {
  const { showSettings, setShowSettings } = useApp();
  const { data: settings } = useUserSettings();
  const saveSettings = useSaveUserSettings();

  const [local, setLocal] = useState<GeneralSettings | null>(null);

  useEffect(() => {
    if (showSettings && settings) {
      setLocal({ ...settings });
    }
  }, [showSettings, settings]);

  if (!showSettings || !local) return null;

  const update = <K extends keyof GeneralSettings>(key: K, value: GeneralSettings[K]) => {
    setLocal(prev => prev ? { ...prev, [key]: value } : prev);
  };

  const handleSave = async () => {
    try {
      await saveSettings.mutateAsync(local);
      toast.success('Settings saved');
      setShowSettings(null);
    } catch {
      toast.error('Failed to save settings');
    }
  };

  return (
    <Dialog open={!!showSettings} onOpenChange={() => setShowSettings(null)}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-accent" />
            General Settings
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-6">
          {/* AI Response Preferences */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">AI Response Preferences</h3>

            <SettingSelect
              label="Default Response Length"
              value={local.response_length}
              options={['Concise', 'Standard', 'Detailed']}
              onChange={v => update('response_length', v)}
            />
            <SettingSelect
              label="Retrieval Depth"
              value={local.retrieval_depth}
              options={['Shallow', 'Medium', 'Deep']}
              onChange={v => update('retrieval_depth', v)}
            />
            <SettingToggle
              label="Cite Sources"
              checked={local.cite_sources}
              onChange={v => update('cite_sources', v)}
            />
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Auto-summarize Documents</Label>
                <p className="text-xs text-muted-foreground">Enabled by default</p>
              </div>
              <Switch checked={true} disabled />
            </div>
            <SettingToggle
              label="Enable Answer Formatting"
              description="Rich markdown rendering for AI answers"
              checked={local.enable_answer_formatting}
              onChange={v => update('enable_answer_formatting', v)}
            />
            <RetrievalWeightsSection
              values={{
                retrieval_chunk_weight: local.retrieval_chunk_weight,
                retrieval_question_weight: local.retrieval_question_weight,
                retrieval_keyword_weight: local.retrieval_keyword_weight,
              }}
              onChange={({ retrieval_chunk_weight, retrieval_question_weight, retrieval_keyword_weight }) => {
                setLocal(prev => prev ? {
                  ...prev,
                  retrieval_chunk_weight,
                  retrieval_question_weight,
                  retrieval_keyword_weight,
                } : prev);
              }}
            />
            <SettingToggle
              label="Chat suggestions"
              description="Show AI-generated follow-up suggestions in chat"
              checked={local.chat_suggestions}
              onChange={v => update('chat_suggestions', v)}
            />
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">Generation complete sound</Label>
                <p className="text-xs text-muted-foreground">Play a sound when generation finishes</p>
              </div>
              <Select value={local.generation_sound} onValueChange={v => update('generation_sound', v)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="first">First generation</SelectItem>
                  <SelectItem value="always">Always</SelectItem>
                  <SelectItem value="never">Never</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <SettingToggle
              label="Agent action notifications"
              description="Get notified when agent actions complete"
              checked={local.agent_action_notifications}
              onChange={v => update('agent_action_notifications', v)}
            />
          </section>

          <Separator />

          {/* Interface Preferences */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Interface Preferences</h3>

            <SettingSelect
              label="Language"
              value={local.language_preference}
              options={['en', 'sr-lat']}
              optionLabels={{ en: 'English', 'sr-lat': 'Serbian (Latin)' }}
              onChange={v => update('language_preference', v)}
            />
            <SettingSelect
              label="Layout"
              value={local.layout_preference}
              options={['comfortable', 'compact']}
              optionLabels={{ comfortable: 'Comfortable', compact: 'Compact' }}
              onChange={v => update('layout_preference', v)}
            />
          </section>

          <Separator />

          {/* Defaults */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Defaults</h3>

            <div className="flex items-center justify-between">
              <Label className="text-sm">Preferred AI Model</Label>
              <Select value={local.preferred_model} onValueChange={v => update('preferred_model', v)}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map(m => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </section>
        </div>

        <div className="flex items-center justify-between gap-2 pt-4 border-t border-border">
          <RedeployEdgeButton />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowSettings(null)}>
              Cancel
            </Button>
            <Button
              className="bg-accent hover:bg-accent/90 text-accent-foreground"
              onClick={handleSave}
              disabled={saveSettings.isPending}
            >
              {saveSettings.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingSelect({
  label,
  value,
  options,
  optionLabels,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  optionLabels?: Record<string, string>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[150px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(opt => (
            <SelectItem key={opt} value={opt}>
              {optionLabels?.[opt] ?? opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <Label className="text-sm">{label}</Label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

const EDGE_FUNCTIONS = [
  'chat', 'generate-chat-title', 'handle-email-suppression', 'handle-email-unsubscribe',
  'hybrid-retrieval', 'improve-description', 'improve-notebook', 'improve-prompt',
  'notebook-scope-check', 'preview-transactional-email', 'process-email-queue',
  'send-transactional-email', 'tavily-search', 'validation-harness',
  'workflow-maintenance', 'workflow-start', 'workflow-worker', 'youtube-transcript-worker',
];

function RedeployEdgeButton() {
  const [loading, setLoading] = useState(false);

  const handleRedeploy = async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled(
        EDGE_FUNCTIONS.map((fn) =>
          supabase.functions.invoke(fn, { method: 'OPTIONS' as any }).catch(() => ({ ok: true }))
        )
      );
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      toast.success(`Redeploy pinged ${ok}/${EDGE_FUNCTIONS.length} functions`);
    } catch {
      toast.error('Redeploy request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleRedeploy}
      disabled={loading}
      className="gap-1.5 text-muted-foreground"
    >
      <RotateCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
      {loading ? 'Pinging…' : 'Redeploy Edge'}
    </Button>
  );
}
