import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ServiceIcon } from '@/lib/aiven-service-icons/ServiceIcon'
import { isRuntime, stackMembers, typeLabel } from '@/lib/catalog'
import type { Navigate } from '@/lib/routes'
import type { Stack } from '@/types'

export function StackCard({ stack, navigate }: { stack: Stack; navigate: Navigate }) {
  const members = stackMembers(stack)
  const open = () => navigate({ page: 'stack', id: stack.id })

  return (
    // The card is clickable for the mouse, but the title and every member icon are real
    // buttons, so the same targets are reachable by keyboard without nesting interactives.
    <Card className="h-full cursor-pointer transition-shadow hover:ring-secondary-foreground" onClick={open}>
      <CardHeader>
        <CardTitle>
          <button
            type="button"
            className="text-left outline-none hover:underline focus-visible:underline"
            onClick={(event) => {
              event.stopPropagation()
              open()
            }}
          >
            {stack.name}
          </button>
        </CardTitle>
        <CardDescription>{stack.description}</CardDescription>
        <CardAction>
          <Badge variant="secondary">{stack.kind}</Badge>
        </CardAction>
      </CardHeader>
      {/* Descriptions differ in length, so the marks sit on the card's floor to line up across a row. */}
      <CardContent className="mt-auto flex flex-wrap items-center gap-1">
        {members.map((member) => (
          <Tooltip key={member.id}>
            <TooltipTrigger
              aria-label={`Open ${member.name}`}
              className="rounded-md p-0.5 outline-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={(event) => {
                event.stopPropagation()
                navigate(
                  isRuntime(member)
                    ? { page: 'application', id: member.id }
                    : { page: 'service', id: member.id },
                )
              }}
            >
              <ServiceIcon type={member.type} label={typeLabel(member.type)} />
            </TooltipTrigger>
            <TooltipContent>
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{member.id}</span>
                <span className="text-background/70">{member.notes ?? member.role}</span>
              </span>
            </TooltipContent>
          </Tooltip>
        ))}
        {members.length ? null : <span className="text-sm text-muted-foreground">No members</span>}
      </CardContent>
    </Card>
  )
}
