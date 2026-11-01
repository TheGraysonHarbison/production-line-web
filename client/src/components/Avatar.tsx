import type { PublicUser } from "@production-line/shared";
import { pickOn } from "../theme/palette.ts";

function textOn(color: string): string {
  try {
    return pickOn(color, 0, true).color;
  } catch {
    return "#ffffff";
  }
}

/**
 * Default avatar (dev doc §3.1): the username's first character on the user's raw color. The
 * color is identity and never nudged; the letter flips to black or white so it always reads.
 */
export function Avatar({
  user,
  size = 36,
}: {
  user: Pick<PublicUser, "username" | "color" | "avatar_url">;
  size?: number;
}) {
  if (user.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt={user.username}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-label={user.username}
      role="img"
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold uppercase ring-1 ring-white/30"
      style={{
        width: size,
        height: size,
        backgroundColor: user.color,
        color: textOn(user.color),
        fontSize: size * 0.45,
      }}
    >
      {user.username.charAt(0)}
    </span>
  );
}
