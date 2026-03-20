import React, { useState, useCallback } from 'react';
import { Upload, X, FileText, FileType, File as FileIcon, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle, RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useApp } from '@/contexts/AppContext';
import { useUploadDocuments, useProcessDocument, isFileAllowed, DbDocument } from '@/hooks/useDocuments';
import { toast } from '@/hooks/use-toast';

interface UploadDocumentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete: () => void;
  context: 'project' | 'chat';
}

interface PendingFile {
  id: string;
  file: File;
  valid: boolean;
  error?: string;
  status: 'pending' | 'uploading' | 'processing' | 'completed' | 'failed';
  processingStage?: string;
  dbDoc?: DbDocument;
}

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

const STAGE_LABELS: Record<string, string> = {
  uploaded: 'Queued',
  extracting_metadata: 'Extracting metadata…',
  extracting_content: 'Analyzing content…',
  detecting_language: 'Detecting language…',
  summarizing: 'Generating summary…',
  indexing: 'Creating search index…',
  completed: 'Completed',
  failed: 'Failed',
};

export function UploadDocumentsDialog({
  open,
  onOpenChange,
  onUploadComplete,
  context,
}: UploadDocumentsDialogProps) {
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { selectedProjectId, selectedChatId } = useApp();
  const uploadMutation = useUploadDocuments();

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    const newPending: PendingFile[] = arr.map(file => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      valid: isFileAllowed(file.name),
      error: isFileAllowed(file.name) ? undefined : 'Unsupported file type',
      status: 'pending' as const,
    }));
    setPendingFiles(prev => [...prev, ...newPending]);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleRemove = (id: string) => {
    setPendingFiles(prev => prev.filter(f => f.id !== id));
  };

  const validFiles = pendingFiles.filter(f => f.valid);
  const hasFiles = pendingFiles.length > 0;
  const allDone = isProcessing && pendingFiles.filter(f => f.valid).every(f => f.status === 'completed' || f.status === 'failed');
  const isBusy = uploadMutation.isPending || isProcessing;

  const processDocument = async (doc: DbDocument, fileId: string) => {
    setPendingFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'processing' as const, processingStage: 'uploaded' } : f));

    // Poll for status updates while processing
    const pollInterval = setInterval(async () => {
      try {
        const { data } = await (await import('@/integrations/supabase/client')).supabase
          .from('documents' as any)
          .select('processing_status')
          .eq('id', doc.id)
          .single();
        if (data) {
          setPendingFiles(prev => prev.map(f =>
            f.id === fileId ? { ...f, processingStage: (data as any).processing_status } : f
          ));
        }
      } catch { /* ignore poll errors */ }
    }, 1500);

    try {
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-document`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ documentId: doc.id }),
        }
      );

      clearInterval(pollInterval);

      if (!resp.ok) {
        setPendingFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'failed' as const, processingStage: 'failed' } : f));
        return;
      }

      setPendingFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'completed' as const, processingStage: 'completed' } : f));
    } catch {
      clearInterval(pollInterval);
      setPendingFiles(prev => prev.map(f => f.id === fileId ? { ...f, status: 'failed' as const, processingStage: 'failed' } : f));
    }
  };

  const handleDone = async () => {
    if (!selectedProjectId || validFiles.length === 0) return;

    // Mark all valid files as uploading
    setPendingFiles(prev => prev.map(f => f.valid ? { ...f, status: 'uploading' as const } : f));

    try {
      const result = await uploadMutation.mutateAsync({
        files: validFiles.map(f => f.file),
        projectId: selectedProjectId,
        chatId: context === 'chat' ? selectedChatId : null,
      });

      const successCount = result.uploaded.length;

      if (result.errors.length > 0) {
        toast({
          title: `${result.errors.length} file${result.errors.length !== 1 ? 's' : ''} failed to upload`,
          description: result.errors.join(', '),
          variant: 'destructive',
        });
      }

      if (successCount === 0) return;

      // Map uploaded docs back to pending files and start processing
      setIsProcessing(true);
      const validFilesList = pendingFiles.filter(f => f.valid);

      // Match uploaded results to pending files by index
      const processingPromises: Promise<void>[] = [];
      for (let i = 0; i < result.uploaded.length; i++) {
        const doc = result.uploaded[i];
        const pf = validFilesList[i];
        if (pf && doc) {
          setPendingFiles(prev => prev.map(f => f.id === pf.id ? { ...f, dbDoc: doc } : f));
          processingPromises.push(processDocument(doc, pf.id));
        }
      }

      await Promise.all(processingPromises);

    } catch (err: any) {
      toast({
        title: 'Upload failed',
        description: err.message,
        variant: 'destructive',
      });
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    if (!isBusy || allDone) {
      const completedCount = pendingFiles.filter(f => f.status === 'completed').length;
      if (completedCount > 0) {
        toast({ title: `${completedCount} document${completedCount !== 1 ? 's' : ''} added to ${context}` });
      }
      setPendingFiles([]);
      setIsProcessing(false);
      onUploadComplete();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (!o && !isBusy) { setPendingFiles([]); setIsProcessing(false); onOpenChange(o); }
      else if (!o && allDone) { handleClose(); }
      else if (o) { onOpenChange(o); }
    }}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-accent" />
            Upload Documents
          </DialogTitle>
          <DialogDescription>
            Upload documents to attach to this {context}. Files will be analyzed and indexed for search.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4 py-4">
          {/* Drop zone */}
          {!isBusy && (
            <div
              className={cn(
                'relative border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
                isDragging ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50 hover:bg-accent/5'
              )}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
              onClick={() => document.getElementById('file-upload-real')?.click()}
            >
              <input
                id="file-upload-real"
                type="file"
                multiple
                accept=".pdf,.doc,.docx,.txt,.rtf,.csv,.xls,.xlsx,.md"
                onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }}
                className="hidden"
              />
              <Upload className={cn('h-10 w-10 mx-auto mb-3', isDragging ? 'text-accent' : 'text-muted-foreground')} />
              <p className="text-sm font-medium text-foreground mb-1">Drop files here or click to browse</p>
              <p className="text-xs text-muted-foreground">Supported: PDF, DOC, DOCX, TXT, RTF, CSV, XLS, XLSX, MD • Max 20 MB</p>
            </div>
          )}

          {/* File list */}
          {hasFiles && (
            <div className="flex-1 overflow-auto space-y-2 max-h-[280px]">
              {pendingFiles.map(pf => {
                const ext = pf.file.name.split('.').pop()?.toLowerCase() || '';
                const Icon = fileIcons[ext] || FileIcon;
                const color = fileColors[ext] || 'text-muted-foreground';

                return (
                  <div key={pf.id} className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border bg-card',
                    !pf.valid && 'border-destructive/30 bg-destructive/5',
                    pf.status === 'completed' && 'border-green-500/30 bg-green-500/5',
                    pf.status === 'failed' && 'border-destructive/30 bg-destructive/5',
                  )}>
                    <div className={cn('p-1.5 rounded bg-muted', color)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{pf.file.name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        {formatFileSize(pf.file.size)}
                        {pf.error && <span className="text-destructive ml-1">• {pf.error}</span>}
                        {pf.status === 'uploading' && (
                          <span className="text-accent ml-1 flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> Uploading…
                          </span>
                        )}
                        {pf.status === 'processing' && pf.processingStage && (
                          <span className="text-accent ml-1 flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin" /> {STAGE_LABELS[pf.processingStage] || pf.processingStage}
                          </span>
                        )}
                        {pf.status === 'completed' && (
                          <span className="text-green-600 ml-1 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Analyzed & indexed
                          </span>
                        )}
                        {pf.status === 'failed' && !pf.error && (
                          <span className="text-destructive ml-1 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" /> Processing failed
                          </span>
                        )}
                      </p>
                    </div>
                    {!isBusy && pf.status === 'pending' && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleRemove(pf.id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                    {pf.status === 'failed' && pf.dbDoc && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-accent"
                        onClick={() => processDocument(pf.dbDoc!, pf.id)}
                        title="Retry processing"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-between pt-4 border-t border-border">
          {allDone ? (
            <>
              <p className="text-xs text-muted-foreground self-center">
                {pendingFiles.filter(f => f.status === 'completed').length} analyzed,{' '}
                {pendingFiles.filter(f => f.status === 'failed').length} failed
              </p>
              <Button onClick={handleClose} className="bg-accent hover:bg-accent/90 text-accent-foreground">
                Done
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => { if (!isBusy) { setPendingFiles([]); setIsProcessing(false); onOpenChange(false); } }} disabled={isBusy && !allDone}>
                Cancel
              </Button>
              <Button
                onClick={handleDone}
                disabled={validFiles.length === 0 || isBusy}
                className="bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                {uploadMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Uploading…</>
                ) : isProcessing ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Processing…</>
                ) : (
                  <>Upload & Analyze ({validFiles.length})</>
                )}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
