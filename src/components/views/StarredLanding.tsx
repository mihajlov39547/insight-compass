import React from 'react';
import { Star } from 'lucide-react';

export function StarredLanding() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
        <Star className="h-8 w-8 text-primary" />
      </div>
      <h1 className="text-2xl font-bold text-foreground mb-2">Starred</h1>
      <p className="text-muted-foreground text-center max-w-md">
        Your starred projects, notebooks, and chats will appear here. Star important items to access them quickly.
      </p>
    </div>
  );
}
