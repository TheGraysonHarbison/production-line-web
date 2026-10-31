import type { PublicUser } from "@production-line/shared";

/** Default avatar (dev doc §3.1): the username's first character on the user's color. */
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
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-label={user.username}
      role="img"
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white uppercase"
      style={{ width: size, height: size, backgroundColor: user.color, fontSize: size * 0.45 }}
    >
      {user.username.charAt(0)}
    </span>
  );
}
