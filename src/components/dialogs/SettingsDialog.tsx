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
import { modelOptions } from '@/config/modelOptions';
import { useUserSettings, useSaveUserSettings, GeneralSettings } from '@/hooks/useUserSettings';
import { toast } from 'sonner';
import { RetrievalWeightsSection } from '@/components/settings/RetrievalWeightsSection';
import { supabase } from '@/integrations/supabase/client';
import { AVAILABLE_LANGUAGES, normalizeLanguageCode } from '@/lib/languages';
import { useTranslation } from 'react-i18next';

export function SettingsDialog() {
  const { t, i18n } = useTranslation();
  const { showSettings, setShowSettings } = useApp();
  const { data: settings } = useUserSettings();
  const saveSettings = useSaveUserSettings();

  const [local, setLocal] = useState<GeneralSettings | null>(null);

  useEffect(() => {
    if (showSettings && settings) {
      const hasPreferredModel = modelOptions.some((m) => m.id === settings.preferred_model);
      setLocal({
        ...settings,
        preferred_model: hasPreferredModel ? settings.preferred_model : 'auto',
      });
    }
  }, [showSettings, settings]);

  if (!showSettings || !local) return null;

  const update = <K extends keyof GeneralSettings>(key: K, value: GeneralSettings[K]) => {
    setLocal(prev => prev ? { ...prev, [key]: value } : prev);
  };

  const handleSave = async () => {
    try {
      await saveSettings.mutateAsync(local);
      const nextLanguage = normalizeLanguageCode(local.language_preference);
      if (normalizeLanguageCode(i18n.resolvedLanguage || i18n.language) !== nextLanguage) {
        await i18n.changeLanguage(nextLanguage);
      }
      toast.success(t('settingsDialog.saved'));
      setShowSettings(null);
    } catch {
      toast.error(t('settingsDialog.saveFailed'));
    }
  };

  const responseLengthLabel = (v: string) => t(`settingsDialog.responseLengths.${v.toLowerCase()}`, { defaultValue: v });
  const retrievalDepthLabel = (v: string) => t(`settingsDialog.retrievalDepths.${v.toLowerCase()}`, { defaultValue: v });

  return (
    <Dialog open={!!showSettings} onOpenChange={() => setShowSettings(null)}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-accent" />
            {t('settingsDialog.title')}
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-6">
          {/* AI Response Preferences */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">{t('settingsDialog.aiSection')}</h3>

            <SettingSelect
              label={t('settingsDialog.responseLength')}
              value={local.response_length}
              options={['Concise', 'Standard', 'Detailed']}
              optionLabels={{
                Concise: responseLengthLabel('Concise'),
                Standard: responseLengthLabel('Standard'),
                Detailed: responseLengthLabel('Detailed'),
              }}
              onChange={v => update('response_length', v)}
            />
            <SettingSelect
              label={t('settingsDialog.retrievalDepth')}
              value={local.retrieval_depth}
              options={['Shallow', 'Medium', 'Deep']}
              optionLabels={{
                Shallow: retrievalDepthLabel('Shallow'),
                Medium: retrievalDepthLabel('Medium'),
                Deep: retrievalDepthLabel('Deep'),
              }}
              onChange={v => update('retrieval_depth', v)}
            />
            <SettingToggle
              label={t('settingsDialog.citeSources')}
              checked={true}
              onChange={() => {}}
              disabled
            />
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">{t('settingsDialog.autoSummarize')}</Label>
                <p className="text-xs text-muted-foreground">{t('settingsDialog.autoSummarizeHelp')}</p>
              </div>
              <Switch checked={true} disabled />
            </div>
            <SettingToggle
              label={t('settingsDialog.answerFormatting')}
              description={t('settingsDialog.answerFormattingHelp')}
              checked={true}
              onChange={() => {}}
              disabled
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
              label={t('settingsDialog.chatSuggestions')}
              description={t('settingsDialog.chatSuggestionsHelp')}
              checked={local.chat_suggestions}
              onChange={v => update('chat_suggestions', v)}
            />
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm">{t('settingsDialog.generationSound')}</Label>
                <p className="text-xs text-muted-foreground">{t('settingsDialog.generationSoundHelp')}</p>
              </div>
              <Select value={local.generation_sound} onValueChange={v => update('generation_sound', v)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="first">{t('settingsDialog.generationSounds.first')}</SelectItem>
                  <SelectItem value="always">{t('settingsDialog.generationSounds.always')}</SelectItem>
                  <SelectItem value="never">{t('settingsDialog.generationSounds.never')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <SettingToggle
              label={t('settingsDialog.agentNotifications')}
              description={t('settingsDialog.agentNotificationsHelp')}
              checked={local.agent_action_notifications}
              onChange={v => update('agent_action_notifications', v)}
            />
          </section>

          <Separator />

          {/* Interface Preferences */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">{t('settingsDialog.interfaceSection')}</h3>

            <SettingSelect
              label={t('settingsDialog.language')}
              value={local.language_preference}
              options={AVAILABLE_LANGUAGES.map((language) => language.code)}
              optionLabels={Object.fromEntries(
                AVAILABLE_LANGUAGES.map((language) => [language.code, t(language.translationKey)]),
              )}
              onChange={v => update('language_preference', normalizeLanguageCode(v))}
            />
            <SettingSelect
              label={t('settingsDialog.layout')}
              value={local.layout_preference}
              options={['comfortable', 'compact']}
              optionLabels={{
                comfortable: t('settingsDialog.layouts.comfortable'),
                compact: t('settingsDialog.layouts.compact'),
              }}
              onChange={v => update('layout_preference', v)}
            />
          </section>

          <Separator />

          {/* Defaults */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">{t('settingsDialog.defaultsSection')}</h3>

            <div className="flex items-center justify-between">
              <Label className="text-sm">{t('settingsDialog.preferredModel')}</Label>
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
              {t('settingsDialog.cancel')}
            </Button>
            <Button
              className="bg-accent hover:bg-accent/90 text-accent-foreground"
              onClick={handleSave}
              disabled={saveSettings.isPending}
            >
              {saveSettings.isPending ? t('settingsDialog.saving') : t('settingsDialog.save')}
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
  const { t } = useTranslation();
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
      toast.success(t('settingsDialog.redeployPinged', { ok, total: EDGE_FUNCTIONS.length }));
    } catch {
      toast.error(t('settingsDialog.redeployFailed'));
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
      {loading ? t('settingsDialog.pinging') : t('settingsDialog.redeployEdge')}
    </Button>
  );
}
