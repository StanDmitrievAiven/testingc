import { useMemo, useState } from 'react'
import {
  AppWindowIcon,
  BoxIcon,
  ChevronRightIcon,
  GitForkIcon,
  LayoutGridIcon,
  SearchIcon,
  ServerIcon,
} from 'lucide-react'
import { CatalogTree } from '@/components/catalog-tree'
import { ScrollArea } from '@/components/ui/scroll-area'
import { catalog } from '@/data/catalog'
import { catalogTree, isRuntime, managedServices, runtimes, treeAncestors, type TreeNode } from '@/lib/catalog'
import type { Navigate, Route } from '@/lib/routes'
import { cn } from '@/lib/utils'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'

function selectedIdFor(route: Route): string | undefined {
  if (route.page === 'catalog') return route.assetId
  if (route.page === 'service' || route.page === 'application') return route.id
  return undefined
}

export function AppSidebar({
  route,
  navigate,
  onSearch,
}: {
  route: Route
  navigate: Navigate
  onSearch: () => void
}) {
  const [query, setQuery] = useState('')
  const page = route.page
  const services = useMemo(() => catalogTree(managedServices()), [])
  const apps = useMemo(() => catalogTree(runtimes()), [])
  const selectedId = selectedIdFor(route)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Branches the user opened stay open. The path *to* the selection is revealed as well,
  // but never the selection itself, so opening a service does not expand it.
  const openIds = useMemo(
    () => new Set([...expanded, ...(selectedId ? treeAncestors(selectedId).slice(0, -1) : [])]),
    [expanded, selectedId],
  )
  const q = query.trim().toLowerCase()

  // The two explorer sections start collapsed; a filter reveals them so matches are never hidden.
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const groupOpen = (key: string) => openGroups.has(key) || Boolean(q)
  const toggleGroup = (key: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const onToggle = (id: string, open: boolean) =>
    setExpanded((prev) => {
      if (prev.has(id) === open) return prev
      const next = new Set(prev)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })

  const onSelect = (node: TreeNode) => {
    if (node.kind !== 'service') {
      navigate({ page: 'catalog', assetId: node.id })
      return
    }
    const service = catalog.services.find((item) => item.id === node.serviceId)
    navigate(service && isRuntime(service) ? { page: 'application', id: node.id } : { page: 'service', id: node.id })
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton>
              <BoxIcon />
              <span>{catalog.project}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onSearch}>
              <SearchIcon />
              <span>Search</span>
              <SidebarMenuBadge>⌘K</SidebarMenuBadge>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={page === 'overview'} onClick={() => navigate({ page: 'overview' })}>
                  <LayoutGridIcon />
                  <span>Overview</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton isActive={page === 'lineage'} onClick={() => navigate({ page: 'lineage' })}>
                  <GitForkIcon />
                  <span>Lineage</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={page === 'stacks' || page === 'stack'}
                  onClick={() => navigate({ page: 'stacks' })}
                >
                  <BoxIcon />
                  <span>Stacks</span>
                  <SidebarMenuBadge>{catalog.stacks.length}</SidebarMenuBadge>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup className="min-h-0 flex-1">
          <SidebarGroupLabel>Explorer</SidebarGroupLabel>
          <SidebarGroupContent className="flex min-h-0 flex-1 flex-col gap-1">
            <SidebarInput
              className="group-data-[collapsible=icon]:hidden"
              placeholder="Filter services, tables…"
              value={query}
              onValueChange={setQuery}
            />
            {/* The tree scrolls inside a bounded region so it never pushes the nav around. */}
            <ScrollArea className="min-h-0 flex-1">
              <SidebarMenu className="pr-2">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={page === 'services'}
                    onClick={() => {
                      toggleGroup('services')
                      navigate({ page: 'services' })
                    }}
                  >
                    <ChevronRightIcon
                      className={cn(
                        'transition-transform duration-150 group-data-[collapsible=icon]:hidden',
                        groupOpen('services') && 'rotate-90',
                      )}
                    />
                    <ServerIcon />
                    <span>Services</span>
                    <SidebarMenuBadge>{services.length}</SidebarMenuBadge>
                  </SidebarMenuButton>
                  {groupOpen('services') ? (
                    <div className="group-data-[collapsible=icon]:hidden">
                      <CatalogTree
                        nodes={services}
                        query={q}
                        selectedId={selectedId}
                        openIds={openIds}
                        onSelect={onSelect}
                        onToggle={onToggle}
                      />
                    </div>
                  ) : null}
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={page === 'applications'}
                    onClick={() => {
                      toggleGroup('applications')
                      navigate({ page: 'applications' })
                    }}
                  >
                    <ChevronRightIcon
                      className={cn(
                        'transition-transform duration-150 group-data-[collapsible=icon]:hidden',
                        groupOpen('applications') && 'rotate-90',
                      )}
                    />
                    <AppWindowIcon />
                    <span>Applications</span>
                    <SidebarMenuBadge>{apps.length}</SidebarMenuBadge>
                  </SidebarMenuButton>
                  {groupOpen('applications') ? (
                    <div className="group-data-[collapsible=icon]:hidden">
                      <CatalogTree
                        nodes={apps}
                        query={q}
                        selectedId={selectedId}
                        openIds={openIds}
                        onSelect={onSelect}
                        onToggle={onToggle}
                      />
                    </div>
                  ) : null}
                </SidebarMenuItem>
              </SidebarMenu>
            </ScrollArea>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton>
              <span className="truncate text-xs text-muted-foreground">{catalog.organization}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
