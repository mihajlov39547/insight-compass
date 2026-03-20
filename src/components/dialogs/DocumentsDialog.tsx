import React, { useState } from 'react';
import { FileText, Upload, Trash2, Download, File, FileSpreadsheet, FileType, Loader2, CheckCircle2, MessageSquare } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useApp } from '@/contexts/AppContext';
import { useProjects } from '@/hooks/useProjects';
import { useChats } from '@/hooks/useChats';
import { UploadDocumentsDialog } from './UploadDocumentsDialog';
import { cn } from '@/lib/utils';
import { Document } from '@/data/mockData';

export function DocumentsDialog() {
  const { showDocuments, setShowDocuments, selectedProjectId, selectedChatId } = useApp();
  const { data: projects = [] } = useProjects();
  const { data: chats = [] } = useChats(selectedProjectId ?? undefined);
  const [showUpload, setShowUpload] = useState(false);

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const selectedChat = chats.find(c => c.id === selectedChatId);

  // Documents feature not yet backed by DB — show empty state for now
  const documents: Document[] = [];
  const context = selectedChat ? 'chat' : selectedProject ? 'project' : 'all';

  return (
    <>
      <Dialog open={showDocuments} onOpenChange={setShowDocuments}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-accent" />
              Documents
              {context !== 'all' && (
                <Badge variant="secondary" className="ml-2 font-normal">
                  {context === 'chat' ? selectedChat?.name : selectedProject?.name}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Button variant="outline" className="w-full mb-4 gap-2 border-2 border-dashed hover:border-accent hover:bg-accent/5" onClick={() => setShowUpload(true)}>
              <Upload className="h-4 w-4" /> Upload Documents
            </Button>
            <ScrollArea className="h-[300px]">
              <div className="text-center py-8">
                <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No documents uploaded yet</p>
              </div>
            </ScrollArea>
          </div>
          <div className="flex justify-between pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground">{documents.length} documents</p>
            <Button variant="outline" onClick={() => setShowDocuments(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>
      <UploadDocumentsDialog
        open={showUpload}
        onOpenChange={setShowUpload}
        onUploadComplete={() => {}}
        context={context === 'chat' ? 'chat' : 'project'}
      />
    </>
  );
}
