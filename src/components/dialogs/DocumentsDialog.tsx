import React, { useState } from 'react';
import { FileText, Upload, Trash2, File as FileIcon, FileType, FileSpreadsheet, Loader2, RotateCcw, CheckCircle2, AlertCircle, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useApp } from '@/contexts/AppContext';
import { useProjects } from '@/hooks/useProjects';
import { useChats } from '@/hooks/useChats';
import { useDocuments, useDeleteDocument, useRetryProcessing, DbDocument } from '@/hooks/useDocuments';
import { UploadDocumentsDialog } from './UploadDocumentsDialog';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

const fileIcons: Record<string, any> = {
  pdf: FileText, docx: FileType, doc: FileType, txt: FileIcon,
  xlsx: FileSpreadsheet, xls: FileSpreadsheet, csv: FileSpreadsheet,
  md: FileText, rtf: FileType,
};

const fileColors: Record<string, string> = {
  pdf: 'text-red-500', docx: 'text-blue-500', doc: 'text-blue-500',
  txt: 'text-muted-foreground', xlsx: 'text-green-500', xls: 'text-green-500',
  csv: 'text-green-500', md: 'text-violet-500', rtf: 'text-orange-500',
};

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function truncateFileName(name: string, maxBase = 30): string {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex === -1) return name.length > maxBase ? name.slice(0, maxBase) + '…' : name;
  const base = name.slice(0, dotIndex);
  const ext = name.slice(dotIndex);
  if (base.length <= maxBase) return name;
  return base.slice(0, maxBase) + '…' + ext;
}

function ProcessingBadge({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-green-500/10 text-green-700 border-green-500/20">
          <CheckCircle2 className="h-2.5 w-2.5" /> Analyzed
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-destructive/10 text-destructive border-destructive/20">
          <AlertCircle className="h-2.5 w-2.5" /> Failed
        </Badge>
      );
    case 'uploaded':
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1">
          Pending
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-1 bg-accent/10 text-accent border-accent/20">
          <Loader2 className="h-2.5 w-2.5 animate-spin" /> Processing
        </Badge>
      );
  }
}

export function DocumentsDialog() {
  const { showDocuments, setShowDocuments, selectedProjectId, selectedChatId, documentScope } = useApp();
  const { data: projects = [] } = useProjects();
  const { data: chats = [] } = useChats(selectedProjectId ?? undefined);
  const [showUpload, setShowUpload] = useState(false);

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const selectedChat = chats.find(c => c.id === selectedChatId);

  const isProjectScope = documentScope === 'project';
  const scopeLabel = isProjectScope ? selectedProject?.name : selectedChat?.name;

  const { data: documents = [], isLoading } = useDocuments(
    selectedProjectId ?? undefined,
    isProjectScope ? null : selectedChatId,
  );

  const deleteMutation = useDeleteDocument();
  const { retry: retryProcessing, isPending: isRetrying } = useRetryProcessing();

  const handleDelete = (doc: DbDocument) => {
    deleteMutation.mutate(doc, {
      onSuccess: () => toast({ title: `${doc.file_name} deleted` }),
      onError: (err: any) => toast({ title: 'Delete failed', description: err.message, variant: 'destructive' }),
    });
  };

  return (
    <>
      <Dialog open={showDocuments} onOpenChange={setShowDocuments}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-accent" />
              {isProjectScope ? 'Project Documents' : 'Chat Documents'}
              {scopeLabel && (
                <Badge variant="secondary" className="ml-2 font-normal">
                  {scopeLabel}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Button variant="outline" className="w-full mb-4 gap-2 border-2 border-dashed hover:border-accent hover:bg-accent/5" onClick={() => setShowUpload(true)}>
              <Upload className="h-4 w-4" /> Upload Documents
            </Button>
            <ScrollArea className="h-[300px]">
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : documents.length === 0 ? (
                <div className="text-center py-8">
                  <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No documents uploaded yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {documents.map(doc => {
                    const Icon = fileIcons[doc.file_type] || FileIcon;
                    const color = fileColors[doc.file_type] || 'text-muted-foreground';
                    return (
                      <div key={doc.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
                        <div className={cn('p-1.5 rounded bg-muted', color)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground truncate" title={doc.file_name}>{truncateFileName(doc.file_name)}</p>
                            <ProcessingBadge status={doc.processing_status} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {doc.file_type.toUpperCase()} • {formatFileSize(doc.file_size)}
                            {doc.word_count ? ` • ${doc.word_count.toLocaleString()} words` : ''}
                            {doc.detected_language ? ` • ${doc.detected_language.toUpperCase()}` : ''}
                            {' • '}{new Date(doc.created_at).toLocaleDateString()}
                          </p>
                          {doc.summary && (
                            <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2">{doc.summary}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {doc.processing_status === 'failed' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-accent"
                              onClick={() => retryProcessing(doc)}
                              disabled={isRetrying}
                              title="Retry processing"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDelete(doc)}
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
          <div className="flex justify-between pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground">
              {documents.length} document{documents.length !== 1 ? 's' : ''}
              {documents.filter(d => d.processing_status === 'completed').length > 0 && (
                <span className="ml-1">• {documents.filter(d => d.processing_status === 'completed').length} analyzed</span>
              )}
            </p>
            <Button variant="outline" onClick={() => setShowDocuments(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>
      <UploadDocumentsDialog
        open={showUpload}
        onOpenChange={setShowUpload}
        onUploadComplete={() => {}}
        context={isProjectScope ? 'project' : 'chat'}
      />
    </>
  );
}
