import { type FormEvent, useEffect, useState } from "react";
import {
  buttonClass,
  Field,
  inputClass,
  linkButtonClass,
  secondaryButtonClass,
} from "../../components/Field.tsx";
import { ErrorNotice, SuccessNotice } from "../../components/Notice.tsx";
import { useSettings, useUpdateSettings } from "../../lib/data.ts";

export function HomeAssistantPage() {
  const settings = useSettings();
  const update = useUpdateSettings();
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) {
      setEnabled(settings.data.ha_enabled);
      setBaseUrl(settings.data.ha_base_url ?? "");
    }
  }, [settings.data]);

  const save = (e: FormEvent) => {
    e.preventDefault();
    setSaved(null);
    update.mutate(
      {
        ha_enabled: enabled,
        ha_base_url: baseUrl.trim() === "" ? null : baseUrl.trim(),
        ...(token !== "" ? { ha_token: token } : {}),
      },
      {
        onSuccess: () => {
          setToken("");
          setSaved("Home Assistant settings saved.");
        },
      },
    );
  };

  if (!settings.data) return <p className="text-ink-muted text-sm">Loading…</p>;
  const tokenSet = settings.data.ha_token.set;

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <h2 className="font-semibold text-2xl">Home Assistant</h2>
      <p className="text-ink-muted text-sm">
        When a slot expires, its details are sent to Home Assistant as a{" "}
        <code className="rounded bg-accent-soft px-1 text-ink">production_line_slot_expired</code>{" "}
        event. Create a long-lived access token in HA (Profile → Security) and paste it below.
      </p>
      <SuccessNotice message={saved} />
      <ErrorNotice error={update.error} />
      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          className="accent-accent"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span className="font-medium">Send events to Home Assistant</span>
      </label>
      <Field label="Base URL" htmlFor="ha-url" hint="e.g. http://homeassistant.local:8123">
        <input
          id="ha-url"
          className={inputClass}
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="http://homeassistant.local:8123"
        />
      </Field>
      <Field
        label="Long-lived access token"
        htmlFor="ha-token"
        hint={tokenSet ? "A token is set. Enter a new one to replace it." : "No token set yet."}
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="ha-token"
            className={`${inputClass} min-w-0 flex-1`}
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={tokenSet ? "••••••••" : ""}
          />
          <span className="text-sm" data-testid="ha-token-status">
            {tokenSet ? "set" : "not set"}
          </span>
          {tokenSet ? (
            <button
              type="button"
              className={linkButtonClass}
              onClick={() =>
                update.mutate({ ha_token: null }, { onSuccess: () => setSaved("Token cleared.") })
              }
            >
              Clear token
            </button>
          ) : null}
        </div>
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={buttonClass} disabled={update.isPending}>
          Save
        </button>
        <button
          type="button"
          className={secondaryButtonClass}
          disabled
          title="Available in a later version"
        >
          Test
        </button>
        <span className="text-ink-muted text-sm">
          Test delivery is available in a later version.
        </span>
      </div>
    </form>
  );
}
