import React from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/hooks/useProjects';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useApp } from '@/contexts/AppContext';
import { FolderOpen, BookOpenCheck, MessageSquare, FileText, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function HomeLanding() {
  const { profile, user: authUser } = useAuth();
  const { data: projects = [] } = useProjects();
  const { data: notebooks = [] } = useNotebooks();
  const { setActiveView, setShowNewProject } = useApp();

  const firstName = (profile?.full_name || authUser?.user_metadata?.full_name || 'there').split(' ')[0];

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-3xl mx-auto w-full">
      <h1 className="text-3xl font-bold text-foreground mb-2">Welcome back, {firstName}</h1>
      <p className="text-muted-foreground mb-10 text-center">Your knowledge workspace is ready. What would you like to work on?</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
        <button
          onClick={() => setActiveView('projects')}
          className="group flex flex-col items-start gap-3 p-5 rounded-xl border border-border bg-card hover:bg-accent/50 transition-colors text-left"
        >
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <FolderOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-medium text-foreground">My Projects</p>
            <p className="text-sm text-muted-foreground">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
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
            <p className="font-medium text-foreground">My Notebooks</p>
            <p className="text-sm text-muted-foreground">{notebooks.length} notebook{notebooks.length !== 1 ? 's' : ''}</p>
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
            <p className="font-medium text-foreground">New Project</p>
            <p className="text-sm text-muted-foreground">Start a new research project</p>
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
            <p className="font-medium text-foreground">Resources</p>
            <p className="text-sm text-muted-foreground">Browse your documents</p>
          </div>
        </button>
      </div>
    </div>
  );
}
