import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/useAuth';
import { useProjects } from '@/hooks/useProjects';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useApp } from '@/contexts/useApp';
import { FolderOpen, BookOpenCheck, MessageSquare, FileText } from 'lucide-react';

export function HomeLanding() {
  const { t } = useTranslation();
  const { profile, user: authUser } = useAuth();
  const { data: projects = [] } = useProjects();
  const { data: notebooks = [] } = useNotebooks();
  const { setActiveView, setShowNewProject } = useApp();

  const fallback = t('home.fallbackName');
  const firstName = (profile?.full_name || authUser?.user_metadata?.full_name || fallback).split(' ')[0];

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-3xl mx-auto w-full">
      <h1 className="text-3xl font-bold text-foreground mb-2">{t('home.welcome', { name: firstName })}</h1>
      <p className="text-muted-foreground mb-10 text-center">{t('home.subtitle')}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
        <button
          onClick={() => setActiveView('projects')}
          className="group flex flex-col items-start gap-3 p-5 rounded-xl border border-border bg-card hover:bg-accent/50 transition-colors text-left"
        >
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <FolderOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-medium text-foreground">{t('home.cards.projects.title')}</p>
            <p className="text-sm text-muted-foreground">{t('home.cards.projects.count', { count: projects.length })}</p>
          </div>
        </button>

        <button
          onClick={() => setActiveView('notebooks')}
          className="group flex flex-col items-start gap-3 p-5 rounded-xl border border-border bg-card hover:bg-accent/50 transition-colors text-left"
        >
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <BookOpenCheck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-medium text-foreground">{t('home.cards.notebooks.title')}</p>
            <p className="text-sm text-muted-foreground">{t('home.cards.notebooks.count', { count: notebooks.length })}</p>
          </div>
        </button>

        <button
          onClick={() => setShowNewProject(true)}
          className="group flex flex-col items-start gap-3 p-5 rounded-xl border border-border bg-card hover:bg-accent/50 transition-colors text-left"
        >
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <MessageSquare className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-medium text-foreground">{t('home.cards.newProject.title')}</p>
            <p className="text-sm text-muted-foreground">{t('home.cards.newProject.description')}</p>
          </div>
        </button>

        <button
          onClick={() => setActiveView('resources')}
          className="group flex flex-col items-start gap-3 p-5 rounded-xl border border-border bg-card hover:bg-accent/50 transition-colors text-left"
        >
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-medium text-foreground">{t('home.cards.resources.title')}</p>
            <p className="text-sm text-muted-foreground">{t('home.cards.resources.description')}</p>
          </div>
        </button>
      </div>
    </div>
  );
}
