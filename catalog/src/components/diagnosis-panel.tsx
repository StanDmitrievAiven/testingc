// "This looks wrong — which hop is the reason?"
//
// The chain walked backwards from the thing in front of you, each hop carrying its own health. The
// real pipeline in this project is healthy, so the honest answer here is almost always "nothing
// upstream explains it" — which is why the simulation controls exist. They break one hop on purpose
// so the mechanism can be seen working, and every part of the UI says so while they are on: a
// hypothetical that reads like a reading would be worse than having no feature at all.
import { useState } from 'react'
import { ActivityIcon, CircleAlertIcon, CircleCheckIcon, CircleHelpIcon, FlaskConicalIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { diagnose, withBreak, type Hop } from '@/lib/diagnose'
import { cn } from '@/lib/utils'

const icons = {
  ok: CircleCheckIcon,
  degraded: CircleAlertIcon,
  unknown: CircleHelpIcon,
}

const tones = {
  ok: 'text-muted-foreground',
  degraded: 'text-destructive',
  unknown: 'text-muted-foreground/60',
}

function HopRow({ hop, isCause }: { hop: Hop; isCause: boolean }) {
  const Icon = icons[hop.health]
  return (
    <li className={cn('flex flex-col gap-1 border-l-2 pl-3', isCause ? 'border-destructive' : 'border-border')}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Icon className={cn('size-4 shrink-0', tones[hop.health])} />
        <span className="font-medium">{hop.name}</span>
        <Badge variant="outline">
          {hop.distance} {hop.distance === 1 ? 'hop' : 'hops'} up
        </Badge>
        {isCause ? <Badge variant="destructive">start here</Badge> : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {hop.why} Arrives by <code>{hop.via}</code>.
      </p>
      {hop.delay ? (
        <p className="text-xs text-muted-foreground">
          {hop.delay.behindRecords.toLocaleString()} records behind of {hop.delay.retainedRecords.toLocaleString()}{' '}
          retained — {hop.delay.measures}.
        </p>
      ) : null}
    </li>
  )
}

export function DiagnosisPanel({ assetId }: { assetId: string }) {
  const [broken, setBroken] = useState<{ serviceId: string; name: string } | undefined>()

  const real = diagnose(assetId)
  if (!real || !real.chain.length) return null

  const shown = broken
    ? diagnose(assetId, {
        healthOf: withBreak(
          broken.serviceId,
          `Simulated: ${broken.name} has stopped delivering, so nothing new is arriving from here.`,
        ),
      })!
    : real

  // One button per service in the chain, deduplicated: breaking a service breaks every hop on it.
  const breakable = [...new Map(real.chain.map((hop) => [hop.serviceId, hop])).values()]

  return (
    <div className={cn('flex flex-col gap-3 rounded-lg border p-3', broken && 'border-dashed border-warning')}>
      <div className="flex flex-wrap items-center gap-2">
        <ActivityIcon className="size-4" />
        <span className="text-sm font-medium">Why might this look wrong?</span>
        {broken ? (
          <Badge variant="warning" className="gap-1">
            <FlaskConicalIcon className="size-3" />
            simulated, not a reading
          </Badge>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">{shown.verdict}</p>

      <ul className="flex flex-col gap-2">
        {shown.chain.map((hop) => (
          <HopRow key={hop.assetId} hop={hop} isCause={hop.assetId === shown.cause?.assetId} />
        ))}
      </ul>

      <Tooltip>
        <TooltipTrigger className="self-start text-left text-xs text-muted-foreground underline decoration-dotted">
          How fresh is this?
        </TooltipTrigger>
        <TooltipContent className="max-w-96">{shown.freshness}</TooltipContent>
      </Tooltip>

      <p className="text-xs text-muted-foreground/80">{shown.boundary}</p>

      <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
        <span className="text-xs text-muted-foreground">Try a fault:</span>
        {breakable.map((hop) => (
          <Button
            key={hop.serviceId}
            size="sm"
            variant={broken?.serviceId === hop.serviceId ? 'secondary' : 'ghost'}
            onClick={() =>
              setBroken(
                broken?.serviceId === hop.serviceId ? undefined : { serviceId: hop.serviceId, name: hop.serviceName },
              )
            }
          >
            {hop.serviceName}
          </Button>
        ))}
        {broken ? (
          <Button size="sm" variant="outline" onClick={() => setBroken(undefined)}>
            Back to the real reading
          </Button>
        ) : null}
      </div>
    </div>
  )
}
