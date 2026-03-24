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
        {/* Social Proof / Trust Section */}
        <div className="text-center py-8 border-t border-border/50">
          <p className="text-sm text-muted-foreground mb-4">
            Trusted by teams at leading organizations
          </p>
          <div className="flex items-center justify-center gap-8 opacity-50">
            <div className="h-8 w-24 bg-muted-foreground/20 rounded" />
            <div className="h-8 w-20 bg-muted-foreground/20 rounded" />
            <div className="h-8 w-28 bg-muted-foreground/20 rounded" />
            <div className="h-8 w-24 bg-muted-foreground/20 rounded hidden sm:block" />
          </div>
        </div>
      </div>

      <AuthDialog open={showAuth} onOpenChange={setShowAuth} />
    </div>
  );
}
