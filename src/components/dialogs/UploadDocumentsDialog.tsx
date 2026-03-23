import React, { useState, useCallback } from 'react';
import { Upload, X, FileText, FileType, File as FileIcon, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
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
import { useUploadDocuments, isFileAllowed } from '@/hooks/useDocuments';
import { toast } from '@/hooks/use-toast';

interface UploadDocumentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete: () => void;
  context: 'project' | 'chat' | 'notebook';
}

interface PendingFile {
  id: string;
  file: File;
  valid: boolean;
  error?: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
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

export function UploadDocumentsDialog({
  open,
  onOpenChange,
  onUploadComplete,
  context,
}: UploadDocumentsDialogProps) {
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
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

  const handleDone = async () => {
    if (!selectedProjectId || validFiles.length === 0) return;

    setPendingFiles(prev => prev.map(f => f.valid ? { ...f, status: 'uploading' as const } : f));

    try {
      const result = await uploadMutation.mutateAsync({
        files: validFiles.map(f => f.file),
        projectId: selectedProjectId,
        chatId: context === 'chat' ? selectedChatId : null,
      });

      if (result.errors.length > 0) {
        toast({
          title: `${result.errors.length} file${result.errors.length !== 1 ? 's' : ''} failed to upload`,
          description: result.errors.join(', '),
          variant: 'destructive',
        });
      }

      const successCount = result.uploaded.length;
      if (successCount > 0) {
        toast({
          title: `${successCount} document${successCount !== 1 ? 's' : ''} uploaded and processing started`,
        });
      }

      // Close modal immediately — processing continues in background
      setPendingFiles([]);
      onUploadComplete();
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: 'Upload failed',
        description: err.message,
        variant: 'destructive',
      });
      setPendingFiles(prev => prev.map(f => f.status === 'uploading' ? { ...f, status: 'failed' as const } : f));
    }
  };

  const isBusy = uploadMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (!o && !isBusy) { setPendingFiles([]); onOpenChange(o); }
      else if (o) { onOpenChange(o); }
    }}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-accent" />
            Upload Documents
          </DialogTitle>
          <DialogDescription>
            Upload documents to attach to this {context}. Files will be analyzed and indexed in the background.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4 py-4">
          {/* Drop zone */}
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

          {/* File list */}
          {pendingFiles.length > 0 && (
            <div className="flex-1 overflow-auto space-y-2 max-h-[280px]">
              {pendingFiles.map(pf => {
                const ext = pf.file.name.split('.').pop()?.toLowerCase() || '';
                const Icon = fileIcons[ext] || FileIcon;
                const color = fileColors[ext] || 'text-muted-foreground';

                return (
                  <div key={pf.id} className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border bg-card',
                    !pf.valid && 'border-destructive/30 bg-destructive/5',
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
                        {pf.status === 'failed' && !pf.error && (
                          <span className="text-destructive ml-1 flex items-center gap-1">
                            <AlertCircle className="h-3 w-3" /> Upload failed
                          </span>
                        )}
                      </p>
                    </div>
                    {!isBusy && pf.status === 'pending' && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleRemove(pf.id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4 border-t border-border">
          <Button variant="outline" onClick={() => { if (!isBusy) { setPendingFiles([]); onOpenChange(false); } }} disabled={isBusy}>
            Cancel
          </Button>
          <Button
            onClick={handleDone}
            disabled={validFiles.length === 0 || isBusy}
            className="bg-accent hover:bg-accent/90 text-accent-foreground"
          >
            {isBusy ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Uploading…</>
            ) : (
              <>Upload ({validFiles.length})</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
