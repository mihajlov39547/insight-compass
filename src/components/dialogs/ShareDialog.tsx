import React, { useState } from 'react';
import { Users, Copy, Check, Mail, Link2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useApp } from '@/contexts/AppContext';
import { useProjects } from '@/hooks/useProjects';
import { useNotebooks } from '@/hooks/useNotebooks';

export function ShareDialog() {
  const { showShare, setShowShare, selectedProjectId, selectedNotebookId, activeView } = useApp();
  const { data: projects = [] } = useProjects();
  const { data: notebooks = [] } = useNotebooks();
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState(false);

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const selectedNotebook = notebooks.find(n => n.id === selectedNotebookId);

  const handleCopyLink = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const isNotebook = activeView === 'notebook-workspace';
  const context = isNotebook ? selectedNotebook?.name || 'Notebook' : selectedProject?.name || 'Project';
  const entityType = isNotebook ? 'notebook' : 'project';

  return (
    <Dialog open={showShare} onOpenChange={setShowShare}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-accent" />Share "{context}"
          </DialogTitle>
          <DialogDescription>Invite team members to collaborate on this {selectedChat ? 'chat' : 'project'}.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-6">
          <div className="space-y-3">
            <Label className="text-sm font-medium">Invite by email</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Enter email address" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" />
              </div>
              <Select defaultValue="editor">
                <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">Invite</Button>
            </div>
          </div>
          <div className="space-y-3">
            <Label className="text-sm font-medium">Or share via link</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value="https://insightnavigator.app/share/abc123..." readOnly className="pl-9 bg-muted" />
              </div>
              <Button variant="outline" onClick={handleCopyLink} className="gap-2">
                {copied ? <><Check className="h-4 w-4 text-success" />Copied</> : <><Copy className="h-4 w-4" />Copy</>}
              </Button>
            </div>
          </div>
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">Sharing will be available in a future update.</p>
          </div>
        </div>
        <div className="flex justify-end pt-4 border-t border-border">
          <Button variant="outline" onClick={() => setShowShare(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
