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
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useApp } from '@/contexts/AppContext';
import { useUploadDocuments, isFileAllowed } from '@/hooks/useDocuments';
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
}

const fileIcons: Record<string, any> = {
  pdf: FileText,
  docx: FileType,
  doc: FileType,
  txt: FileIcon,
  xlsx: FileSpreadsheet,
  xls: FileSpreadsheet,
  csv: FileSpreadsheet,
  md: FileText,
  rtf: FileType,
};

const fileColors: Record<string, string> = {
  pdf: 'text-red-500',
  docx: 'text-blue-500',
  doc: 'text-blue-500',
  txt: 'text-muted-foreground',
  xlsx: 'text-green-500',
  xls: 'text-green-500',
  csv: 'text-green-500',
  md: 'text-violet-500',
  rtf: 'text-orange-500',
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
    const newPending: PendingFile[] = arr.map(file => {
      const valid = isFileAllowed(file.name);
      return {
        id: `${Date.now()}-${Math.random()}`,
        file,
        valid,
        error: valid ? undefined : 'Unsupported file type',
      };
    });
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

  const handleDone = async () => {
    if (!selectedProjectId || validFiles.length === 0) return;

    try {
      const result = await uploadMutation.mutateAsync({
        files: validFiles.map(f => f.file),
        projectId: selectedProjectId,
        chatId: context === 'chat' ? selectedChatId : null,
      });

      const successCount = result.uploaded.length;
      const errorCount = result.errors.length;

      if (successCount > 0) {
        toast({
          title: `${successCount} document${successCount !== 1 ? 's' : ''} uploaded successfully`,
        });
      }
      if (errorCount > 0) {
        toast({
          title: `${errorCount} file${errorCount !== 1 ? 's' : ''} failed to upload`,
          description: result.errors.join(', '),
          variant: 'destructive',
        });
      }

      setPendingFiles([]);
      onUploadComplete();
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: 'Upload failed',
        description: err.message,
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!uploadMutation.isPending) { if (!o) setPendingFiles([]); onOpenChange(o); } }}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-accent" />
            Upload Documents
          </DialogTitle>
          <DialogDescription>
            Upload documents to attach to this {context}. Supported: PDF, DOC, DOCX, TXT, RTF, CSV, XLS, XLSX, MD.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4 py-4">
          {/* Drop zone — always visible when not uploading */}
          {!uploadMutation.isPending && (
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
              <p className="text-xs text-muted-foreground">Max 20 MB per file</p>
            </div>
          )}

          {/* File list */}
          {hasFiles && (
            <div className="flex-1 overflow-auto space-y-2 max-h-[240px]">
              {pendingFiles.map(pf => {
                const ext = pf.file.name.split('.').pop()?.toLowerCase() || '';
                const Icon = fileIcons[ext] || FileIcon;
                const color = fileColors[ext] || 'text-muted-foreground';

                return (
                  <div key={pf.id} className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border bg-card',
                    !pf.valid && 'border-destructive/30 bg-destructive/5'
                  )}>
                    <div className={cn('p-1.5 rounded bg-muted', color)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{pf.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(pf.file.size)}
                        {pf.error && <span className="text-destructive ml-2">• {pf.error}</span>}
                      </p>
                    </div>
                    {!uploadMutation.isPending && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleRemove(pf.id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Uploading state */}
          {uploadMutation.isPending && (
            <div className="flex items-center justify-center gap-3 py-6">
              <Loader2 className="h-5 w-5 animate-spin text-accent" />
              <p className="text-sm text-muted-foreground">Uploading {validFiles.length} file{validFiles.length !== 1 ? 's' : ''}...</p>
            </div>
          )}
        </div>

        <div className="flex justify-between pt-4 border-t border-border">
          <Button variant="outline" onClick={() => { setPendingFiles([]); onOpenChange(false); }} disabled={uploadMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleDone}
            disabled={validFiles.length === 0 || uploadMutation.isPending}
            className="bg-accent hover:bg-accent/90 text-accent-foreground"
          >
            {uploadMutation.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Uploading...</>
            ) : (
              <>Upload ({validFiles.length})</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
