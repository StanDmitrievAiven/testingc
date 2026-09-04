import { useEffect, useState } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { SearchPalette } from '@/components/search-palette'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { hashToRoute, routeToHash, type Route } from '@/lib/routes'
import { ServiceDetailPage, StackDetailPage } from '@/views/detail-pages'
import { LineagePage } from '@/views/lineage-page'
import { ApplicationsPage, ServicesPage, StacksPage } from '@/views/list-pages'
import { CatalogPage } from '@/views/catalog-page'
import { OverviewPage } from '@/views/overview-page'

export default function App() {
  const [route, setRoute] = useState<Route>(() => hashToRoute(window.location.hash))
  const [searchOpen, setSearchOpen] = useState(false)

  // The hash is the single source of truth, so back/forward and shared links work.
  useEffect(() => {
    const onHashChange = () => setRoute(hashToRoute(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const navigate = (next: Route) => {
    const hash = routeToHash(next)
    if (window.location.hash === hash) return
    window.location.hash = hash
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar route={route} navigate={navigate} onSearch={() => setSearchOpen(true)} />
        <SidebarInset className="min-w-0 overflow-hidden">
          <div className="flex h-svh min-h-0 flex-col overflow-hidden">
            {route.page === 'overview' ? <OverviewPage navigate={navigate} /> : null}
            {route.page === 'services' ? <ServicesPage navigate={navigate} /> : null}
            {route.page === 'applications' ? <ApplicationsPage navigate={navigate} /> : null}
            {route.page === 'stacks' ? <StacksPage navigate={navigate} /> : null}
            {route.page === 'service' || route.page === 'application' ? (
              <ServiceDetailPage id={route.id} navigate={navigate} />
            ) : null}
            {route.page === 'stack' ? <StackDetailPage id={route.id} navigate={navigate} /> : null}
            {route.page === 'catalog' ? <CatalogPage navigate={navigate} assetId={route.assetId} /> : null}
            {route.page === 'lineage' ? (
              <LineagePage
                navigate={navigate}
                stackId={route.stackId}
                assetId={route.assetId}
                column={route.column}
              />
            ) : null}
          </div>
        </SidebarInset>
        <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} navigate={navigate} />
      </SidebarProvider>
    </TooltipProvider>
  )
}
