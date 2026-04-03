import MagicalGirlCard from '@/components/MagicalGirlCard';
import CanshouCard from '@/components/CanshouCard';
import type { CreatorTemplateId } from '@/lib/creator/templates';
import type { CharacterCardPortraitAsset } from '@/types/visual-asset';

type CreatorStructuredResultCardProps = {
  template: CreatorTemplateId;
  result: any;
  onSaveImage?: (imageUrl: string) => void;
  imageSaveMode?: 'auto' | 'modal' | 'download';
  saveButtonLabel?: string;
  portraitAsset?: CharacterCardPortraitAsset | null;
};

const MAGICAL_GIRL_GRADIENT = 'linear-gradient(135deg, #9775fa 0%, #b197fc 100%)';

export function CreatorStructuredResultCard({
  template,
  result,
  onSaveImage,
  imageSaveMode = 'auto',
  saveButtonLabel,
  portraitAsset = null,
}: CreatorStructuredResultCardProps) {
  if (template === 'canshou') {
    return (
      <CanshouCard
        canshou={result}
        onSaveImage={onSaveImage}
        imageSaveMode={imageSaveMode}
        saveButtonLabel={saveButtonLabel}
        portraitAsset={portraitAsset}
      />
    );
  }

  return (
    <MagicalGirlCard
      magicalGirl={result}
      gradientStyle={MAGICAL_GIRL_GRADIENT}
      onSaveImage={onSaveImage}
      imageSaveMode={imageSaveMode}
      saveButtonLabel={saveButtonLabel}
      portraitAsset={portraitAsset}
    />
  );
}
