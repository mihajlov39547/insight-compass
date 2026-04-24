import React, { useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateProject: (name: string, description: string, language: 'en' | 'sr') => void;
}

export function NewProjectDialog({ open, onOpenChange, onCreateProject }: NewProjectDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [language, setLanguage] = useState<'en' | 'sr'>('en');
  const [nameError, setNameError] = useState('');
  const [descriptionError, setDescriptionError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      setNameError('Project name is required');
      return;
    }
    if (!description.trim()) {
      setDescriptionError('Project description is required — it helps the AI provide better answers');
      return;
    }
    
    onCreateProject(name.trim(), description.trim(), language);
    handleClose();
  };

  const handleClose = () => {
    setName('');
    setDescription('');
    setLanguage('en');
    setNameError('');
    setDescriptionError('');
    onOpenChange(false);
  };

  const handleNameChange = (value: string) => {
    setName(value);
    if (value.trim()) {
      setNameError('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <FolderPlus className="h-5 w-5 text-accent" />
            </div>
            <div>
              <DialogTitle>Create New Project</DialogTitle>
              <DialogDescription>
                Start a new knowledge project to organize your documents and chats.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="project-name">
              Project name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="project-name"
              placeholder="Enter project name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className={nameError ? 'border-destructive focus-visible:ring-destructive' : ''}
              autoFocus
            />
            {nameError && (
              <p className="text-sm text-destructive animate-fade-in">{nameError}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-description">
              Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="project-description"
              placeholder="Describe what this project is about. This helps the AI agent provide more relevant and accurate answers..."
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (e.target.value.trim()) setDescriptionError('');
              }}
              rows={3}
              className={`resize-none ${descriptionError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
            />
            {descriptionError && (
              <p className="text-sm text-destructive animate-fade-in">{descriptionError}</p>
            )}
            <p className="text-xs text-muted-foreground">
              This description helps the AI understand the project context and provide better answers.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-language">Language</Label>
            <Select value={language} onValueChange={(val: 'en' | 'sr') => setLanguage(val)}>
              <SelectTrigger id="project-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="sr">Serbian (Latin)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="gap-2 pt-4">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" className="bg-accent hover:bg-accent/90 text-accent-foreground">
              Create Project
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
