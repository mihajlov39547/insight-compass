import React, { useState } from 'react';
import { 
  FileText, 
  Database, 
  MessageSquare, 
  Users, 
  Sparkles,
  BookOpen,
  StickyNote
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AuthDialog } from '@/components/auth/AuthDialog';

interface OnboardingScreenProps {
  onStartFree: () => void;
  onViewPricing: () => void;
}

const features = [
  {
    icon: FileText,
    title: 'Upload & Index Documents',
    description: 'Upload PDFs, Word files, and text documents. They\'re automatically indexed for fast, accurate retrieval.',
  },
  {
    icon: Database,
    title: 'Multimodal Knowledge Base',
    description: 'Combine text, structured data, and multiple file formats into a centralized knowledge base per project.',
  },
  {
    icon: MessageSquare,
    title: 'RAG-Powered Chat',
    description: 'Ask questions in natural language. Responses are grounded in your uploaded content for improved accuracy.',
  },
  {
    icon: Users,
    title: 'Team Collaboration',
    description: 'Share projects with team members. Ensure consistent answers from a shared source of truth.',
  },
];

export function OnboardingScreen({ onStartFree, onViewPricing }: OnboardingScreenProps) {
  const [showAuth, setShowAuth] = useState(false);

  return (
    <div className="flex-1 overflow-auto bg-gradient-to-b from-background to-muted/20">
      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-6">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium">AI-Powered Knowledge Assistant</span>
          </div>
          
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-6 leading-tight">
            Turn Your Documents Into
            <br />
            <span className="text-primary">Intelligent Conversations</span>
          </h1>
          
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            Upload your files, build a searchable knowledge base, and get accurate answers 
            powered by retrieval-augmented generation. Perfect for teams who need fast, 
            reliable information retrieval.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button 
              size="lg" 
              onClick={() => setShowAuth(true)}
              className="min-w-[200px]"
            >
              Sign in
            </Button>
            <Button 
              variant="outline" 
              size="lg" 
              onClick={onViewPricing}
              className="min-w-[200px]"
            >
              View Pricing
            </Button>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
          {features.map((feature, index) => (
            <Card 
              key={index} 
              className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-border/50 bg-card/50 backdrop-blur-sm"
            >
              <CardContent className="p-6">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Notebook & Notes Section */}
        <div className="mb-16">
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-3">
              Organize Insights with Notebooks
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Go beyond Q&A — structure your knowledge, capture findings, and build reusable research workflows.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-3xl mx-auto">
            <Card className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="p-5">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-accent/60 flex items-center justify-center group-hover:bg-accent transition-colors">
                    <BookOpen className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1.5 text-sm">Build Research Notebooks</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Organize documents, questions, and sources into focused knowledge workspaces.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-border/50 bg-card/50 backdrop-blur-sm">
              <CardContent className="p-5">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-accent/60 flex items-center justify-center group-hover:bg-accent transition-colors">
                    <StickyNote className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1.5 text-sm">Save and Reuse Insights</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Turn useful answers into notes, refine them, and add them back as reusable sources.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
        {/* Use Cases Section */}
        <div className="py-8 border-t border-border/50">
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-3">
              What You Can Do with Insight Navigator
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              Practical ways to get value from your documents and knowledge.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mx-auto">
            {[
              { icon: Search, title: 'Research & Analysis', description: 'Explore papers, reports, specifications, and long documents faster.' },
              { icon: GraduationCap, title: 'Learning & Study', description: 'Turn dense material into clear explanations, summaries, and study notes.' },
              { icon: MessageCircleQuestion, title: 'Document Q&A', description: 'Ask questions across your uploaded files and get grounded answers quickly.' },
              { icon: FolderOpen, title: 'Knowledge Organization', description: 'Build reusable notebooks, notes, and source-backed knowledge bases.' },
            ].map((uc, i) => (
              <div key={i} className="text-center p-5 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <uc.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground text-sm mb-1.5">{uc.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{uc.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <AuthDialog open={showAuth} onOpenChange={setShowAuth} />
    </div>
  );
}
