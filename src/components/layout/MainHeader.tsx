import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthDialog } from '@/components/auth/AuthDialog';
import { 
  Settings, 
  ChevronDown,
  Sparkles,
  Globe,
  LogOut
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useApp } from '@/contexts/useApp';
import { useAuth } from '@/contexts/useAuth';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

import { planIcons, planLabels } from '@/lib/planConfig';

interface MainHeaderProps {
  minimal?: boolean;
}

export function MainHeader({ minimal = false }: MainHeaderProps) {
  const { 
    user: appUser, 
    language, 
    setLanguage,
    setShowSettings,
    setShowPricing,
  } = useApp();

  const { user: authUser, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [showAuth, setShowAuth] = useState(false);

  // Map app language ('en' | 'sr-lat') to i18n language ('en' | 'sr-latn')
  const toI18nLang = (lang: 'en' | 'sr-lat') => (lang === 'sr-lat' ? 'sr-latn' : 'en');

  const handleLanguageChange = (lang: 'en' | 'sr-lat') => {
    setLanguage(lang);
    i18n.changeLanguage(toI18nLang(lang));
  };

  // Keep i18n in sync if app language changes elsewhere
  React.useEffect(() => {
    const target = toI18nLang(language);
    if (i18n.language !== target) {
      i18n.changeLanguage(target);
    }
  }, [language, i18n]);

  const PlanIcon = planIcons[appUser.plan];

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out successfully");
  };

  const displayName = profile?.full_name || authUser?.user_metadata?.full_name || authUser?.email || '';
  const displayEmail = profile?.email || authUser?.email || '';
  const avatarUrl = profile?.avatar_url || authUser?.user_metadata?.avatar_url || '';
  const initials = displayName
    ? displayName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : displayEmail?.[0]?.toUpperCase() || '?';

  return (
    <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 shrink-0">
      {/* Left Side - App Name */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent/70 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-accent-foreground" />
          </div>
          <div className="text-left">
            <h1 className="text-base font-semibold text-foreground leading-tight">
              Insight <span className="gradient-text">Navigator</span>
            </h1>
            <p className="text-[10px] text-muted-foreground leading-tight">Knowledge Assistant</p>
          </div>
        </div>
      </div>

      {/* Right Side - Actions */}
      <div className="flex items-center gap-1.5">
        {/* Not logged in: show auth options */}
        {!authUser && (
          <>
            <Button variant="default" size="sm" onClick={() => setShowAuth(true)}>Sign in</Button>
            <AuthDialog open={showAuth} onOpenChange={setShowAuth} />
          </>
        )}

        {/* Logged in actions */}
        {authUser && (
          <>
            {/* Language Selector - hide in minimal mode */}
            {!minimal && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-9 px-3 gap-1.5 text-muted-foreground hover:text-foreground rounded-lg">
                    <Globe className="h-4 w-4" />
                    <span className="text-sm">{language === 'en' ? 'EN' : 'SR'}</span>
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>{t('header.language.label')}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleLanguageChange('en')}>
                    <span className={cn(language === 'en' && 'font-medium')}>{t('header.language.en')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleLanguageChange('sr-lat')}>
                    <span className={cn(language === 'sr-lat' && 'font-medium')}>{t('header.language.sr-latn')}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Plan Badge with label */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-9 px-3 gap-1.5 rounded-lg",
                    `plan-badge-${appUser.plan}`
                  )}
                  onClick={() => setShowPricing(true)}
                >
                  <PlanIcon className="h-4 w-4" />
                  <span className="text-sm font-medium">{planLabels[appUser.plan]}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{planLabels[appUser.plan]} Plan</TooltipContent>
            </Tooltip>

            {/* General Settings - hide in minimal mode */}
            {!minimal && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    className="h-9 w-9 p-0 rounded-lg text-muted-foreground hover:text-foreground"
                    onClick={() => setShowSettings(true)}
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>General Settings</TooltipContent>
              </Tooltip>
            )}

            {/* User Avatar with dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Avatar className="h-9 w-9 cursor-pointer hover:ring-2 hover:ring-accent/50 transition-all rounded-lg">
                  {avatarUrl && <AvatarImage src={avatarUrl} alt={displayName} />}
                  <AvatarFallback className="bg-primary text-primary-foreground text-sm rounded-lg">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span>{displayName || 'User'}</span>
                    <span className="text-xs font-normal text-muted-foreground">{displayEmail}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/profile-settings')}>Profile Settings</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowPricing(true)}>Billing & Plans</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </header>
  );
}
