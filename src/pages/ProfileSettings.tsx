import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Trash2, Shield, AlertTriangle, Sparkles, Zap, Crown, Building2, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ChangePasswordDialog } from '@/components/auth/ChangePasswordDialog';
import { BillingSection } from '@/components/settings/BillingSection';


interface SavedProfileState {
  fullName: string;
  bio: string;
  location: string;
  website: string;
  username: string;
  avatarUrl: string;
  bannerUrl: string;
  phoneCountry: string;
  phoneArea: string;
  phoneNumber: string;
}

const emptySavedProfile: SavedProfileState = {
  fullName: '',
  bio: '',
  location: '',
  website: '',
  username: '',
  avatarUrl: '',
  bannerUrl: '',
  phoneCountry: '',
  phoneArea: '',
  phoneNumber: '',
};

const usernamePattern = /^[a-z0-9]+$/;

function sanitizeUsername(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sanitizeDigits(value: string, maxLength: number) {
  return value.replace(/\D/g, '').slice(0, maxLength);
}

function sanitizePhoneNumber(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 8);

  if (digits.length <= 3) return digits;

  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
}

function parsePhone(phone: string | null | undefined) {
  if (!phone) {
    return {
      phoneCountry: '',
      phoneArea: '',
      phoneNumber: '',
    };
  }

  const [country = '', area = '', number = ''] = phone.trim().split(/\s+/);

  return {
    phoneCountry: sanitizeDigits(country, 3),
    phoneArea: sanitizeDigits(area, 2),
    phoneNumber: sanitizePhoneNumber(number),
  };
}

function buildSavedProfile({
  authUser,
  profile,
}: {
  authUser: ReturnType<typeof useAuth>['user'];
  profile: {
    full_name: string | null;
    bio: string | null;
    location: string | null;
    website: string | null;
    username: string | null;
    avatar_url: string | null;
    banner_url: string | null;
    phone: string | null;
  } | null;
}): SavedProfileState {
  const phoneParts = parsePhone(profile?.phone);

  return {
    fullName: profile?.full_name || authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || '',
    bio: profile?.bio || '',
    location: profile?.location || '',
    website: profile?.website || '',
    username: profile?.username || '',
    avatarUrl: profile?.avatar_url || authUser?.user_metadata?.avatar_url || authUser?.user_metadata?.picture || '',
    bannerUrl: profile?.banner_url || '',
    ...phoneParts,
  };
}

