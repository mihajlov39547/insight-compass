import React, { useState } from 'react';
import { Users, Copy, Check, Mail, Link2, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useApp } from '@/contexts/useApp';
import { useProjects } from '@/hooks/useProjects';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useAuth } from '@/contexts/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function ShareDialog() {
  const { showShare, setShowShare, selectedProjectId, selectedNotebookId, activeView } = useApp();
  const { data: projects = [] } = useProjects();
  const { data: notebooks = [] } = useNotebooks();
  const { user, profile } = useAuth();
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState('editor');
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const selectedNotebook = notebooks.find(n => n.id === selectedNotebookId);

  const handleCopyLink = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const isNotebook = activeView === 'notebook-workspace';
  const context = isNotebook ? selectedNotebook?.name || 'Notebook' : selectedProject?.name || 'Project';
  const entityType = isNotebook ? 'notebook' : 'project';
  const itemId = isNotebook ? selectedNotebookId : selectedProjectId;

  const handleInvite = async () => {
    if (!email.trim() || !user || !itemId) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      toast.error('Please enter a valid email address');
      return;
    }

    setSending(true);
    try {
      const inviterName = profile?.full_name || profile?.username || user.email || 'A team member';
      const inviteId = crypto.randomUUID();

      // Look up the invited user by email to get their user_id
      const { data: invitedProfile } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();

      // Only create share record if the user exists in the system
      if (invitedProfile?.user_id) {
        const { error: shareError } = await supabase.from('shares').insert({
          id: inviteId,
          item_id: itemId,
          item_type: entityType,
          permission,
          shared_by_user_id: user.id,
          shared_with_user_id: invitedProfile.user_id,
        });

        if (shareError) {
          if (shareError.code === '23505') {
            toast.info('This user already has access');
          } else {
            console.error('Share insert error:', shareError);
            toast.error('Failed to create share');
          }
          return;
        }
      }

      // Send invitation email
      const { data, error: emailError } = await supabase.functions.invoke('send-transactional-email', {
        body: {
          templateName: 'share-invitation',
          recipientEmail: email.trim(),
          idempotencyKey: `share-invite-${inviteId}`,
          templateData: {
            inviterName,
            itemName: context,
            itemType: entityType,
            permission,
            acceptUrl: window.location.origin,
          },
        },
      });

      if (emailError) {
        console.error('Email send error:', emailError);
        toast.warning('Invitation email could not be sent');
      } else {
        toast.success(`Invitation sent to ${email.trim()}`);
      }

      setEmail('');
    } catch (err: any) {
      console.error('Invite error:', err);
      toast.error('Failed to send invitation');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={showShare} onOpenChange={setShowShare}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-accent" />Share "{context}"
          </DialogTitle>
          <DialogDescription>Invite team members to collaborate on this {entityType}.</DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-6">
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
                  type="email"
                  disabled={sending}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleInvite(); } }}
                />
              </div>
              <Select value={permission} onValueChange={setPermission}>
                <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
              <Button
                className="bg-accent hover:bg-accent/90 text-accent-foreground"
                onClick={handleInvite}
                disabled={!email.trim() || sending}
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Invite'}
              </Button>
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
        </div>
        <div className="flex justify-end pt-4 border-t border-border">
          <Button variant="outline" onClick={() => setShowShare(false)}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
