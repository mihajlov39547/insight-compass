import React, { useState } from 'react';
import { 
  FileText, 
  Database, 
  MessageSquare, 
  Users, 
  Sparkles,
  BookOpen,
  StickyNote,
  Search,
  GraduationCap,
  MessageCircleQuestion,
  FolderOpen
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { AuthDialog } from '@/components/auth/AuthDialog';
import { useTranslation } from 'react-i18next';

interface OnboardingScreenProps {
  onStartFree: () => void;
  onViewPricing: () => void;
}

export function OnboardingScreen({ onStartFree, onViewPricing }: OnboardingScreenProps) {
  const { t } = useTranslation();
  const [showAuth, setShowAuth] = useState(false);

  const features = [
    { icon: FileText, key: 'upload' },
    { icon: Database, key: 'knowledge' },
    { icon: MessageSquare, key: 'rag' },
    { icon: Users, key: 'team' },
  ] as const;

  const useCases = [
    { icon: Search, key: 'research' },
    { icon: GraduationCap, key: 'learning' },
    { icon: MessageCircleQuestion, key: 'qa' },
    { icon: FolderOpen, key: 'organize' },
  ] as const;

  return (
    <div className="flex-1 overflow-auto bg-gradient-to-b from-background to-muted/20">
      <div className="max-w-5xl mx-auto px-6 py-12">
        {/* Hero Section */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary mb-6">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium">{t('onboarding.badge')}</span>
          </div>
          
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-6 leading-tight">
            {t('onboarding.heroLine1')}
            <br />
            <span className="text-primary">{t('onboarding.heroLine2')}</span>
          </h1>
          
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            {t('onboarding.heroDescription')}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button 
              size="lg" 
              onClick={() => setShowAuth(true)}
              className="min-w-[200px]"
            >
              {t('onboarding.signIn')}
            </Button>
            <Button 
              variant="outline" 
              size="lg" 
              onClick={onViewPricing}
              className="min-w-[200px]"
            >
              {t('onboarding.viewPricing')}
            </Button>
          </div>
        </div>

        {/* Feature Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card 
                key={feature.key} 
                className="group hover:shadow-lg transition-all duration-300 hover:-translate-y-1 border-border/50 bg-card/50 backdrop-blur-sm"
              >
                <CardContent className="p-6">
                  <div className="flex gap-4">
                    <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-2">{t(`onboarding.features.${feature.key}.title`)}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {t(`onboarding.features.${feature.key}.description`)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Notebook & Notes Section */}
        <div className="mb-16">
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-bold text-foreground mb-3">
              {t('onboarding.notebooks.title')}
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              {t('onboarding.notebooks.description')}
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
                    <h3 className="font-semibold text-foreground mb-1.5 text-sm">{t('onboarding.notebooks.build.title')}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t('onboarding.notebooks.build.description')}
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
                    <h3 className="font-semibold text-foreground mb-1.5 text-sm">{t('onboarding.notebooks.save.title')}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t('onboarding.notebooks.save.description')}
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
              {t('onboarding.useCases.title')}
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              {t('onboarding.useCases.description')}
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mx-auto">
            {useCases.map((uc) => {
              const Icon = uc.icon;
              return (
                <div key={uc.key} className="text-center p-5 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground text-sm mb-1.5">{t(`onboarding.useCases.${uc.key}.title`)}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{t(`onboarding.useCases.${uc.key}.description`)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <AuthDialog open={showAuth} onOpenChange={setShowAuth} />
    </div>
  );
}
