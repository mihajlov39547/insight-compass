import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ImagePlus,
  Trash2,
  Loader2,
  Cloud,
  HardDrive,
  AlertTriangle,
  RotateCw,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import {
  usePlantCaseImages,
  useUploadPlantImage,
  useDeletePlantImage,
  useUpdatePlantImageRole,
  useRetryPlantImageDriveUpload,
  getPlantImageSignedUrl,
  fetchPlantImagePreviewObjectUrl,
  PLANT_IMAGE_ROLES,
  type PlantCaseImage,
  type PlantImageRole,
} from '@/hooks/usePlantCaseImages';

import { usePlantAdvisorUsage } from '@/hooks/usePlantAdvisorLimits';
import {
  canUploadPlantImage,
  formatMb,
  formatPlantLimitReason,
  PLANT_ADVISOR_ACCEPTED_MIMES,
} from '@/config/plantAdvisorLimits';

interface Props {
  caseId: string;
  disabled?: boolean;
}

function StorageBadge({ image }: { image: PlantCaseImage }) {
  const { t } = useTranslation();
  if (image.upload_status === 'uploading' || image.upload_status === 'staged') {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] py-0">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        {t('plantAdvisor.storage.uploadingToDrive')}
      </Badge>
    );
  }
  if (image.upload_status === 'drive_failed') {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] py-0 border-amber-500/40 text-amber-600">
        <AlertTriangle className="h-2.5 w-2.5" />
        {t('plantAdvisor.storage.driveFailed')}
      </Badge>
    );
  }
  if (image.storage_mode === 'google_drive') {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] py-0 border-emerald-500/40 text-emerald-600">
        <Cloud className="h-2.5 w-2.5" />
        {t('plantAdvisor.storage.googleDrive')}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-[10px] py-0">
      <HardDrive className="h-2.5 w-2.5" />
      {t('plantAdvisor.storage.supabaseFallback')}
    </Badge>
  );
}

function ImageThumb({
  image,
  onDelete,
  onRoleChange,
  onRetry,
  retrying,
  disabled,
}: {
  image: PlantCaseImage;
  onDelete: () => void;
  onRoleChange: (role: PlantImageRole) => void;
  onRetry: () => void;
  retrying: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (image.storage_path) {
      getPlantImageSignedUrl(image.storage_path).then((u) => active && setUrl(u));
    }
    return () => { active = false; };
  }, [image.storage_path]);

  return (
    <div className="relative rounded-lg border border-border bg-card overflow-hidden flex flex-col">
      <div className="aspect-square bg-muted flex items-center justify-center">
        {url ? (
          <img src={url} alt={image.original_filename ?? ''} className="w-full h-full object-cover" />
        ) : image.drive_web_view_link ? (
          <a
            href={image.drive_web_view_link}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary inline-flex items-center gap-1"
          >
            <ExternalLink className="h-3 w-3" />
            {t('plantAdvisor.storage.openInDrive')}
          </a>
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </div>
      <div className="p-2 space-y-1.5">
        <div className="flex items-center gap-1">
          <Select
            value={image.image_role}
            onValueChange={(v) => onRoleChange(v as PlantImageRole)}
            disabled={disabled}
          >
            <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PLANT_IMAGE_ROLES.map((r) => (
                <SelectItem key={r} value={r} className="text-xs">
                  {t(`plantAdvisor.roles.${r}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={onDelete}
            disabled={disabled}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex items-center justify-between gap-1 flex-wrap">
          <StorageBadge image={image} />
          {image.drive_web_view_link && (
            <a
              href={image.drive_web_view_link}
              target="_blank"
              rel="noreferrer"
              className="text-[10px] text-muted-foreground hover:text-primary inline-flex items-center gap-0.5"
            >
              <ExternalLink className="h-2.5 w-2.5" />
              {t('plantAdvisor.storage.openInDrive')}
            </a>
          )}
        </div>
        {image.upload_status === 'drive_failed' && (
          <Button
            variant="outline"
            size="sm"
            className="w-full h-7 text-[11px]"
            onClick={onRetry}
            disabled={retrying}
          >
            {retrying ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <RotateCw className="h-3 w-3 mr-1" />
            )}
            {t('plantAdvisor.storage.retryUpload')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function PlantImageUploader({ caseId, disabled }: Props) {
  const { t } = useTranslation();
  const { data: images = [] } = usePlantCaseImages(caseId);
  const upload = useUploadPlantImage();
  const remove = useDeletePlantImage();
  const updateRole = useUpdatePlantImageRole();
  const retryDrive = useRetryPlantImageDriveUpload();
  const usage = usePlantAdvisorUsage();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const limits = usage.limits;
  const imagesInCase = images.length;
  const atCaseLimit = imagesInCase >= limits.maxImagesPerCase;
  const atTotalLimit = usage.totalImages >= limits.maxTotalImages;

  const hint = useMemo(
    () =>
      t('plantAdvisor.limits.imageHint', {
        defaultValue: 'Up to {{n}} images per case · {{mb}} per image',
        n: limits.maxImagesPerCase,
        mb: formatMb(limits.maxImageBytes),
      }),
    [limits.maxImagesPerCase, limits.maxImageBytes, t],
  );

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    let inCase = imagesInCase;
    let total = usage.totalImages;
    for (const file of Array.from(files)) {
      const check = canUploadPlantImage(usage.plan, inCase, total, file.size, file.type);
      if (!check.ok) {
        toast.error(`${file.name}: ${t(formatPlantLimitReason(check.reason), {
          defaultValue: check.reason,
          mb: formatMb(limits.maxImageBytes),
        })}`);
        if (check.reason === 'image_limit_per_case_reached' || check.reason === 'total_image_limit_reached') break;
        continue;
      }
      try {
        await upload.mutateAsync({
          caseId,
          file,
          currentImagesInCase: inCase,
          currentTotalImages: total,
        });
        inCase++;
        total++;
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <label className="text-sm font-medium">{t('plantAdvisor.uploadImages')}</label>
          <div className="text-xs text-muted-foreground">{hint}</div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || upload.isPending || atCaseLimit || atTotalLimit}
          onClick={() => fileRef.current?.click()}
        >
          {upload.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ImagePlus className="h-4 w-4 mr-1.5" />}
          {t('plantAdvisor.addImages')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={PLANT_ADVISOR_ACCEPTED_MIMES.join(',')}
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {(atCaseLimit || atTotalLimit) && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 text-xs p-2 text-amber-700 dark:text-amber-300">
          {t(
            atCaseLimit
              ? 'plantAdvisor.limits.imagePerCaseReached'
              : 'plantAdvisor.limits.totalImageReached',
          )}
        </div>
      )}
      {images.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t('plantAdvisor.noImagesYet')}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {images.map((img) => (
            <ImageThumb
              key={img.id}
              image={img}
              disabled={disabled}
              onDelete={() => remove.mutate(img)}
              onRoleChange={(role) => updateRole.mutate({ id: img.id, role })}
              onRetry={() => retryDrive.mutate(img)}
              retrying={retryDrive.isPending && retryDrive.variables?.id === img.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
