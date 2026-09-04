import { useMemo, useState } from 'react'
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
import { catalog } from '@/data/catalog'
import { isRuntime, kindLabel, searchAll, serviceById, typeLabel } from '@/lib/catalog'
import type { Navigate, Route } from '@/lib/routes'

const limit = 6

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

  const hits = useMemo(() => (q ? searchAll(q) : undefined), [q])
  const columns = useMemo(
    () =>
      q
        ? catalog.assets
            .flatMap((asset) =>
              asset.columns
                .filter((column) => column.name.toLowerCase().includes(q))
                .map((column) => ({ asset, column: column.name })),
            )
            .slice(0, limit)
        : [],
    [q],
  )

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
          placeholder="Search services, tables, columns…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>
            {q ? 'No matches.' : 'Type to search services, tables, and columns.'}
          </CommandEmpty>
          {hits?.services.length ? (
            <CommandGroup heading="Services">
              {hits.services.slice(0, limit).map((service) => (
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
                  <CommandShortcut>{typeLabel(service.type)}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {hits?.assets.length ? (
            <CommandGroup heading="Tables and topics">
              {hits.assets.slice(0, limit).map((asset) => (
                <CommandItem
                  key={asset.id}
                  value={asset.id}
                  onSelect={() => go({ page: 'catalog', assetId: asset.id })}
                >
                  <span className="truncate">{asset.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {serviceById(asset.serviceId)?.name ?? asset.serviceId}
                  </span>
                  <CommandShortcut>{kindLabel[asset.kind] ?? asset.kind}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {columns.length ? (
            <CommandGroup heading="Columns">
              {columns.map(({ asset, column }) => (
                <CommandItem
                  key={`${asset.id}.${column}`}
                  value={`${asset.id}.${column}`}
                  onSelect={() => go({ page: 'lineage', assetId: asset.id, column })}
                >
                  <span className="truncate">{column}</span>
                  <span className="truncate text-xs text-muted-foreground">{asset.name}</span>
                  <CommandShortcut>Lineage</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {hits?.stacks.length ? (
            <CommandGroup heading="Stacks">
              {hits.stacks.slice(0, limit).map((stack) => (
                <CommandItem
                  key={stack.id}
                  value={stack.id}
                  onSelect={() => go({ page: 'stack', id: stack.id })}
                >
                  <span className="truncate">{stack.name}</span>
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
