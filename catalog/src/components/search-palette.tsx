import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandInput,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { behaviourTags, isRuntime, kindLabel, searchAll, serviceById, typeLabel } from '@/lib/catalog'
import { useCatalogEdits } from '@/lib/catalog-edits'
import type { Navigate, Route } from '@/lib/routes'

const limit = 6

/**
 * Why a result matched, and any tag that should change what you do with it. A hit on a description
 * looks nothing like a hit on a name, and `agent-blocked` is worth seeing before the result opens
 * rather than after.
 */
function Why({ why, tags }: { why: string; tags: string[] }) {
  const warn = tags.filter((tag) => behaviourTags.includes(tag))
  if (!why && !warn.length) return null
  return (
    <span className="flex items-center gap-1.5">
      {warn.map((tag) => (
        <Badge key={tag} variant={tag === 'agent-blocked' ? 'destructive' : 'warning'}>
          {tag}
        </Badge>
      ))}
      {why && why !== 'name' ? <span className="text-xs text-muted-foreground">{why}</span> : null}
    </span>
  )
}

export function SearchPalette({
  open,
  onOpenChange,
  navigate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  navigate: Navigate
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  // Tags a person added in this browser are searchable straight away, so re-run when they change.
  useCatalogEdits()

  const hits = useMemo(() => (q ? searchAll(q) : undefined), [q])

  const go = (route: Route) => {
    onOpenChange(false)
    setQuery('')
    navigate(route)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Jump to a service, table, or column"
    >
      {/* searchAll already filters, so cmdk must not filter a second time. */}
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search names, descriptions, tags… or tag:pii"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {q
              ? 'No matches in names, descriptions, tags or contacts.'
              : 'Search names, descriptions, column notes, tags and contacts. Start with tag: to filter by one tag.'}
          </CommandEmpty>
          {hits?.services.length ? (
            <CommandGroup heading="Services">
              {hits.services.slice(0, limit).map(({ item: service, why, tags }) => (
                <CommandItem
                  key={service.id}
                  value={service.id}
                  onSelect={() =>
                    go(
                      isRuntime(service)
                        ? { page: 'application', id: service.id }
                        : { page: 'service', id: service.id },
                    )
                  }
                >
                  <span className="truncate">{service.name}</span>
                  <Why why={why} tags={tags} />
                  <CommandShortcut>{typeLabel(service.type)}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {hits?.assets.length ? (
            <CommandGroup heading="Tables and topics">
              {hits.assets.slice(0, limit).map(({ item: asset, why, tags }) => (
                <CommandItem
                  key={asset.id}
                  value={asset.id}
                  onSelect={() => go({ page: 'catalog', assetId: asset.id })}
                >
                  <span className="truncate">{asset.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {serviceById(asset.serviceId)?.name ?? asset.serviceId}
                  </span>
                  <Why why={why} tags={tags} />
                  <CommandShortcut>{kindLabel[asset.kind] ?? asset.kind}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {hits?.columns.length ? (
            <CommandGroup heading="Columns">
              {hits.columns.slice(0, limit).map(({ item: { asset, column }, why, tags }) => (
                <CommandItem
                  key={`${asset.id}.${column.name}`}
                  value={`${asset.id}.${column.name}`}
                  onSelect={() => go({ page: 'lineage', assetId: asset.id, column: column.name })}
                >
                  <span className="truncate">{column.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{asset.name}</span>
                  <Why why={why} tags={tags} />
                  <CommandShortcut>Lineage</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {hits?.stacks.length ? (
            <CommandGroup heading="Stacks">
              {hits.stacks.slice(0, limit).map(({ item: stack, why, tags }) => (
                <CommandItem
                  key={stack.id}
                  value={stack.id}
                  onSelect={() => go({ page: 'stack', id: stack.id })}
                >
                  <span className="truncate">{stack.name}</span>
                  <Why why={why} tags={tags} />
                  <CommandShortcut>{stack.kind}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
