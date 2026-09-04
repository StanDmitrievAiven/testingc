import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LineageCanvas } from '@/components/lineage/lineage-canvas'
import { PageHeader } from '@/components/page-header'
import { ServiceIcon } from '@/lib/aiven-service-icons/ServiceIcon'
import { ICON_SIZES } from '@/lib/aiven-service-icons/icons.js'
import {
  assetsForService,
  formatCount,
  integrationsFor,
  isRuntime,
  serviceById,
  stackById,
  stackMembers,
  stacksForService,
  typeLabel,
} from '@/lib/catalog'
import { changesForService, fetchLiveChanges } from '@/lib/context-log'
import { buildDatasetGraph, buildServiceGraph } from '@/lib/lineage-graph'
import type { Navigate } from '@/lib/routes'
import { GitForkIcon } from 'lucide-react'
import type { ContextChange, Service } from '@/types'

function StateBadge({ state }: { state: Service['state'] }) {
  return <Badge variant={state === 'RUNNING' ? 'default' : 'outline'}>{state === 'RUNNING' ? 'Running' : 'Powered off'}</Badge>
}

function openResource(id: string, navigate: Navigate) {
  const service = serviceById(id)
  navigate(service && isRuntime(service) ? { page: 'application', id } : { page: 'service', id })
}

