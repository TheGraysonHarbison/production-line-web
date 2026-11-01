import { ApiError } from "../lib/api.ts";

export const errorNoticeClass =
  "rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-ink text-sm";
export const successNoticeClass =
  "rounded-lg border border-ok/30 bg-ok-soft px-3 py-2 text-ink text-sm";

export function ErrorNotice({ error, map = {} }: { error: unknown; map?: Record<string, string> }) {
  if (!error) return null;
  const message =
    error instanceof ApiError
      ? (map[error.code] ?? error.fieldMessage("name") ?? error.message)
      : error instanceof Error
        ? error.message
        : "Something went wrong";
  return (
    <p className={errorNoticeClass} role="alert">
      {message}
    </p>
  );
}

export function SuccessNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className={successNoticeClass} role="status">
      {message}
    </p>
  );
}
