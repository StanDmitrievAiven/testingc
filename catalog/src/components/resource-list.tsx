import { useMemo, useState } from 'react'
import { SearchIcon } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ResourceTable } from '@/components/resource-table'
import { searchAll } from '@/lib/catalog'
import type { Service, ServiceType } from '@/types'

const serviceFilters: Array<{ value: 'all' | ServiceType; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pg', label: 'PostgreSQL' },
  { value: 'kafka', label: 'Kafka' },
  { value: 'kafka_connect', label: 'Connect' },
  { value: 'clickhouse', label: 'ClickHouse' },
  { value: 'opensearch', label: 'OpenSearch' },
  { value: 'datahub', label: 'DataHub' },
]

export function ResourceList({
  items,
  onOpen,
  showTypeFilter,
}: {
  items: Service[]
  onOpen: (id: string) => void
  showTypeFilter?: boolean
}) {
  const [query, setQuery] = useState('')
  const [type, setType] = useState<'all' | ServiceType>('all')
  const available = new Set(items.map((item) => item.type))

  const filtered = useMemo(() => {
    const fromSearch = query.trim() ? searchAll(query).services : items
    const allowed = new Set(items.map((item) => item.id))
    return fromSearch.filter((item) => {
      if (!allowed.has(item.id)) return false
      if (type !== 'all' && item.type !== type) return false
      return true
    })
  }, [items, query, type])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="max-w-sm">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search name, type, plan…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
        {showTypeFilter ? (
          <ToggleGroup
            value={[type]}
            onValueChange={(value) => {
              const next = value[0] as 'all' | ServiceType | undefined
              if (next) setType(next)
            }}
          >
            {serviceFilters
              .filter((item) => item.value === 'all' || available.has(item.value))
              .map((item) => (
                <ToggleGroupItem key={item.value} value={item.value}>
                  {item.label}
                </ToggleGroupItem>
              ))}
          </ToggleGroup>
        ) : null}
      </div>
      {filtered.length ? (
        <ResourceTable items={filtered} onOpen={onOpen} />
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No resources match</EmptyTitle>
            <EmptyDescription>Try another name or clear the type filter.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
