import { ICON_SIZES } from './icons.js'
import { serviceMark } from './mark'

function initials(label: string): string {
  return label
    .split(/[\s_-]+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

export function ServiceIcon({
  type,
  label,
  size = ICON_SIZES.tableRow,
  className,
}: {
  type: string
  label: string
  size?: number
  className?: string
}) {
  const icon = serviceMark(type)
  if (!icon) {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={className}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
        // Neutral labelled placeholder: Grey 5 / Grey 80 are sanctioned icon backgrounds.
      >
        <span className="flex size-full items-center justify-center rounded-md bg-muted font-semibold text-muted-foreground">
          {initials(label)}
        </span>
      </span>
    )
  }
  return (
    <span
      role="img"
      aria-label={icon.name}
      title={icon.name}
      className={className}
      style={{ display: 'inline-flex', width: size, height: size, flex: 'none' }}
      dangerouslySetInnerHTML={{ __html: icon.svg }}
    />
  )
}
