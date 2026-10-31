import { type FormEvent, useEffect, useState } from "react";
import { buttonClass, Field, inputClass } from "../../components/Field.tsx";
import { ErrorNotice, SuccessNotice } from "../../components/Notice.tsx";
import { useSettings, useUpdateSettings } from "../../lib/data.ts";

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return [];
  }
}

export function GeneralPage() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [imagesEnabled, setImagesEnabled] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [saved, setSaved] = useState<string | null>(null);
  const zones = timeZones();

  useEffect(() => {
    if (settings.data) {
      setImagesEnabled(settings.data.images_enabled);
      setTimezone(settings.data.timezone ?? "UTC");
    }
  }, [settings.data]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    setSaved(null);
    update.mutate(
      { images_enabled: imagesEnabled, timezone },
      { onSuccess: () => setSaved("Settings saved.") },
    );
  };

  if (!settings.data) return <p className="text-sm opacity-70">Loading…</p>;

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <h2 className="font-semibold text-2xl">General</h2>
      <SuccessNotice message={saved} />
      <ErrorNotice error={update.error} />
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={imagesEnabled}
          onChange={(e) => setImagesEnabled(e.target.checked)}
        />
        <span>
          <span className="font-medium">Allow images</span>
          <span className="block text-sm opacity-70">
            Slot and profile images. Turning this off keeps existing images but blocks new uploads.
          </span>
        </span>
      </label>
      <Field
        label="Timezone"
        htmlFor="timezone"
        hint="Everyone on the LAN sees slot times in this zone."
      >
        {zones.length > 0 ? (
          <select
            id="timezone"
            className={inputClass}
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {!zones.includes(timezone) ? <option value={timezone}>{timezone}</option> : null}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="timezone"
            className={inputClass}
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          />
        )}
      </Field>
      <div>
        <button type="submit" className={buttonClass} disabled={update.isPending}>
          Save
        </button>
      </div>
    </form>
  );
}
