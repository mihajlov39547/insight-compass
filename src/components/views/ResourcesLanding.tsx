import React from 'react';
import { FileText, Upload } from 'lucide-react';

export function ResourcesLanding() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
        <FileText className="h-8 w-8 text-primary" />
      </div>
      <h1 className="text-2xl font-bold text-foreground mb-2">Resources</h1>
      <p className="text-muted-foreground text-center max-w-md">
        Browse and manage all your documents across projects and notebooks. Upload documents to any project or notebook to get started.
      </p>
    </div>
  );
}
