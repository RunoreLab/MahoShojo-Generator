export type CharacterCardPortraitSource = 'generated' | 'uploaded';

export interface CharacterCardPortraitAsset {
  imageUrl: string;
  source: CharacterCardPortraitSource;
  note?: string;
}
