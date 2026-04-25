import React from 'react';
import { ExternalLink, Inbox, Loader2, Mail, MailOpen, Sparkles, X } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { useWhatsNewArticles } from '@/hooks/useWhatsNewArticles';
import { useInboxMessages, useSetInboxMessageReadState, type InboxMessage } from '@/hooks/useInboxMessages';

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
}

function formatRelativeDate(dateValue: string, language: string) {
  const publishedAt = new Date(dateValue).getTime();
  const diffSeconds = Math.round((publishedAt - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });

  if (absSeconds < 60) return formatter.format(diffSeconds, 'second');

  const diffMinutes = Math.round(diffSeconds / 60);
  if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, 'minute');

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, 'hour');

  const diffDays = Math.round(diffHours / 24);
  if (Math.abs(diffDays) < 14) return formatter.format(diffDays, 'day');

  const diffWeeks = Math.round(diffDays / 7);
  if (Math.abs(diffWeeks) < 8) return formatter.format(diffWeeks, 'week');

  const diffMonths = Math.round(diffDays / 30);
  if (Math.abs(diffMonths) < 12) return formatter.format(diffMonths, 'month');

  return formatter.format(Math.round(diffDays / 365), 'year');
}

export function NotificationPanel({ open, onClose }: NotificationPanelProps) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || 'en';
  const {
    data: inboxMessages = [],
    isLoading: inboxLoading,
    isError: inboxError,
  } = useInboxMessages(open);
  const setInboxMessageReadState = useSetInboxMessageReadState();
  const {
    data: whatsNewItems = [],
    isLoading,
    isError,
  } = useWhatsNewArticles(language, open);

  if (!open) return null;

  const openInboxAction = (message: InboxMessage) => {
    if (!message.action_url) return;
    setInboxMessageReadState.mutate({ id: message.id, read: true });
    window.location.href = message.action_url;
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto h-full w-full max-w-md bg-card border-l border-border shadow-xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-foreground">{t('notifications.title')}</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="inbox" className="flex-1 flex flex-col min-h-0">
          <div className="px-5 pt-3 shrink-0">
            <TabsList className="w-full">
              <TabsTrigger value="inbox" className="flex-1 gap-1.5">
                <Inbox className="h-3.5 w-3.5" />
                {t('notifications.tabs.inbox')}
              </TabsTrigger>
              <TabsTrigger value="whats-new" className="flex-1 gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                {t('notifications.tabs.whatsNew')}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Inbox Tab */}
          <TabsContent value="inbox" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full min-h-0">
              {inboxLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : inboxError ? (
                <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                    <Inbox className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">
                    {t('notifications.inbox.errorTitle')}
                  </p>
                  <p className="text-xs text-muted-foreground max-w-[240px]">
                    {t('notifications.inbox.errorDescription')}
                  </p>
                </div>
              ) : inboxMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                    <Inbox className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">
                    {t('notifications.inbox.emptyTitle')}
                  </p>
                  <p className="text-xs text-muted-foreground max-w-[240px]">
                    {t('notifications.inbox.emptyDescription')}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-1 p-2">
                  {inboxMessages.map((message) => {
                    const isUnread = !message.read_at;
                    return (
                      <div
                        key={message.id}
                        className="rounded-lg p-3 transition-colors hover:bg-muted/50"
                      >
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isUnread ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}>
                            {isUnread ? <Mail className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className={`text-sm leading-snug ${isUnread ? 'font-semibold text-foreground' : 'font-medium text-foreground'}`}>
                                {message.title}
                              </h3>
                              {isUnread && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-accent" />}
                            </div>
                            {message.body && (
                              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                {message.body}
                              </p>
                            )}
                            <p className="mt-2 text-[11px] text-muted-foreground/70">
                              {formatRelativeDate(message.created_at, language)}
                            </p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {message.action_url && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 gap-1.5 px-2 text-xs"
                                  onClick={() => openInboxAction(message)}
                                >
                                  {message.action_label || t('notifications.inbox.openAction')}
                                  <ExternalLink className="h-3 w-3" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-muted-foreground"
                                disabled={setInboxMessageReadState.isPending}
                                onClick={() => setInboxMessageReadState.mutate({
                                  id: message.id,
                                  read: isUnread,
                                })}
                              >
                                {isUnread
                                  ? t('notifications.inbox.markRead')
                                  : t('notifications.inbox.markUnread')}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* What's New Tab */}
          <TabsContent value="whats-new" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full min-h-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : isError ? (
                <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                    <Sparkles className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">
                    {t('notifications.whatsNew.errorTitle')}
                  </p>
                  <p className="text-xs text-muted-foreground max-w-[240px]">
                    {t('notifications.whatsNew.errorDescription')}
                  </p>
                </div>
              ) : whatsNewItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                    <Sparkles className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">
                    {t('notifications.whatsNew.emptyTitle')}
                  </p>
                  <p className="text-xs text-muted-foreground max-w-[240px]">
                    {t('notifications.whatsNew.emptyDescription')}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-1 p-2">
                  {whatsNewItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-medium text-foreground mb-1 leading-snug">
                          {item.title}
                        </h3>
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                          {item.description}
                        </p>
                        <p className="text-[11px] text-muted-foreground/70 mt-2">
                          {formatRelativeDate(item.publishedAt, language)}
                        </p>
                      </div>
                      {item.imageUrl && (
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          className="w-20 h-14 rounded-md object-cover shrink-0 mt-0.5"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
