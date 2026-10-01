// Who answers for a service, a schema or a table.
//
// Built as a sibling of TagEditor rather than a generalisation of it: the two look alike and behave
// differently. A tag comes from a vocabulary and is one word; an owner is a name somebody types, it
// is either a person or a group, and — the part that matters — it falls down the tree, so a table
// with no owner shows the schema's and says where it came from.
//
// The suggestions are only people and groups already named in this project: the technical contacts
// Aiven holds, whoever appears in the event log, and any owner already assigned somewhere else. No
// invented teams, because an org chart nobody agreed to is worse than an empty field.
import { useState } from 'react'
import { PlusIcon, UserIcon, UsersIcon, XIcon } from 'lucide-react'
import { badgeVariants } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { displayName, knownOwners, observedPeople } from '@/lib/catalog'
import { cn } from '@/lib/utils'
import type { Owner } from '@/types'

export function OwnerEditor({
  owners,
  inheritedFrom,
  onChange,
  label,
}: {
  owners: Owner[]
  /** Set when these owners belong to something further up the tree rather than to this thing. */
  inheritedFrom?: string
  onChange: (next: Owner[]) => void
  /** Names what is being owned, for the accessible label of the add button. */
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const taken = new Set(owners.map((owner) => owner.name.toLowerCase()))

  const add = (owner: Owner) => {
    // Adding to an inherited list starts a list of this thing's own, which is the intent: you are
    // overriding the schema, not editing it from a page that does not belong to it.
    if (!taken.has(owner.name.toLowerCase())) onChange([...(inheritedFrom ? [] : owners), owner])
    setOpen(false)
    setQuery('')
  }

  const typed = query.trim().replace(/\s+/g, ' ')
  const offerTyped = Boolean(typed) && !taken.has(typed.toLowerCase())
  const suggestions = [...knownOwners(), ...observedPeople()].filter(
    (owner, index, all) =>
      !taken.has(owner.name.toLowerCase()) &&
      all.findIndex((other) => other.name.toLowerCase() === owner.name.toLowerCase()) === index,
  )

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {owners.map((owner) => (
        <Tooltip key={owner.name}>
          <TooltipTrigger
            aria-label={inheritedFrom ? `${owner.name}, inherited` : `Remove owner ${owner.name}`}
            disabled={Boolean(inheritedFrom)}
            className={cn(
              badgeVariants({ variant: inheritedFrom ? 'outline' : 'secondary' }),
              'gap-1',
              inheritedFrom ? 'opacity-70' : 'pr-1 hover:bg-destructive/10 hover:text-destructive',
            )}
            onClick={() => {
              if (!inheritedFrom) onChange(owners.filter((item) => item.name !== owner.name))
            }}
          >
            {owner.kind === 'group' ? <UsersIcon className="size-3" /> : <UserIcon className="size-3" />}
            {owner.name}
            {inheritedFrom ? null : <XIcon className="size-3 opacity-60" />}
          </TooltipTrigger>
          <TooltipContent>
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">
                {owner.name} · {owner.kind}
              </span>
              <span className="text-background/70">
                {inheritedFrom
                  ? `Inherited from ${displayName(inheritedFrom)}. Add an owner here to override it.`
                  : 'Declared here, rather than observed from the event log.'}
              </span>
              {inheritedFrom ? null : <span className="text-background/50">Click to remove</span>}
            </span>
          </TooltipContent>
        </Tooltip>
      ))}

      {inheritedFrom ? (
        <span className="text-xs text-muted-foreground">inherited from {displayName(inheritedFrom)}</span>
      ) : null}

      <Button
        variant="ghost"
        size="sm"
        className="gap-1"
        aria-label={`Add an owner to ${label}`}
        onClick={() => setOpen(true)}
      >
        <PlusIcon className="size-4" />
        {owners.length && !inheritedFrom ? 'Owner' : inheritedFrom ? 'Override owner' : 'Owner'}
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={`Owner of ${label}`}
        description="A group is the steadier answer, since people move on and teams stay"
      >
        <Command>
          <CommandInput placeholder="Name a person or a group…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>Nobody here by that name. Type one to add them.</CommandEmpty>
            {offerTyped ? (
              // Group first, deliberately: it is the answer that survives somebody changing jobs.
              <CommandGroup heading={`Add "${typed}"`}>
                <CommandItem value={`group ${typed}`} forceMount onSelect={() => add({ name: typed, kind: 'group' })}>
                  <UsersIcon className="size-4 shrink-0" />
                  <span className="truncate">as a group</span>
                  <span className="truncate text-xs text-muted-foreground">
                    A team or squad. Stays valid when people move on.
                  </span>
                </CommandItem>
                <CommandItem value={`person ${typed}`} forceMount onSelect={() => add({ name: typed, kind: 'person' })}>
                  <UserIcon className="size-4 shrink-0" />
                  <span className="truncate">as a person</span>
                  <span className="truncate text-xs text-muted-foreground">
                    One named human. Worth revisiting when they change team.
                  </span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {suggestions.length ? (
              <CommandGroup heading="Already named in this project">
                {suggestions.map((owner) => (
                  <CommandItem key={owner.name} value={owner.name} onSelect={() => add(owner)}>
                    {owner.kind === 'group' ? (
                      <UsersIcon className="size-4 shrink-0" />
                    ) : (
                      <UserIcon className="size-4 shrink-0" />
                    )}
                    <span className="truncate">{owner.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{owner.kind}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  )
}
