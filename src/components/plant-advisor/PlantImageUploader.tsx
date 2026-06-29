import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  usePlantCaseImages,
  useUploadPlantImage,
  useDeletePlantImage,
  useUpdatePlantImageRole,
  getPlantImageSignedUrl,
  PLANT_IMAGE_ROLES,
  ACCEPTED_PLANT_IMAGE_MIMES,
  MAX_PLANT_IMAGE_BYTES,
  type PlantCaseImage,
  type PlantImageRole,
} from '@/hooks/usePlantCaseImages';

interface Props {
  caseId: string;
  disabled?: boolean;
}

function ImageThumb({ image, onDelete, onRoleChange, disabled }: {
  image: PlantCaseImage;
  onDelete: () => void;
  onRoleChange: (role: PlantImageRole) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    getPlantImageSignedUrl(image.storage_path).then((u) => {
      if (active) setUrl(u);
    });
    return () => { active = false; };
  }, [image.storage_path]);
  return (
    <div className="relative rounded-lg border border-border bg-card overflow-hidden flex flex-col">
      <div className="aspect-square bg-muted flex items-center justify-center">
        {url ? (
          <img src={url} alt={image.original_filename ?? ''} className="w-full h-full object-cover" />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </div>
      <div className="p-2 flex items-center gap-1">
        <Select value={image.image_role} onValueChange={(v) => onRoleChange(v as PlantImageRole)} disabled={disabled}>
          <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PLANT_IMAGE_ROLES.map((r) => (
              <SelectItem key={r} value={r} className="text-xs">{t(`plantAdvisor.roles.${r}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={onDelete} disabled={disabled}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
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
  const fileRef = React.useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX_PLANT_IMAGE_BYTES) {
        toast.error(`${file.name}: ${t('plantAdvisor.errors.tooLarge')}`);
        continue;
      }
      if (!ACCEPTED_PLANT_IMAGE_MIMES.includes(file.type)) {
        toast.error(`${file.name}: ${t('plantAdvisor.errors.badType')}`);
        continue;
      }
      try {
        await upload.mutateAsync({ caseId, file });
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{t('plantAdvisor.uploadImages')}</label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || upload.isPending}
          onClick={() => fileRef.current?.click()}
        >
          {upload.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <ImagePlus className="h-4 w-4 mr-1.5" />}
          {t('plantAdvisor.addImages')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED_PLANT_IMAGE_MIMES.join(',')}
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
