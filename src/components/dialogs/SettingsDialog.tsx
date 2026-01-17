import React from 'react';
import { X, FolderOpen, MessageSquare, Wand2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApp } from '@/contexts/AppContext';
import { settingsConfig } from '@/data/mockData';

const icons = {
  project: FolderOpen,
  chat: MessageSquare,
  prompt: Wand2,
};

const titles = {
  project: 'Project Settings',
  chat: 'Chat Settings',
  prompt: 'Prompt Settings',
};

export function SettingsDialog() {
  const { showSettings, setShowSettings } = useApp();

  if (!showSettings) return null;

  const Icon = icons[showSettings];

  return (
    <Dialog open={!!showSettings} onOpenChange={() => setShowSettings(null)}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-accent" />
            {titles[showSettings]}
          </DialogTitle>
        </DialogHeader>

        <div className="py-4">
          {showSettings === 'project' && <ProjectSettings />}
          {showSettings === 'chat' && <ChatSettings />}
          {showSettings === 'prompt' && <PromptSettings />}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button variant="outline" onClick={() => setShowSettings(null)}>
            Cancel
          </Button>
          <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProjectSettings() {
  const config = settingsConfig.project;
  
  return (
    <div className="space-y-6">
      <SettingSelect 
        label={config.responseLength.label}
        options={config.responseLength.options}
        defaultValue="Standard"
      />
      <SettingSelect 
        label={config.retrievalDepth.label}
        options={config.retrievalDepth.options}
        defaultValue="Medium"
      />
      <SettingToggle label={config.citeSources.label} defaultChecked={true} />
      <SettingToggle label={config.autoSummarize.label} defaultChecked={false} />
    </div>
  );
}

function ChatSettings() {
  const config = settingsConfig.chat;
  
  return (
    <div className="space-y-6">
      <SettingSelect 
        label={config.temperature.label}
        options={config.temperature.options}
        defaultValue="Balanced"
      />
      <SettingSelect 
        label={config.maxSources.label}
        options={config.maxSources.options}
        defaultValue="5"
      />
      <SettingToggle label={config.streamResponse.label} defaultChecked={true} />
    </div>
  );
}

function PromptSettings() {
  const config = settingsConfig.prompt;
  
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="text-sm font-medium">{config.systemPrompt.label}</Label>
        <Textarea 
          placeholder="Enter custom system prompt..."
          className="min-h-[120px] resize-none"
          defaultValue="You are a helpful knowledge assistant that provides accurate, well-sourced answers based on the uploaded documents."
        />
        <p className="text-xs text-muted-foreground">
          This prompt guides the assistant's behavior and response style.
        </p>
      </div>
      <SettingSelect 
        label={config.outputFormat.label}
        options={config.outputFormat.options}
        defaultValue="Markdown"
      />
      <SettingToggle label={config.includeMetadata.label} defaultChecked={true} />
    </div>
  );
}

function SettingSelect({ 
  label, 
  options, 
  defaultValue 
}: { 
  label: string; 
  options: string[]; 
  defaultValue: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm">{label}</Label>
      <Select defaultValue={defaultValue}>
        <SelectTrigger className="w-[150px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SettingToggle({ 
  label, 
  defaultChecked 
}: { 
  label: string; 
  defaultChecked: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm">{label}</Label>
      <Switch defaultChecked={defaultChecked} />
    </div>
  );
}