export default function ProfileSettings() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user: authUser, profile, signOut } = useAuth();

  // Profile state
  const [fullName, setFullName] = useState('');
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [website, setWebsite] = useState('');
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [phoneCountry, setPhoneCountry] = useState('');
  const [phoneArea, setPhoneArea] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isProfileEditing, setIsProfileEditing] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [savedProfile, setSavedProfile] = useState<SavedProfileState>(emptySavedProfile);

  const [isSavingUsername, setIsSavingUsername] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  const displayEmail = profile?.email || authUser?.email || '';
  const googleProvider = authUser?.app_metadata?.provider === 'google' || authUser?.app_metadata?.providers?.includes('google');

  const initials = fullName
    ? fullName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : displayEmail?.[0]?.toUpperCase() || '?';

  const usernameValidationMessage = useMemo(() => {
    if (!username) return t('profileSettings.username.errors.required');
    if (!usernamePattern.test(username)) return t('profileSettings.username.errors.pattern');
    return '';
  }, [username, t]);

  const applyProfileState = useCallback((nextState: SavedProfileState) => {
    setFullName(nextState.fullName);
    setBio(nextState.bio);
    setLocation(nextState.location);
    setWebsite(nextState.website);
    setUsername(nextState.username);
    setAvatarUrl(nextState.avatarUrl);
    setBannerUrl(nextState.bannerUrl);
    setPhoneCountry(nextState.phoneCountry);
    setPhoneArea(nextState.phoneArea);
    setPhoneNumber(nextState.phoneNumber);
  }, []);

  const loadProfile = useCallback(async () => {
    if (!authUser) return;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      toast.error(t('profileSettings.toasts.loadFailed'));
      return;
    }

    const nextState = buildSavedProfile({ authUser, profile: data ?? null });
    setSavedProfile(nextState);
    applyProfileState(nextState);
  }, [applyProfileState, authUser, t]);

  useEffect(() => {
    if (authUser) {
      void loadProfile();
      return;
    }

    const nextState = buildSavedProfile({ authUser: null, profile: null });
    setSavedProfile(nextState);
    applyProfileState(nextState);
  }, [applyProfileState, authUser, loadProfile, profile]);


  const handleCancelProfile = () => {
    applyProfileState(savedProfile);
    setIsProfileEditing(false);
  };

  const handleSaveProfile = async () => {
    if (!authUser) return;

    const formattedPhone = [phoneCountry, phoneArea, phoneNumber].filter(Boolean).join(' ');

    if ((phoneCountry || phoneArea || phoneNumber) && (!phoneCountry || !phoneArea || phoneNumber.replace(/\D/g, '').length < 6)) {
      toast.error(t('profileSettings.toasts.phoneInvalid'));
      return;
    }

    setIsSavingProfile(true);
    const payload = {
      user_id: authUser.id,
      full_name: fullName,
      bio,
      location,
      website,
      banner_url: bannerUrl,
      avatar_url: avatarUrl,
      phone: formattedPhone || null,
      email: displayEmail,
    };
    const { error } = await supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'user_id' });
    setIsSavingProfile(false);
    if (error) {
      toast.error(t('profileSettings.toasts.saveFailed'));
    } else {
      const nextState = {
        fullName,
        bio,
        location,
        website,
        username,
        avatarUrl,
        bannerUrl,
        phoneCountry,
        phoneArea,
        phoneNumber,
      };
      setSavedProfile(nextState);
      toast.success(t('profileSettings.toasts.saved'));
      setIsProfileEditing(false);
      void loadProfile();
    }
  };

  const handleSaveUsername = async () => {
    if (!authUser) return;

    if (usernameValidationMessage) {
      toast.error(usernameValidationMessage);
      return;
    }

    setIsSavingUsername(true);
    const { error } = await supabase
      .from('profiles')
      .upsert({ user_id: authUser.id, username }, { onConflict: 'user_id' });
    setIsSavingUsername(false);
    if (error) {
      if (error.code === '23505') {
        toast.error(t('profileSettings.username.errors.taken'));
      } else {
        toast.error(t('profileSettings.username.errors.saveFailed'));
      }
    } else {
      setSavedProfile((current) => ({ ...current, username }));
      toast.success(t('profileSettings.username.saved'));
      void loadProfile();
    }
  };


  const handleDeleteAccount = async () => {
    if (!authUser) return;
    try {
      // Delete user settings and profile
      await supabase.from('user_settings').delete().eq('user_id', authUser.id);
      await supabase.from('profiles').delete().eq('user_id', authUser.id);
      await signOut();
      toast.success(t('profileSettings.toasts.deleted'));
      navigate('/');
    } catch {
      toast.error(t('profileSettings.toasts.deleteFailed'));
    }
  };

  if (!authUser) {
    navigate('/');
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="h-14 bg-card border-b border-border flex items-center px-4 gap-3 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-base font-semibold text-foreground">{t('profileSettings.title')}</h1>
      </header>

      <div className="max-w-2xl mx-auto py-8 px-4">
        <Tabs defaultValue="profile" className="w-full">
          <TabsList className="w-full mb-6">
            <TabsTrigger value="profile" className="flex-1">{t('profileSettings.tabs.profile')}</TabsTrigger>
            <TabsTrigger value="settings" className="flex-1">{t('profileSettings.tabs.settings')}</TabsTrigger>
            <TabsTrigger value="billing" className="flex-1">
              <CreditCard className="h-4 w-4 mr-1.5" />
              Billing
            </TabsTrigger>
          </TabsList>

          {/* ===================== PROFILE TAB ===================== */}
          <TabsContent value="profile" className="space-y-6">
            {/* Banner */}
            <div className="relative rounded-xl border border-border">
              <div
                className="h-32 rounded-xl bg-muted flex items-center justify-center"
                style={bannerUrl ? { backgroundImage: `url(${bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
              >
                {!bannerUrl && <span className="text-muted-foreground text-sm">{t('profileSettings.banner')}</span>}
              </div>
              {/* Avatar overlay — positioned below the banner, not clipped */}
              <div className="absolute -bottom-10 left-6 z-10">
                <Avatar className="h-20 w-20 border-4 border-card">
                  {avatarUrl && <AvatarImage src={avatarUrl} alt={fullName} />}
                  <AvatarFallback className="bg-primary text-primary-foreground text-xl">{initials}</AvatarFallback>
                </Avatar>
              </div>
            </div>

            <div className="pt-8 flex justify-end">
              {!isProfileEditing ? (
                <Button variant="outline" size="sm" onClick={() => setIsProfileEditing(true)}>
                  {t('profileSettings.actions.edit')}
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleCancelProfile}>{t('profileSettings.actions.cancel')}</Button>
                  <Button size="sm" onClick={handleSaveProfile} disabled={isSavingProfile}>
                    {isSavingProfile ? t('profileSettings.actions.saving') : t('profileSettings.actions.save')}
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t('profileSettings.fields.name')}</Label>
                <Input value={fullName} onChange={e => setFullName(e.target.value)} disabled={!isProfileEditing} />
              </div>
              <div className="space-y-2">
                <Label>{t('profileSettings.fields.bio')}</Label>
                <Textarea value={bio} onChange={e => setBio(e.target.value)} disabled={!isProfileEditing} placeholder={t('profileSettings.fields.bioPlaceholder')} className="resize-none min-h-[80px]" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('profileSettings.fields.location')}</Label>
                  <Input value={location} onChange={e => setLocation(e.target.value)} disabled={!isProfileEditing} placeholder={t('profileSettings.fields.locationPlaceholder')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('profileSettings.fields.website')}</Label>
                  <Input value={website} onChange={e => setWebsite(e.target.value)} disabled={!isProfileEditing} placeholder={t('profileSettings.fields.websitePlaceholder')} />
                </div>
              </div>
                <div className="space-y-2">
                  <Label>{t('profileSettings.fields.phone')}</Label>
                  <div className="grid grid-cols-[minmax(0,110px)_minmax(0,100px)_minmax(0,1fr)] gap-3 max-sm:grid-cols-1">
                    <Input
                      inputMode="numeric"
                      placeholder="381"
                      value={phoneCountry}
                      onChange={e => setPhoneCountry(sanitizeDigits(e.target.value, 3))}
                      disabled={!isProfileEditing}
                    />
                    <Input
                      inputMode="numeric"
                      placeholder="60"
                      value={phoneArea}
                      onChange={e => setPhoneArea(sanitizeDigits(e.target.value, 2))}
                      disabled={!isProfileEditing}
                    />
                    <Input
                      inputMode="numeric"
                      placeholder="345-2323"
                      value={phoneNumber}
                      onChange={e => setPhoneNumber(sanitizePhoneNumber(e.target.value))}
                      disabled={!isProfileEditing}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{t('profileSettings.fields.phoneFormat')}</p>
                </div>
              <Separator />
              <div className="space-y-2">
                <Label>{t('profileSettings.fields.bannerUrl')}</Label>
                <Input value={bannerUrl} onChange={e => setBannerUrl(e.target.value)} disabled={!isProfileEditing} placeholder="https://..." />
                <p className="text-xs text-muted-foreground">{t('profileSettings.fields.bannerUrlHelp')}</p>
              </div>
              <div className="space-y-2">
                <Label>{t('profileSettings.fields.avatarUrl')}</Label>
                <Input value={avatarUrl} onChange={e => setAvatarUrl(e.target.value)} disabled={!isProfileEditing} placeholder={t('profileSettings.fields.avatarUrlPlaceholder')} />
                <p className="text-xs text-muted-foreground">{t('profileSettings.fields.avatarUrlHelp')}</p>
              </div>
            </div>
          </TabsContent>

          {/* ===================== APP SETTINGS TAB ===================== */}
          <TabsContent value="settings" className="space-y-8">
            {/* Username */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t('profileSettings.username.title')}</h3>
              <p className="text-xs text-muted-foreground">{t('profileSettings.username.description')}</p>
              <div className="flex gap-2">
                <Input value={username} onChange={e => setUsername(sanitizeUsername(e.target.value))} placeholder={t('profileSettings.username.placeholder')} />
                <Button variant="outline" size="sm" onClick={handleSaveUsername} disabled={isSavingUsername}>
                  {isSavingUsername ? t('profileSettings.username.updating') : t('profileSettings.username.update')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('profileSettings.username.rules')}</p>
              {usernameValidationMessage ? (
                <p className="text-xs text-destructive">{usernameValidationMessage}</p>
              ) : null}
            </section>

            <Separator />

            {/* Email */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t('profileSettings.email.title')}</h3>
              <Input value={displayEmail} disabled />
              {googleProvider && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Shield className="h-3 w-3" /> {t('profileSettings.email.googleManaged')}
                </p>
              )}
            </section>

            <Separator />

            {/* Subscription */}
            <SubscriptionSection plan={profile?.plan || 'free'} />


            <Separator />

            {/* Linked Accounts */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t('profileSettings.linkedAccounts.title')}</h3>
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/40">
                <svg className="h-5 w-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">Google</p>
                  <p className="text-xs text-muted-foreground">{t('profileSettings.linkedAccounts.googlePrimary', { email: displayEmail })}</p>
                </div>
                <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">{t('profileSettings.linkedAccounts.connected')}</span>
              </div>
            </section>

            <Separator />

            {/* Password */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t('profileSettings.password.title')}</h3>
              {googleProvider ? (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Shield className="h-4 w-4" /> {t('profileSettings.password.googleManaged')}
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">{t('profileSettings.password.localManaged')}</p>
                  <Button variant="outline" size="sm" onClick={() => setChangePasswordOpen(true)}>
                    {t('profileSettings.password.change')}
                  </Button>
                </div>
              )}
            </section>
            <ChangePasswordDialog
              open={changePasswordOpen}
              onOpenChange={setChangePasswordOpen}
              email={displayEmail}
            />

            <Separator />

            {/* Delete Account */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-destructive">{t('profileSettings.danger.title')}</h3>
              <p className="text-xs text-muted-foreground">
                {t('profileSettings.danger.description')}
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" className="gap-2">
                    <Trash2 className="h-4 w-4" /> {t('profileSettings.danger.deleteButton')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                      {t('profileSettings.danger.dialogTitle')}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('profileSettings.danger.dialogDescription')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('profileSettings.danger.cancel')}</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteAccount} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                      {t('profileSettings.danger.confirm')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </section>
          </TabsContent>

          <TabsContent value="billing">
            <BillingSection />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}


const planIcons: Record<string, React.ElementType> = {
  free: Sparkles,
  basic: Zap,
  premium: Crown,
  enterprise: Building2,
};

function SubscriptionSection({ plan }: { plan: string }) {
  const { t } = useTranslation();
  const planKey = planIcons[plan] ? plan : 'free';
  const Icon = planIcons[planKey];

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{t('profileSettings.subscription.title')}</h3>
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              {t(`profileSettings.subscription.plans.${planKey}.name`)} {t('profileSettings.subscription.planSuffix')}
            </p>
            <p className="text-xs text-muted-foreground">{t(`profileSettings.subscription.plans.${planKey}.description`)}</p>
          </div>
          <span className="text-sm font-medium text-foreground">{t(`profileSettings.subscription.plans.${planKey}.price`)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">{t('profileSettings.subscription.active')}</span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('profileSettings.subscription.comingSoon')}
      </p>
    </section>
  );
}
