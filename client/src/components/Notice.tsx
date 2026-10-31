import { ApiError } from "../lib/api.ts";

export function ErrorNotice({ error, map = {} }: { error: unknown; map?: Record<string, string> }) {
  if (!error) return null;
  const message =
    error instanceof ApiError
      ? (map[error.code] ?? error.fieldMessage("name") ?? error.message)
      : error instanceof Error
        ? error.message
        : "Something went wrong";
  return (
    <p
      className="rounded-md bg-red-100 px-3 py-2 text-red-900 text-sm dark:bg-red-900 dark:text-red-100"
      role="alert"
    >
      {message}
    </p>
  );
}

export function SuccessNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      className="rounded-md bg-green-100 px-3 py-2 text-green-900 text-sm dark:bg-green-900 dark:text-green-100"
      role="status"
    >
      {message}
    </p>
  );
}
