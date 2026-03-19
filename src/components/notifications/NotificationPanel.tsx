import React from 'react';
import { Inbox, Sparkles, X } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';

const whatsNewItems = [
  {
    id: '1',
    title: 'Smart Document Summarization',
    description: 'Automatically generate concise summaries from uploaded documents using advanced AI. Save time by extracting key insights without reading entire files.',
    image: 'https://images.unsplash.com/photo-1488590528505-98d2b5aba04b?w=120&h=80&fit=crop',
    publishedAt: '3 days ago',
  },
  {
    id: '2',
    title: 'Multi-language Chat Support',
    description: 'Chat with your knowledge base in multiple languages. Our assistant now supports seamless switching between English and Serbian with improved accuracy.',
    image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=120&h=80&fit=crop',
    publishedAt: '1 week ago',
  },
  {
    id: '3',
    title: 'Collaborative Workspaces',
    description: 'Share projects with team members and collaborate in real-time. New permission controls let you manage who can view, edit, or manage your knowledge bases.',
    image: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=120&h=80&fit=crop',
    publishedAt: '2 weeks ago',
  },
];

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
}

export function NotificationPanel({ open, onClose }: NotificationPanelProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-md bg-card border-l border-border shadow-xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-foreground">Notifications</h2>
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
                Inbox
              </TabsTrigger>
              <TabsTrigger value="whats-new" className="flex-1 gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                What's New
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Inbox Tab */}
          <TabsContent value="inbox" className="flex-1 m-0">
            <ScrollArea className="h-full">
              <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Inbox className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground mb-1">
                  No messages or invites pending
                </p>
                <p className="text-xs text-muted-foreground max-w-[240px]">
                  Messages, workspace and project invitations will appear here
                </p>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* What's New Tab */}
          <TabsContent value="whats-new" className="flex-1 m-0">
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-1 p-2">
                {whatsNewItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-foreground mb-1 leading-snug">
                        {item.title}
                      </h3>
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
                        {item.description}
                      </p>
                      <p className="text-[11px] text-muted-foreground/70 mt-2">
                        {item.publishedAt}
                      </p>
                    </div>
                    <img
                      src={item.image}
                      alt={item.title}
                      className="w-20 h-14 rounded-md object-cover shrink-0 mt-0.5"
                    />
                  </div>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
