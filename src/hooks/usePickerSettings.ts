import { useCallback, useState } from 'react';
import {
  loadDefault,
  loadPresets,
  MOODS,
  saveDefault as storeDefault,
  savePresets as storePresets,
  type MoodId,
  type PickerSettings,
  type Preset,
} from '../lib/pickerSettings';

/**
 * The Colour Picker's settings, the user's saved default, and their named
 * presets. Settings outlive any one image, so a mood chosen for one picture
 * carries on to the next.
 */
export function usePickerSettings() {
  const [settings, setSettings] = useState<PickerSettings>(loadDefault);
  const [savedDefault, setSavedDefault] = useState<PickerSettings>(loadDefault);
  const [presets, setPresets] = useState<Preset[]>(loadPresets);

  const update = useCallback(
    (patch: Partial<PickerSettings>) => setSettings((prev) => ({ ...prev, ...patch })),
    [],
  );

  // A mood is about which colours, not how they're listed, so the person's
  // chosen sort survives switching between them. A preset is their whole
  // setup, sort included.
  const applyMood = useCallback((id: MoodId) => {
    const mood = MOODS.find((m) => m.id === id);
    if (mood) setSettings((prev) => ({ ...mood.settings, sort: prev.sort }));
  }, []);

  const applyPreset = useCallback(
    (id: string) => {
      const preset = presets.find((p) => p.id === id);
      if (preset) setSettings(preset.settings);
    },
    [presets],
  );

  const saveDefault = useCallback(() => {
    storeDefault(settings);
    setSavedDefault(settings);
  }, [settings]);

  const resetToDefault = useCallback(() => setSettings(savedDefault), [savedDefault]);

  /** Saving under a name that already exists replaces that preset. */
  const savePreset = useCallback(
    (name: string) => {
      const trimmed = name.trim().slice(0, 40);
      if (!trimmed) return;
      setPresets((prev) => {
        const same = prev.find((p) => p.name.toLowerCase() === trimmed.toLowerCase());
        const next = same
          ? prev.map((p) => (p === same ? { ...p, settings } : p))
          : [...prev, { id: `u${Date.now().toString(36)}`, name: trimmed, settings }];
        storePresets(next);
        return next;
      });
    },
    [settings],
  );

  const deletePreset = useCallback((id: string) => {
    setPresets((prev) => {
      const next = prev.filter((p) => p.id !== id);
      storePresets(next);
      return next;
    });
  }, []);

  return {
    settings,
    update,
    savedDefault,
    presets,
    applyMood,
    applyPreset,
    saveDefault,
    resetToDefault,
    savePreset,
    deletePreset,
  };
}
