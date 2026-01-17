import React, { useState } from 'react';
import { Users, Copy, Check, Mail, Link2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useApp } from '@/contexts/AppContext';

// Mock shared users
const mockSharedUsers = [
  { id: 'user-2', name: 'Sarah Miller', email: 'sarah@company.com', initials: 'SM', role: 'Editor' },
  { id: 'user-3', name: 'James Wilson', email: 'james@company.com', initials: 'JW', role: 'Viewer' },
];

export function ShareDialog() {
  const { showShare, setShowShare, selectedProject, selectedChat } = useApp();
  const [email, setEmail] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const context = selectedChat ? selectedChat.name : selectedProject?.name || 'Project';

  return (
    <Dialog open={showShare} onOpenChange={setShowShare}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-accent" />
            Share "{context}"
          </DialogTitle>
          <DialogDescription>
            Invite team members to collaborate on this {selectedChat ? 'chat' : 'project'}.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-6">
          {/* Invite by email */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Invite by email</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Enter email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select defaultValue="editor">
                <SelectTrigger className="w-[110px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
                Invite
              </Button>
            </div>
          </div>

          {/* Copy link */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Or share via link</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  value="https://insightrag.app/share/abc123..."
                  readOnly
                  className="pl-9 bg-muted"
                />
              </div>
              <Button variant="outline" onClick={handleCopyLink} className="gap-2">
                {copied ? (
                  <>
                    <Check className="h-4 w-4 text-success" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Shared with */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">People with access</Label>
            <div className="space-y-2">
              {mockSharedUsers.map((user) => (
                <div 
                  key={user.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-secondary text-secondary-foreground text-xs">
                      {user.initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{user.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  </div>
                  <Select defaultValue={user.role.toLowerCase()}>
                    <SelectTrigger className="w-[100px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">Viewer</SelectItem>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="remove" className="text-destructive">Remove</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-border">
          <Button variant="outline" onClick={() => setShowShare(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
