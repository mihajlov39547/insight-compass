import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AVAILABLE_LANGUAGES, normalizeLanguageCode } from '@/lib/languages';
import { AuthDialog } from '@/components/auth/AuthDialog';
import { 
  Settings, 
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

import { planIcons } from '@/lib/planConfig';

interface MainHeaderProps {
  minimal?: boolean;
}

export function MainHeader({ minimal = false }: MainHeaderProps) {
  const { 
    user: appUser, 
    setShowSettings,
    setShowPricing,
  } = useApp();

  const { user: authUser, profile, signOut } = useAuth();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [showAuth, setShowAuth] = useState(false);

  const language = normalizeLanguageCode(i18n.resolvedLanguage || i18n.language);

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
            <h1 className="text-base font-semibold text-foreground leading-tight">{t('sidebar.workspace')}</h1>
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
            {/* Interface language indicator - language changes live in Settings. */}
            {!minimal && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-muted-foreground">
                    <Globe className="h-4 w-4" />
                    <span className="font-medium">{t(`header.language.short.${language}`)}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>{t('header.language.changeInSettings')}</TooltipContent>
              </Tooltip>
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
                  <span className="text-sm font-medium">{t(`header.plans.${appUser.plan}`)}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t(`header.plans.${appUser.plan}`)} {t('profileSettings.subscription.planSuffix')}</TooltipContent>
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
                    <span>{displayName || t('header.userMenu.fallbackName')}</span>
                    <span className="text-xs font-normal text-muted-foreground">{displayEmail}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/profile-settings')}>{t('header.userMenu.profileSettings')}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowPricing(true)}>{t('header.userMenu.billingPlans')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="h-4 w-4 mr-2" />
                  {t('header.userMenu.signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </header>
  );
}
