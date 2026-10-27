import { useEffect, useState } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import Header from './components/Header'
import CanvasWorkspace from './components/CanvasWorkspace'
import GeneralGenerationPage from './components/GeneralGenerationPage'
import ReversePromptPage from './components/ReversePromptPage'
import ImageEditorPage from './components/ImageEditorPage'
import SyntheticPerformerTaggerPage from './components/SyntheticPerformerTaggerPage'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import { useGlobalClickSuppression } from './lib/clickSuppression'

export type AppView = 'home' | 'generate' | 'reverse' | 'editor' | 'tagger'

function getAppViewFromHash(): AppView {
  const route = window.location.hash.replace(/^#\/?/, '')
  if (route === 'generate') return 'generate'
  if (route === 'reverse') return 'reverse'
  if (route === 'editor' || route === 'seedream-pro') return 'editor'
  if (route === 'tagger') return 'tagger'
  return 'home'
}

export default function App() {
  const setSettings = useStore((s) => s.setSettings)
  const [view, setView] = useState<AppView>(getAppViewFromHash)
  const [navCollapsed, setNavCollapsed] = useState(false)
  useDockerApiUrlMigrationNotice()
  useGlobalClickSuppression()

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const nextSettings = buildSettingsFromUrlParams(useStore.getState().settings, searchParams)

    setSettings(nextSettings)

    if (hasUrlSettingParams(searchParams)) {
      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    initStore()
    useStore.getState().setAppMode('gallery')
  }, [setSettings])

  useEffect(() => {
    const syncViewFromLocation = () => {
      if (window.location.hash.replace(/^#\/?/, '') === 'seedream-pro') {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/editor`)
      }
      setView(getAppViewFromHash())
    }
    syncViewFromLocation()
    window.addEventListener('hashchange', syncViewFromLocation)
    window.addEventListener('popstate', syncViewFromLocation)
    return () => {
      window.removeEventListener('hashchange', syncViewFromLocation)
      window.removeEventListener('popstate', syncViewFromLocation)
    }
  }, [])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  const navigate = (nextView: AppView) => {
    setView(nextView)
    if (nextView !== 'home') {
      const hash = `#/${nextView}`
      if (window.location.hash !== hash) window.location.hash = `/${nextView}`
      return
    }

    const nextUrl = `${window.location.pathname}${window.location.search}`
    window.history.pushState(null, '', nextUrl)
  }

  return (
    <>
      <Header activeView={view} onNavigate={navigate} navCollapsed={navCollapsed} onToggleNav={() => setNavCollapsed((value) => !value)} />
      <main data-home-main data-drag-select-surface className={view === 'home' ? 'pb-48 lg:pb-10' : `pb-10 ${navCollapsed ? 'lg:pl-16' : 'lg:pl-64'}`}>
        <div className={view === 'generate' || view === 'reverse' ? 'w-full' : `safe-area-x mx-auto lg:!px-6 ${view === 'editor' ? 'max-w-[96rem]' : 'max-w-7xl'}`}>
          {view === 'generate' ? (
            <GeneralGenerationPage />
          ) : view === 'reverse' ? (
            <ReversePromptPage />
          ) : view === 'editor' ? (
            <ImageEditorPage />
          ) : view === 'tagger' ? (
            <SyntheticPerformerTaggerPage />
          ) : (
            <CanvasWorkspace navCollapsed={navCollapsed} />
          )}
        </div>
      </main>
      <DetailModal />
      <Lightbox />
      <SettingsModal scope={view === 'editor' ? 'editor' : 'home'} />
      <ConfirmDialog />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
    </>
  )
}
