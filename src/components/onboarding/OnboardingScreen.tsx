import React, { useState } from 'react';
import { 
  FileText, 
  Database, 
  MessageSquare, 
  Users, 
  Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { lovable } from '@/integrations/lovable/index';
import { toast } from 'sonner';
import { AuthDialog } from '@/components/auth/AuthDialog';
import { RegisterDialog } from '@/components/auth/RegisterDialog';
import { SignInDialog } from '@/components/auth/SignInDialog';

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
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    try {
      const { error } = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (error) {
        toast.error("Failed to sign in with Google");
        console.error("Google sign-in error:", error);
      }
    } catch (e) {
      toast.error("Failed to sign in with Google");
      console.error("Google sign-in error:", e);
    } finally {
      setIsGoogleLoading(false);
    }
  };

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
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading}
              className="min-w-[200px] gap-2"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {isGoogleLoading ? 'Signing in...' : 'Sign in with Google'}
            </Button>
            <Button 
              variant="outline" 
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
