import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { useApp } from '@/contexts/AppContext';
import { useAuth } from '@/contexts/AuthContext';
import { lovable } from '@/integrations/lovable/index';
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
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  const PlanIcon = planIcons[appUser.plan];

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
            <Button variant="default" size="sm" onClick={handleGoogleSignIn} disabled={isGoogleLoading} className="gap-2">
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              {isGoogleLoading ? '...' : 'Google'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowAuth(true)}>Sign in</Button>
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
                  <DropdownMenuLabel>Language</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setLanguage('en')}>
                    <span className={cn(language === 'en' && 'font-medium')}>English</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLanguage('sr-lat')}>
                    <span className={cn(language === 'sr-lat' && 'font-medium')}>Serbian (Latin)</span>
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
