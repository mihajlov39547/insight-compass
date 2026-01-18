import React, { useState, useCallback } from 'react';
import { Upload, X, FileText, FileType, File as FileIcon, FileSpreadsheet, Loader2, CheckCircle2 } from 'lucide-react';
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
import { Document, DocumentState } from '@/data/mockData';

interface UploadDocumentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete: (documents: Document[]) => void;
  context: 'project' | 'chat';
}

interface UploadingFile {
  id: string;
  file: File;
  document: Document;
}

const fileIcons = {
  pdf: FileText,
  docx: FileType,
  txt: FileIcon,
  xlsx: FileSpreadsheet,
};

const fileColors = {
  pdf: 'text-red-500',
  docx: 'text-blue-500',
  txt: 'text-gray-500',
  xlsx: 'text-green-500',
};

const ACCEPTED_FILE_TYPES = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'text/plain': ['.txt'],
};

const UPLOAD_DURATION = 2000;
const INDEXING_DURATION = 3000;

export function UploadDocumentsDialog({
  open,
  onOpenChange,
  onUploadComplete,
  context
}: UploadDocumentsDialogProps) {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const getFileType = (fileName: string): 'pdf' | 'docx' | 'txt' | 'xlsx' => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (ext === 'docx' || ext === 'doc') return 'docx';
    if (ext === 'txt') return 'txt';
    if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
    return 'txt';
  };

  const simulateUpload = async (uploadFile: UploadingFile) => {
    const startTime = Date.now();

    const updateProgress = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min((elapsed / UPLOAD_DURATION) * 100, 100);

      setUploadingFiles(prev =>
        prev.map(f =>
          f.id === uploadFile.id
            ? {
                ...f,
                document: {
                  ...f.document,
                  uploadProgress: Math.round(progress)
                }
              }
            : f
        )
      );

      if (progress < 100) {
        requestAnimationFrame(updateProgress);
      } else {
        setTimeout(() => startIndexing(uploadFile.id), 100);
      }
    };

    requestAnimationFrame(updateProgress);
  };

  const startIndexing = (fileId: string) => {
    setUploadingFiles(prev =>
      prev.map(f =>
        f.id === fileId
          ? {
              ...f,
              document: {
                ...f.document,
                state: 'indexing' as DocumentState,
                uploadProgress: 100
              }
            }
          : f
      )
    );

    setTimeout(() => completeIndexing(fileId), INDEXING_DURATION);
  };

  const completeIndexing = (fileId: string) => {
    setUploadingFiles(prev =>
      prev.map(f =>
        f.id === fileId
          ? {
              ...f,
              document: {
                ...f.document,
                state: 'ready' as DocumentState
              }
            }
          : f
      )
    );
  };

  const handleFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const validFiles = fileArray.filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      return ['pdf', 'docx', 'doc', 'txt', 'xlsx', 'xls'].includes(ext || '');
    });

    const newUploadingFiles: UploadingFile[] = validFiles.map(file => {
      const id = `upload-${Date.now()}-${Math.random()}`;
      const document: Document = {
        id,
        name: file.name,
        type: getFileType(file.name),
        size: formatFileSize(file.size),
        uploadedAt: new Date().toISOString(),
        state: 'uploading',
        uploadProgress: 0,
        usedInAnswers: false,
      };

      return { id, file, document };
    });

    setUploadingFiles(prev => [...prev, ...newUploadingFiles]);

    newUploadingFiles.forEach(uploadFile => {
      simulateUpload(uploadFile);
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const handleRemoveFile = (fileId: string) => {
    setUploadingFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const handleDone = () => {
    const completedDocuments = uploadingFiles
      .filter(f => f.document.state === 'ready')
      .map(f => f.document);

    if (completedDocuments.length > 0) {
      onUploadComplete(completedDocuments);
    }

    setUploadingFiles([]);
    onOpenChange(false);
  };

  const allFilesReady = uploadingFiles.length > 0 && uploadingFiles.every(f => f.document.state === 'ready');
  const hasFiles = uploadingFiles.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-accent" />
            Upload Documents
          </DialogTitle>
          <DialogDescription>
            Uploaded documents are indexed and used to generate accurate responses.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4 py-4">
          {!hasFiles ? (
            <div
              className={cn(
                'relative border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer',
                isDragging
                  ? 'border-accent bg-accent/5'
                  : 'border-border hover:border-accent/50 hover:bg-accent/5'
              )}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => document.getElementById('file-upload')?.click()}
            >
              <input
                id="file-upload"
                type="file"
                multiple
                accept=".pdf,.docx,.doc,.txt,.xlsx,.xls"
                onChange={handleFileInput}
                className="hidden"
              />

              <Upload className={cn(
                'h-12 w-12 mx-auto mb-4 transition-colors',
                isDragging ? 'text-accent' : 'text-muted-foreground'
              )} />

              <p className="text-sm font-medium text-foreground mb-1">
                Drop files here or click to browse
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                Maximum file size: 50MB per file
              </p>

              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium">Supported formats:</span>
                <span>PDF, DOCX, TXT</span>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto space-y-3">
              {uploadingFiles.map((uploadFile) => (
                <FileUploadItem
                  key={uploadFile.id}
                  uploadFile={uploadFile}
                  onRemove={handleRemoveFile}
                />
              ))}
            </div>
          )}

          {hasFiles && !allFilesReady && (
            <div className="text-center py-3 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Processing documents for semantic retrieval...
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-between pt-4 border-t border-border">
          <Button
            variant="outline"
            onClick={() => {
              setUploadingFiles([]);
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>

          <Button
            onClick={handleDone}
            disabled={!allFilesReady}
            className="bg-accent hover:bg-accent/90 text-accent-foreground"
          >
            Done ({uploadingFiles.filter(f => f.document.state === 'ready').length})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FileUploadItem({
  uploadFile,
  onRemove
}: {
  uploadFile: UploadingFile;
  onRemove: (id: string) => void;
}) {
  const { document } = uploadFile;
  const Icon = fileIcons[document.type] || FileIcon;
  const colorClass = fileColors[document.type] || 'text-gray-500';

  const getStateInfo = () => {
    switch (document.state) {
      case 'uploading':
        return {
          label: 'Uploading',
          icon: <Loader2 className="h-4 w-4 animate-spin text-accent" />,
          showProgress: true,
        };
      case 'indexing':
        return {
          label: 'Indexing',
          sublabel: 'Preparing for semantic retrieval',
          icon: <Loader2 className="h-4 w-4 animate-spin text-accent" />,
          showProgress: false,
        };
      case 'ready':
        return {
          label: 'Ready',
          icon: <CheckCircle2 className="h-4 w-4 text-success" />,
          showProgress: false,
        };
    }
  };

  const stateInfo = getStateInfo();
  const canRemove = document.state === 'ready';

  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border border-border bg-card">
      <div className={cn('p-2 rounded-lg bg-muted', colorClass)}>
        <Icon className="h-5 w-5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="text-sm font-medium text-foreground truncate">{document.name}</p>
          {canRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(uploadFile.id)}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <span>{document.type.toUpperCase()}</span>
          <span>•</span>
          <span>{document.size}</span>
        </div>

        {stateInfo.showProgress && document.uploadProgress !== undefined && (
          <div className="space-y-1.5">
            <Progress value={document.uploadProgress} className="h-1.5" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{stateInfo.label}</span>
              <span className="text-xs font-medium text-foreground">{document.uploadProgress}%</span>
            </div>
          </div>
        )}

        {!stateInfo.showProgress && (
          <div className="flex items-center gap-2">
            {stateInfo.icon}
            <div>
              <p className="text-xs font-medium text-foreground">{stateInfo.label}</p>
              {stateInfo.sublabel && (
                <p className="text-xs text-muted-foreground">{stateInfo.sublabel}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
