import { useEffect, useRef } from 'react';
import { useUserSettings } from './useUserSettings';
import { maybePlayGenerationSound } from '@/lib/generationSound';

/**
 * Plays the configured "generation complete" sound when `isGenerating`
 * transitions from true → false. Respects the user's `generation_sound`
 * preference ('first' | 'always' | 'never').
 */
export function useGenerationCompleteSound(isGenerating: boolean, hasError?: boolean) {
  const { data: settings } = useUserSettings();
  const wasGeneratingRef = useRef(false);

  useEffect(() => {
    const wasGenerating = wasGeneratingRef.current;
    if (wasGenerating && !isGenerating && !hasError) {
      maybePlayGenerationSound(settings?.generation_sound);
    }
    wasGeneratingRef.current = isGenerating;
  }, [isGenerating, hasError, settings?.generation_sound]);
}
