import React, { useMemo } from 'react';
import {
  Plus, FileText, Zap, Shield, MessageSquare,
  Atom, FlaskConical, Microscope, Scale, Landmark,
  Scroll, Wrench, Rocket, Cpu, Leaf, Globe, BookOpen,
  Brain, Library, Lightbulb, Palette, Music, Heart,
  BarChart3, GraduationCap, Camera
} from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { useProjects } from '@/hooks/useProjects';
import { useChats } from '@/hooks/useAllChats';
import { formatDistanceToNow } from 'date-fns';

const ICONS = [
  Atom, FlaskConical, Microscope, Scale, Landmark, Scroll,
  Wrench, Rocket, Cpu, Leaf, Globe, BookOpen, Brain,
  Library, Lightbulb, Palette, Music, Heart, BarChart3,
  GraduationCap, Camera,
];

const CARD_COLORS = [
  'bg-blue-50 border-blue-100',
  'bg-amber-50 border-amber-100',
  'bg-rose-50 border-rose-100',
  'bg-emerald-50 border-emerald-100',
  'bg-violet-50 border-violet-100',
  'bg-cyan-50 border-cyan-100',
  'bg-orange-50 border-orange-100',
  'bg-teal-50 border-teal-100',
  'bg-pink-50 border-pink-100',
  'bg-indigo-50 border-indigo-100',
];

const ICON_COLORS = [
  'text-blue-500',
  'text-amber-500',
  'text-rose-500',
  'text-emerald-500',
  'text-violet-500',
  'text-cyan-500',
  'text-orange-500',
  'text-teal-500',
  'text-pink-500',
  'text-indigo-500',
];

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function formatLastActivity(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return formatDistanceToNow(date, { addSuffix: true });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function ProjectsLanding() {
  const { setShowNewProject, setSelectedProjectId } = useApp();
  const { data: projects = [], isLoading } = useProjects();
  const { data: allChats = [] } = useChats();

  const chatCountByProject = useMemo(() => {
    const map: Record<string, number> = {};
    allChats.forEach(c => {
      map[c.project_id] = (map[c.project_id] || 0) + 1;
    });
    return map;
  }, [allChats]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const hasProjects = projects.length > 0;

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="max-w-6xl mx-auto px-6 py-10 animate-fade-in">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">My Projects</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {hasProjects
              ? `${projects.length} project${projects.length !== 1 ? 's' : ''}`
              : 'No projects yet'}
          </p>
        </div>

        {hasProjects ? (
          /* Project Grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {/* Create Card */}
            <button
              onClick={() => setShowNewProject(true)}
              className="group relative flex flex-col items-center justify-center min-h-[180px] rounded-xl border-2 border-dashed border-border bg-background hover:border-primary/40 hover:bg-muted/50 transition-all duration-200 cursor-pointer active:scale-[0.98]"
            >
              <div className="w-12 h-12 rounded-full border-2 border-muted-foreground/20 flex items-center justify-center mb-3 group-hover:border-primary/40 group-hover:text-primary transition-colors">
                <Plus className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                Create new project
              </span>
            </button>

            {/* Project Cards */}
            {projects.map((project, idx) => {
              const h = hashCode(project.id);
              const colorIdx = h % CARD_COLORS.length;
              const iconIdx = h % ICONS.length;
              const IconComponent = ICONS[iconIdx];
              const chatCount = chatCountByProject[project.id] || 0;

              return (
                <button
                  key={project.id}
                  onClick={() => setSelectedProjectId(project.id)}
                  className={`group relative flex flex-col justify-between min-h-[180px] rounded-xl border p-5 text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 cursor-pointer active:scale-[0.98] ${CARD_COLORS[colorIdx]}`}
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <div>
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${ICON_COLORS[colorIdx]}`}>
                      <IconComponent className="h-6 w-6" />
                    </div>
                    <h3 className="font-semibold text-foreground text-sm leading-snug line-clamp-2 overflow-wrap-break-word">
                      {project.name}
                    </h3>
                  </div>
                  <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span>{chatCount}</span>
                    </div>
                    <span>{formatLastActivity(project.updated_at)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          /* Empty State */
          <div className="space-y-10">
            <div className="flex justify-center">
              <button
                onClick={() => setShowNewProject(true)}
                className="group flex flex-col items-center justify-center w-72 h-48 rounded-xl border-2 border-dashed border-border bg-background hover:border-primary/40 hover:bg-muted/50 transition-all duration-200 cursor-pointer active:scale-[0.98]"
              >
                <div className="w-14 h-14 rounded-full border-2 border-muted-foreground/20 flex items-center justify-center mb-3 group-hover:border-primary/40 transition-colors">
                  <Plus className="h-7 w-7 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                  Create your first project
                </span>
              </button>
            </div>

            <div className="max-w-3xl mx-auto">
              <p className="text-center text-muted-foreground text-sm mb-8">
                Create a project to organize your documents, build a knowledge base, and get grounded answers.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FeatureBlock
                  icon={<FileText className="h-5 w-5" />}
                  title="Document Analysis"
                  description="Query across all your uploaded documents"
                />
                <FeatureBlock
                  icon={<Zap className="h-5 w-5" />}
                  title="Instant Answers"
                  description="Get accurate responses with source-aware retrieval"
                />
                <FeatureBlock
                  icon={<Shield className="h-5 w-5" />}
                  title="Secure & Private"
                  description="Your data stays inside your workspace and project context"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FeatureBlock({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-5 rounded-xl border border-border bg-card text-center">
      <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent mx-auto mb-3">
        {icon}
      </div>
      <h4 className="font-medium text-sm text-foreground mb-1">{title}</h4>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
