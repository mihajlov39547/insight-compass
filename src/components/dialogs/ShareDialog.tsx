import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users, Copy, Check, Mail, Link2, Loader2, Crown, Shield, Pencil, Eye, Trash2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useApp } from '@/contexts/useApp';
import { useProjects } from '@/hooks/useProjects';
import { useNotebooks } from '@/hooks/useNotebooks';
import { useAuth } from '@/contexts/useAuth';
import { useItemRole, useShareMembers, ShareMember } from '@/hooks/useItemRole';
import { getItemPermissions, getRoleLabel, type ItemRole } from '@/lib/permissions';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

export function ShareDialog() {
  const { t } = useTranslation();
  const { showShare, setShowShare, selectedProjectId, selectedNotebookId, activeView } = useApp();
  const { data: projects = [] } = useProjects();
  const { data: notebooks = [] } = useNotebooks();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState('editor');
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);

  const isNotebook = activeView === 'notebook-workspace';
  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const selectedNotebook = notebooks.find(n => n.id === selectedNotebookId);
  const context = isNotebook ? selectedNotebook?.name || t('shareDialog.fallback.notebook') : selectedProject?.name || t('shareDialog.fallback.project');
  const entityType = isNotebook ? 'notebook' : 'project';
  const itemId = isNotebook ? selectedNotebookId : selectedProjectId;

  const { data: myRole } = useItemRole(itemId, entityType as 'project' | 'notebook');
  const permissions = getItemPermissions(myRole);
  const { data: members = [], refetch: refetchMembers } = useShareMembers(itemId, entityType as 'project' | 'notebook');

  // Find owner info
  const ownerUserId = isNotebook ? selectedNotebook?.user_id : selectedProject?.user_id;

  const handleCopyLink = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const handleInvite = async () => {
    if (!email.trim() || !user || !itemId) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      toast.error(t('shareDialog.toasts.invalidEmail'));
      return;
    }

    setSending(true);
    try {
      const inviterName = profile?.full_name || profile?.username || user.email || t('shareDialog.pending');
      const inviteId = crypto.randomUUID();

      const { data: invitedProfile } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();

      const sharePayload: any = {
        id: inviteId,
        item_id: itemId,
        item_type: entityType,
        permission,
        shared_by_user_id: user.id,
        shared_with_email: email.trim().toLowerCase(),
      };
      if (invitedProfile?.user_id) {
        sharePayload.shared_with_user_id = invitedProfile.user_id;
      }

      const { error: shareError } = await supabase.from('shares').insert(sharePayload);

      if (shareError) {
        if (shareError.code === '23505') {
          toast.info(t('shareDialog.toasts.alreadyAccess'));
        } else {
          console.error('Share insert error:', shareError);
          toast.error(t('shareDialog.toasts.createFailed'));
        }
        setSending(false);
        return;
      }

      // Send invitation email
      await supabase.functions.invoke('send-transactional-email', {
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

      toast.success(t('shareDialog.toasts.invitationSent', { email: email.trim() }));
      setEmail('');
      refetchMembers();
      queryClient.invalidateQueries({ queryKey: ['shared-items'] });
    } catch (err: any) {
      console.error('Invite error:', err);
      toast.error(t('shareDialog.toasts.invitationFailed'));
    } finally {
      setSending(false);
    }
  };

  const handleChangeRole = async (shareId: string, newRole: string) => {
    const { error } = await supabase.from('shares').update({ permission: newRole }).eq('id', shareId);
    if (error) {
      toast.error(t('shareDialog.toasts.roleUpdateFailed'));
      return;
    }
    toast.success(t('shareDialog.toasts.roleUpdated'));
    refetchMembers();
    queryClient.invalidateQueries({ queryKey: ['item-role'] });
  };

  const handleRemoveAccess = async (shareId: string, memberName: string) => {
    const { error } = await supabase.from('shares').delete().eq('id', shareId);
    if (error) {
      toast.error(t('shareDialog.toasts.removeFailed'));
      return;
    }
    toast.success(t('shareDialog.toasts.removed', { name: memberName }));
    refetchMembers();
    queryClient.invalidateQueries({ queryKey: ['shared-items'] });
    queryClient.invalidateQueries({ queryKey: ['item-role'] });
  };

  const canManage = permissions.canManageSharing;

  return (
    <Dialog open={showShare} onOpenChange={setShowShare}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-accent" />{t('shareDialog.shareTitle', { context })}
          </DialogTitle>
          <DialogDescription>
            {canManage
              ? t('shareDialog.manageDescription', { type: t(`shareDialog.types.${entityType}`) })
              : t('shareDialog.viewDescription', { type: t(`shareDialog.types.${entityType}`) })}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-6">
          {/* Invite section — admin+ only */}
          {canManage && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">{t('shareDialog.inviteByEmail')}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={t('shareDialog.emailPlaceholder')}
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
                    <SelectItem value="viewer">{t('shareDialog.viewer')}</SelectItem>
                    <SelectItem value="editor">{t('shareDialog.editor')}</SelectItem>
                    <SelectItem value="admin">{t('shareDialog.admin')}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  className="bg-accent hover:bg-accent/90 text-accent-foreground"
                  onClick={handleInvite}
                  disabled={!email.trim() || sending}
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : t('shareDialog.invite')}
                </Button>
              </div>
            </div>
          )}

          {/* Members list */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">
              {t('shareDialog.peopleAccess', { count: members.length + 1 })}
            </Label>

            <div className="space-y-1">
              {/* Owner row */}
              <OwnerRow ownerUserId={ownerUserId} isCurrentUser={user?.id === ownerUserId} />

              {/* Shared members */}
              {members.map((member) => (
                <MemberRow
                  key={member.shareId}
                  member={member}
                  canManage={canManage}
                  isCurrentUser={member.userId === user?.id}
                  ownerUserId={ownerUserId}
                  onChangeRole={handleChangeRole}
                  onRemove={handleRemoveAccess}
                />
              ))}
            </div>
          </div>

          {/* Role explanation */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <p className="text-xs font-medium text-foreground">{t('shareDialog.rolePermissions')}</p>
            <div className="grid grid-cols-1 gap-1.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Eye className="h-3 w-3 shrink-0" />
                <span><strong>{t('shareDialog.viewer')}</strong> — {t('shareDialog.viewerHelp')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Pencil className="h-3 w-3 shrink-0" />
                <span><strong>{t('shareDialog.editor')}</strong> — {t('shareDialog.editorHelp')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Shield className="h-3 w-3 shrink-0" />
                <span><strong>{t('shareDialog.admin')}</strong> — {t('shareDialog.adminHelp')}</span>
              </div>
            </div>
          </div>

          {/* Copy link */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">{t('shareDialog.shareViaLink')}</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={`${window.location.origin}/?shared=${itemId}`} readOnly className="pl-9 bg-muted text-xs" />
              </div>
              <Button variant="outline" onClick={handleCopyLink} className="gap-2">
                {copied ? <><Check className="h-4 w-4 text-green-500" />{t('shareDialog.copied')}</> : <><Copy className="h-4 w-4" />{t('shareDialog.copy')}</>}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t border-border">
          <Button variant="outline" onClick={() => setShowShare(false)}>{t('shareDialog.done')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OwnerRow({ ownerUserId, isCurrentUser }: { ownerUserId?: string; isCurrentUser: boolean }) {
  const { t } = useTranslation();
  const { data: ownerProfile } = useOwnerProfile(ownerUserId);
  const name = ownerProfile?.full_name || ownerProfile?.username || ownerProfile?.email || t('shareDialog.owner');
  const initials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-card">
      <Avatar className="h-8 w-8">
        {ownerProfile?.avatar_url && <AvatarImage src={ownerProfile.avatar_url} />}
        <AvatarFallback className="text-xs bg-primary/10 text-primary">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {name} {isCurrentUser && <span className="text-muted-foreground">{t('shareDialog.you')}</span>}
        </p>
        {ownerProfile?.email && (
          <p className="text-xs text-muted-foreground truncate">{ownerProfile.email}</p>
        )}
      </div>
      <Badge variant="default" className="gap-1 text-xs">
        <Crown className="h-3 w-3" /> {t('shareDialog.owner')}
      </Badge>
    </div>
  );
}

function useOwnerProfile(userId?: string) {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data } = await supabase
        .from('profiles')
        .select('full_name, username, email, avatar_url')
        .eq('user_id', userId)
        .maybeSingle();
      return data;
    },
    enabled: !!userId,
    staleTime: 60_000,
  });
}


function MemberRow({
  member,
  canManage,
  isCurrentUser,
  ownerUserId,
  onChangeRole,
  onRemove,
}: {
  member: ShareMember;
  canManage: boolean;
  isCurrentUser: boolean;
  ownerUserId?: string;
  onChangeRole: (shareId: string, newRole: string) => void;
  onRemove: (shareId: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const name = member.fullName || member.username || member.email || t('shareDialog.pending');
  const initials = name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2) || '?';
  const roleIcon = member.permission === 'admin' ? Shield : member.permission === 'editor' ? Pencil : Eye;
  const RoleIcon = roleIcon;

  return (
    <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors group">
      <Avatar className="h-8 w-8">
        {member.avatarUrl && <AvatarImage src={member.avatarUrl} />}
        <AvatarFallback className="text-xs bg-muted">{initials}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {name} {isCurrentUser && <span className="text-muted-foreground">{t('shareDialog.you')}</span>}
        </p>
        {member.email && (
          <p className="text-xs text-muted-foreground truncate">{member.email}</p>
        )}
      </div>

      {canManage && !isCurrentUser ? (
        <div className="flex items-center gap-1">
          <Select value={member.permission} onValueChange={(val) => onChangeRole(member.shareId, val)}>
            <SelectTrigger className="h-7 w-[100px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="viewer">{t('shareDialog.viewer')}</SelectItem>
              <SelectItem value="editor">{t('shareDialog.editor')}</SelectItem>
              <SelectItem value="admin">{t('shareDialog.admin')}</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onRemove(member.shareId, name)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Badge variant={member.permission === 'admin' ? 'default' : member.permission === 'editor' ? 'secondary' : 'outline'} className="gap-1 text-xs">
          <RoleIcon className="h-3 w-3" />
          {getRoleLabel(member.permission as ItemRole)}
        </Badge>
      )}
    </div>
  );
}
