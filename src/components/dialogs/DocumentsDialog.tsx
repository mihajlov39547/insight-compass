import React from 'react';
import { 
  FileText, 
  Upload, 
  Trash2, 
  Download, 
  File,
  FileSpreadsheet,
  FileType
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useApp } from '@/contexts/AppContext';
import { mockDocuments, Document } from '@/data/mockData';
import { cn } from '@/lib/utils';

const fileIcons = {
  pdf: FileText,
  docx: FileType,
  txt: File,
  xlsx: FileSpreadsheet,
};

const fileColors = {
  pdf: 'text-red-500',
  docx: 'text-blue-500',
  txt: 'text-gray-500',
  xlsx: 'text-green-500',
};

export function DocumentsDialog() {
  const { showDocuments, setShowDocuments, selectedProject, selectedChat } = useApp();

  // Determine which documents to show
  const documents = selectedChat?.documents || selectedProject?.documents || mockDocuments;
  const context = selectedChat ? 'chat' : selectedProject ? 'project' : 'all';

  return (
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
          {/* Upload Area */}
          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center mb-4 hover:border-accent/50 transition-colors cursor-pointer">
            <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium text-foreground">Drop files here or click to upload</p>
            <p className="text-xs text-muted-foreground mt-1">
              Supports PDF, DOCX, TXT, XLSX (max 50MB)
            </p>
          </div>

          {/* Documents List */}
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {documents.length === 0 ? (
                <div className="text-center py-8">
                  <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No documents uploaded yet</p>
                </div>
              ) : (
                documents.map((doc) => (
                  <DocumentItem key={doc.id} document={doc} />
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="flex justify-between pt-4 border-t border-border">
          <p className="text-xs text-muted-foreground">
            {documents.length} document{documents.length !== 1 ? 's' : ''} • {calculateTotalSize(documents)}
          </p>
          <Button variant="outline" onClick={() => setShowDocuments(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DocumentItem({ document }: { document: Document }) {
  const Icon = fileIcons[document.type] || File;
  const colorClass = fileColors[document.type] || 'text-gray-500';

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-secondary/50 transition-colors group">
      <div className={cn("p-2 rounded-lg bg-muted", colorClass)}>
        <Icon className="h-5 w-5" />
      </div>
      
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{document.name}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{document.type.toUpperCase()}</span>
          <span>•</span>
          <span>{document.size}</span>
          <span>•</span>
          <span>{document.uploadedAt}</span>
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
          <Download className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function calculateTotalSize(documents: Document[]): string {
  const totalKB = documents.reduce((acc, doc) => {
    const size = parseFloat(doc.size);
    const unit = doc.size.replace(/[\d.]/g, '').trim().toUpperCase();
    if (unit === 'MB') return acc + size * 1024;
    if (unit === 'KB') return acc + size;
    return acc;
  }, 0);

  if (totalKB >= 1024) {
    return `${(totalKB / 1024).toFixed(1)} MB`;
  }
  return `${totalKB.toFixed(0)} KB`;
}