function OverviewFields({ service }: { service: Service }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {[
        ['Type', typeLabel(service.type)],
        ['Kind', isRuntime(service) ? 'Application runtime' : 'Service'],
        ['State', service.state],
        ['Plan', service.plan ?? '—'],
        ['Version', service.version ?? '—'],
        ['Cloud', service.cloud ?? 'aws-eu-west-1'],
      ].map(([label, value]) => (
        <Card key={label}>
          <CardHeader>
            <CardDescription>{label}</CardDescription>
            <CardTitle className="text-base">{value}</CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}

function AssetTable({ serviceId, navigate }: { serviceId: string; navigate: Navigate }) {
  const assets = assetsForService(serviceId)
  if (!assets.length) {
    return <p className="text-sm text-muted-foreground">No catalogued datasets on this resource.</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Kind</TableHead>
          <TableHead>Schema</TableHead>
          <TableHead>Columns</TableHead>
          <TableHead className="text-right">Rows</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assets.map((asset) => (
          <TableRow
            key={asset.id}
            className="cursor-pointer"
            onClick={() => navigate({ page: 'catalog', assetId: asset.id })}
          >
            <TableCell>
              <div className="font-medium">{asset.name}</div>
              <div className="text-xs text-muted-foreground">{asset.description}</div>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{asset.kind}</Badge>
            </TableCell>
            <TableCell>{asset.schema ?? '—'}</TableCell>
            <TableCell>{asset.columns.length}</TableCell>
            <TableCell className="text-right">{formatCount(asset.rowCount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function IntegrationTable({ serviceId, navigate }: { serviceId: string; navigate: Navigate }) {
  const items = integrationsFor(serviceId)
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">No integrations recorded.</p>
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>From</TableHead>
          <TableHead>To</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell className="font-medium">
              {item.type}
              {/* Flags the rows that describe a real data path Aiven has no integration object for. */}
              {item.origin ? (
                <Badge variant="outline" className="ml-1.5 font-normal">
                  {item.origin === 'connector' ? 'Connector' : 'App config'}
                </Badge>
              ) : null}
            </TableCell>
            <TableCell>
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => openResource(item.sourceServiceId, navigate)}>
                {item.sourceServiceId}
              </button>
            </TableCell>
            <TableCell>
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => openResource(item.destServiceId, navigate)}>
                {item.destServiceId}
              </button>
            </TableCell>
            <TableCell>
              <Badge variant={item.active ? 'default' : 'outline'}>{item.active ? 'Active' : 'Inactive'}</Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{item.description}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

const statusVariant = { ok: 'default', error: 'destructive', pending: 'outline' } as const

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function ChangeTimeline({ serviceId }: { serviceId: string }) {
  const snapshot = changesForService(serviceId)
  // Tagged with the service it was fetched for, so switching services falls back to that service's
  // snapshot during the render rather than needing the effect to clear stale rows first.
  const [live, setLive] = useState<{ serviceId: string; rows: ContextChange[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    // No error branch: the proxy being down is the normal case, and the snapshot already renders.
    fetchLiveChanges(serviceId).then(
      (rows) => {
        if (!cancelled) setLive({ serviceId, rows })
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [serviceId])

  const fresh = live?.serviceId === serviceId ? live.rows : null
  const changes = fresh ?? snapshot

  if (!changes.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No changes recorded for this service. Only mutations made through the local MCP proxy appear here.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="outline">{fresh ? 'Live' : 'Snapshot'}</Badge>
        <span>
          {changes.length} recorded {changes.length === 1 ? 'change' : 'changes'}, newest first. Every one carries the
          purpose its author had to write before the call went through.
        </span>
      </div>
      {changes.map((change) => (
        <div key={change.id} className="flex flex-col gap-1 border-l-2 pl-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium">v{change.version}</span>
            <Badge variant="secondary">{change.operation}</Badge>
            <Badge variant={statusVariant[change.status]}>{change.status}</Badge>
            <span className="text-xs text-muted-foreground">
              {when(change.createdAt)} · {change.toolName}
              {change.durationMs == null ? '' : ` · ${change.durationMs}ms`} · {change.clientName}
            </span>
          </div>
          <p className="text-sm">{change.purpose || '(no purpose recorded)'}</p>
          {change.errorText ? <p className="text-xs text-destructive">{change.errorText}</p> : null}
        </div>
      ))}
    </div>
  )
}

export function ServiceDetailPage({ id, navigate }: { id: string; navigate: Navigate }) {
  const [tab, setTab] = useState('overview')
  const service = serviceById(id)
  if (!service) return null
  const stacks = stacksForService(id)
  const focused = buildServiceGraph(undefined, { focusId: id })
  const listPage = isRuntime(service) ? 'applications' : 'services'
  const listLabel = isRuntime(service) ? 'Applications' : 'Services'

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'data-innovation-summit', onClick: () => navigate({ page: 'overview' }) },
          { label: listLabel, onClick: () => navigate({ page: listPage }) },
          { label: service.name },
        ]}
        actions={
          <Button variant="outline" onClick={() => navigate({ page: 'lineage' })}>
            <GitForkIcon data-icon="inline-start" />
            Open lineage
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6 [&>*]:shrink-0">
        <div className="flex items-center gap-3">
          <ServiceIcon type={service.type} label={typeLabel(service.type)} size={ICON_SIZES.detailHeader} />
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="type-large-heading">{service.name}</h1>
              <StateBadge state={service.state} />
              <Badge variant="secondary">{isRuntime(service) ? 'Runtime' : 'Service'}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{service.notes ?? service.role}</p>
          </div>
        </div>
        {stacks.length ? (
          <div className="flex flex-wrap gap-1.5">
            {stacks.map((stack) => (
              <Button key={stack.id} variant="outline" size="sm" onClick={() => navigate({ page: 'stack', id: stack.id })}>
                Stack: {stack.name}
              </Button>
            ))}
          </div>
        ) : null}

        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <TabsList variant="line">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="datasets">{isRuntime(service) ? 'Connected data' : 'Databases'}</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="lineage">Lineage</TabsTrigger>
            <TabsTrigger value="changes">Changes</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="pt-4">
            <OverviewFields service={service} />
          </TabsContent>
          <TabsContent value="datasets" className="pt-4">
            <AssetTable serviceId={id} navigate={navigate} />
          </TabsContent>
          <TabsContent value="integrations" className="pt-4">
            <IntegrationTable serviceId={id} navigate={navigate} />
          </TabsContent>
          <TabsContent value="lineage" className="pt-4">
            {tab === 'lineage' ? (
              <div className="h-[480px]">
                <LineageCanvas
                  graphKey={`focus-${id}`}
                  nodes={focused.nodes}
                  edges={focused.edges}
                  onSelect={(node) => openResource(node.entityId, navigate)}
                />
              </div>
            ) : null}
          </TabsContent>
          <TabsContent value="changes" className="pt-4">
            {tab === 'changes' ? <ChangeTimeline serviceId={id} /> : null}
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}

export function StackDetailPage({ id, navigate }: { id: string; navigate: Navigate }) {
  const [tab, setTab] = useState('members')
  const stack = stackById(id)
  if (!stack) return null
  const members = stackMembers(stack)
  const serviceGraph = buildServiceGraph(id)
  const datasetGraph = buildDatasetGraph(id)

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'data-innovation-summit', onClick: () => navigate({ page: 'overview' }) },
          { label: 'Stacks', onClick: () => navigate({ page: 'stacks' }) },
          { label: stack.name },
        ]}
        actions={
          <Button onClick={() => navigate({ page: 'lineage', stackId: id })}>
            <GitForkIcon data-icon="inline-start" />
            Open stack lineage
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-6 [&>*]:shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">{stack.name}</h1>
          <Badge variant="secondary">{stack.kind}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{stack.description}</p>

        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <TabsList variant="line">
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="lineage">Service lineage</TabsTrigger>
            <TabsTrigger value="datasets">Dataset lineage</TabsTrigger>
          </TabsList>
          <TabsContent value="members" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Runtimes and services</CardTitle>
                <CardDescription>Everything that makes up this product.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {members.map((member) => (
                      <TableRow
                        key={member.id}
                        className="cursor-pointer"
                        onClick={() => openResource(member.id, navigate)}
                      >
                        <TableCell className="font-medium">{member.name}</TableCell>
                        <TableCell>{isRuntime(member) ? 'Runtime' : 'Service'}</TableCell>
                        <TableCell>{typeLabel(member.type)}</TableCell>
                        <TableCell>
                          <StateBadge state={member.state} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="lineage" className="pt-4">
            {tab === 'lineage' ? (
              <div className="h-[520px]">
                <LineageCanvas
                  graphKey={`stack-svc-${id}`}
                  nodes={serviceGraph.nodes}
                  edges={serviceGraph.edges}
                  onSelect={(node) => openResource(node.entityId, navigate)}
                />
              </div>
            ) : null}
          </TabsContent>
          <TabsContent value="datasets" className="pt-4">
            {tab === 'datasets' ? (
              <div className="h-[520px]">
                <LineageCanvas
                  graphKey={`stack-ds-${id}`}
                  nodes={datasetGraph.nodes}
                  edges={datasetGraph.edges}
                  onSelect={(node) => navigate({ page: 'lineage', assetId: node.entityId, column: node.column, stackId: id })}
                />
              </div>
            ) : null}
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
