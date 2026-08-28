type AvatarProps = {
  seed: string;
  name: string;
  size?: "sm" | "md";
};

export function PongAvatar({ seed, name, size = "md" }: AvatarProps) {
  const hue = hash(seed) % 360;
  return (
    <span className={`pong-avatar pong-avatar-${size}`} aria-label={`${name} avatar`} style={{ "--avatar-hue": `${hue}` } as never}>
      <span className="pong-avatar-paddle" aria-hidden="true" />
      <span className="pong-avatar-ball" aria-hidden="true" />
    </span>
  );
}

function hash(value: string): number {
  let total = 0;
  for (let index = 0; index < value.length; index++) total = (total + value.charCodeAt(index) * (index + 3)) % 360;
  return total;
}
