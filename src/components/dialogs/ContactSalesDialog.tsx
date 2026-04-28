import React, { useEffect, useState } from 'react';
import { Mail, Loader2 } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface ContactSalesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SALES_EMAIL = 'aktika.pr@gmail.com';

export function ContactSalesDialog({ open, onOpenChange }: ContactSalesDialogProps) {
  const { t } = useTranslation();
  const { user, profile } = useAuth();

  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail(user?.email ?? '');
      setSubject(t('contactSales.defaultSubject'));
      setMessage('');
    }
  }, [open, user?.email, t]);

  const handleSend = async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      toast.error(t('contactSales.invalidEmail'));
      return;
    }
    if (!subject.trim()) {
      toast.error(t('contactSales.subjectRequired'));
      return;
    }
    if (!message.trim()) {
      toast.error(t('contactSales.messageRequired'));
      return;
    }

    setSending(true);
    try {
      const senderName = profile?.full_name || profile?.username || undefined;
      const inquiryId = crypto.randomUUID();

      const { error } = await supabase.functions.invoke('send-transactional-email', {
        body: {
          templateName: 'contact-sales',
          recipientEmail: SALES_EMAIL,
          idempotencyKey: `contact-sales-${inquiryId}`,
          templateData: {
            contactEmail: email.trim(),
            subject: subject.trim(),
            message: message.trim(),
            senderName,
          },
        },
      });

      if (error) throw error;

      toast.success(t('contactSales.sent'));
      onOpenChange(false);
    } catch (err) {
      console.error('Contact sales send error:', err);
      toast.error(t('contactSales.sendFailed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-accent" />
            {t('contactSales.title')}
          </DialogTitle>
          <DialogDescription>{t('contactSales.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="contact-sales-email" className="text-sm">
              {t('contactSales.emailLabel')}
            </Label>
            <Input
              id="contact-sales-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              disabled={sending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-sales-subject" className="text-sm">
              {t('contactSales.subjectLabel')}
            </Label>
            <Input
              id="contact-sales-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={sending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-sales-message" className="text-sm">
              {t('contactSales.messageLabel')}
            </Label>
            <Textarea
              id="contact-sales-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t('contactSales.messagePlaceholder')}
              rows={6}
              disabled={sending}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            {t('contactSales.cancel')}
          </Button>
          <Button
            className="bg-accent hover:bg-accent/90 text-accent-foreground"
            onClick={handleSend}
            disabled={sending}
          >
            {sending ? (
              <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t('contactSales.sending')}</>
            ) : (
              t('contactSales.send')
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
