import { Badge } from '@/components/ui/badge'
import { ServiceIcon } from '@/lib/aiven-service-icons/ServiceIcon'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { assetsForService, typeLabel } from '@/lib/catalog'
import type { Service } from '@/types'

export function ResourceTable({
  items,
  onOpen,
  extra,
}: {
  items: Service[]
  onOpen: (id: string) => void
  extra?: (item: Service) => string
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Plan</TableHead>
          <TableHead>Cloud</TableHead>
          <TableHead>State</TableHead>
          <TableHead className="text-right">Assets</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id} className="cursor-pointer" onClick={() => onOpen(item.id)}>
            <TableCell>
              <div className="flex items-center gap-2.5">
                <ServiceIcon type={item.type} label={typeLabel(item.type)} />
                <div>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-xs text-muted-foreground">{extra?.(item) ?? item.role}</div>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{typeLabel(item.type)}</Badge>
            </TableCell>
            <TableCell>{item.plan ?? '—'}</TableCell>
            <TableCell>{item.cloud ?? 'aws-eu-west-1'}</TableCell>
            <TableCell>
              <Badge variant={item.state === 'RUNNING' ? 'default' : 'outline'}>
                {item.state === 'RUNNING' ? 'Running' : 'Powered off'}
              </Badge>
            </TableCell>
            <TableCell className="text-right">{assetsForService(item.id).length}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
