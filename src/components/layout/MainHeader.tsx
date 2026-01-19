import React from 'react';
import { 
  Share2, 
  Settings, 
  ChevronDown,
  Sparkles,
  Crown,
  Zap,
  Building2,
  Globe,
  FileText
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { cn } from '@/lib/utils';

const planIcons = {
  free: Sparkles,
  basic: Zap,
  premium: Crown,
  enterprise: Building2,
};

const planLabels = {
  free: 'Free',
  basic: 'Basic',
  premium: 'Premium',
  enterprise: 'Enterprise',
};

interface MainHeaderProps {
  minimal?: boolean;
}

export function MainHeader({ minimal = false }: MainHeaderProps) {
  const { 
    user, 
    language, 
    setLanguage,
    setShowSettings,
    setShowDocuments,
    setShowShare,
    setShowPricing,
    setIsFirstTimeUser,
  } = useApp();

  const PlanIcon = planIcons[user.plan];

  return (
    <header className="h-14 bg-card border-b border-border flex items-center justify-between px-4 shrink-0">
      {/* Left Side - App Name */}
      <div className="flex items-center gap-4">
        <button 
          onClick={() => setIsFirstTimeUser(true)}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent/70 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-accent-foreground" />
          </div>
          <div className="text-left">
            <h1 className="text-base font-semibold text-foreground leading-tight">
              Insight <span className="gradient-text">Navigator</span>
            </h1>
            <p className="text-[10px] text-muted-foreground leading-tight">Knowledge Assistant</p>
          </div>
        </button>
      </div>

      {/* Right Side - Actions */}
      <div className="flex items-center gap-2">
        {/* Language Selector - hide in minimal mode */}
        {!minimal && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
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

        {/* Documents - hide in minimal mode */}
        {!minimal && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setShowDocuments(true)}
              >
                <FileText className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Documents</TooltipContent>
          </Tooltip>
        )}

        {/* Share - hide in minimal mode */}
        {!minimal && (
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-2"
            onClick={() => setShowShare(true)}
          >
            <Share2 className="h-4 w-4" />
            Share
          </Button>
        )}

        {/* Plan Icon */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-all hover:ring-2 hover:ring-primary/30",
                `plan-badge-${user.plan}`
              )}
              onClick={() => setShowPricing(true)}
            >
              <PlanIcon className="h-4 w-4" />
            </div>
          </TooltipTrigger>
          <TooltipContent>{planLabels[user.plan]} Plan</TooltipContent>
        </Tooltip>

        {/* User Avatar */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Avatar className="h-8 w-8 cursor-pointer hover:ring-2 hover:ring-accent/50 transition-all">
              <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                {user.initials}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span>{user.name}</span>
                <span className="text-xs font-normal text-muted-foreground">{user.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Profile Settings</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowPricing(true)}>Billing & Plans</DropdownMenuItem>
            <DropdownMenuItem>API Keys</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setIsFirstTimeUser(true)}>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Project Settings - hide in minimal mode */}
        {!minimal && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                variant="ghost" 
                size="icon"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setShowSettings('project')}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Project Settings</TooltipContent>
          </Tooltip>
        )}
      </div>
    </header>
  );
}
