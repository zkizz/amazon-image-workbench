import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import { CloseIcon, EditIcon, HelpCircleIcon, InstallIcon, PhotoIcon, SettingsIcon, SidebarLeftIcon, SidebarRightIcon, TagIcon } from './icons'
import { Button } from './Button'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type AppView = 'home' | 'generate' | 'reverse' | 'editor' | 'tagger'

type HeaderProps = {
  activeView: AppView
  onNavigate: (view: AppView) => void
  navCollapsed: boolean
  onToggleNav: () => void
}

type NavItem = {
  id: AppView
  label: string
  Icon: typeof PhotoIcon
}

const navs: NavItem[] = [
  { id: 'home', label: '图片工作台', Icon: PhotoIcon },
  { id: 'generate', label: '通用生图', Icon: PhotoIcon },
  { id: 'reverse', label: '反推提示词', Icon: PhotoIcon },
  { id: 'editor', label: '图片编辑', Icon: EditIcon },
  { id: 'tagger', label: 'AI 人物打标', Icon: TagIcon },
]

function isInstalledPwa() {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

function NavList({ activeView, onNavigate, navCollapsed }: HeaderProps) {
  return (
    <nav className="space-y-1" aria-label="工作区导航">
      {navs.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onNavigate(id)}
          className={`flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition ${activeView === id ? 'bg-gray-200/80 text-gray-950 dark:bg-white/[0.12] dark:text-white' : 'text-gray-600 hover:bg-gray-200/60 hover:text-gray-950 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-100'}`}
        >
          <Icon className="h-[18px] w-[18px] shrink-0" />
          {!navCollapsed && <span className="truncate">{label}</span>}
        </button>
      ))}
    </nav>
  )
}

export default function Header({ activeView, onNavigate, navCollapsed, onToggleNav }: HeaderProps) {
  const setShowSettings = useStore((s) => s.setShowSettings)
  const showSettings = useStore((s) => s.showSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const [showHelp, setShowHelp] = useState(false)
  const [showNav, setShowNav] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isPwaInstalled, setIsPwaInstalled] = useState(isInstalledPwa)

  const installTooltip = useTooltip()
  const helpTooltip = useTooltip()
  const settingsTooltip = useTooltip()
  const title = showSettings ? '设置' : navs.find((item) => item.id === activeView)?.label ?? '图片工作台'

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      setIsPwaInstalled(false)
    }
    const onInstalled = () => {
      setInstallPrompt(null)
      setIsPwaInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const go = (view: AppView) => {
    setShowSettings(false)
    onNavigate(view)
    setShowNav(false)
  }

  const install = async () => {
    if (installPrompt) {
      const event = installPrompt
      setInstallPrompt(null)
      try {
        await event.prompt()
        const choice = await event.userChoice
        setIsPwaInstalled(choice.outcome === 'accepted')
      } catch {
        setIsPwaInstalled(isInstalledPwa())
      }
      return
    }

    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    setConfirmDialog({
      title: '安装为应用',
      message: isIos
        ? '在 Safari 浏览器中，点击底部「分享」按钮，选择「添加到主屏幕」即可安装此应用。'
        : '请在浏览器的菜单中选择「添加到主屏幕」或「安装应用」。\n\n（如果在微信等内置浏览器中，请先在外部浏览器打开）',
      showCancel: false,
      confirmText: '我知道了',
      icon: 'info',
      action: () => {},
    })
  }

  return (
    <>
      <aside data-no-drag-select className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-black/[0.08] bg-[#f7f7f8] p-3 transition-[width] dark:border-white/[0.08] dark:bg-[#171717] lg:flex ${navCollapsed ? 'w-16' : 'w-64'}`}>
        <button type="button" onClick={() => go('home')} className="flex h-10 items-center gap-2 rounded-lg px-2 text-left text-sm font-semibold text-gray-900 hover:bg-black/[0.05] dark:text-gray-100 dark:hover:bg-white/[0.08]">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gray-900 text-xs font-bold text-white dark:bg-white dark:text-gray-900">A</span>
          {!navCollapsed && <span className="truncate">Amazon Image</span>}
        </button>
        <div className="mt-5">
          {!navCollapsed && <p className="px-3 pb-2 text-[11px] font-medium text-gray-500 dark:text-gray-500">工作区</p>}
          <NavList activeView={activeView} onNavigate={go} navCollapsed={navCollapsed} onToggleNav={onToggleNav} />
        </div>
        <div className="mt-auto border-t border-black/[0.06] pt-3 dark:border-white/[0.08]">
          <button type="button" onClick={() => setShowSettings(true)} className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-gray-600 transition hover:bg-gray-200/60 hover:text-gray-950 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-100">
            <SettingsIcon className="h-[18px] w-[18px]" />
            {!navCollapsed && '设置'}
          </button>
          <button type="button" onClick={onToggleNav} className="mt-1 flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-gray-600 transition hover:bg-gray-200/60 hover:text-gray-950 dark:text-gray-400 dark:hover:bg-white/[0.08] dark:hover:text-gray-100" title={navCollapsed ? '展开导航' : '收起导航'}>
            {navCollapsed ? <SidebarRightIcon className="h-[18px] w-[18px]" /> : <SidebarLeftIcon className="h-[18px] w-[18px]" />}
            {!navCollapsed && '收起导航'}
          </button>
        </div>
      </aside>

      <header data-no-drag-select className={`safe-area-top fixed left-0 right-0 top-0 z-30 border-b border-black/[0.06] bg-white/80 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#212121]/80 ${navCollapsed ? 'lg:left-16' : 'lg:left-64'}`}>
        <div className="safe-area-x safe-header-inner flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Button onClick={() => setShowNav(true)} variant="plain" size="icon" className="lg:hidden" aria-label="打开导航">
              <SidebarLeftIcon className="h-5 w-5" />
            </Button>
            <h1 className="truncate text-[15px] font-semibold text-gray-900 dark:text-gray-100">{title}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {!isPwaInstalled && (
              <div className="relative" {...installTooltip.handlers}>
                <Button onClick={() => { dismissAllTooltips(); void install() }} variant="plain" size="icon" className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100" aria-label="安装为应用">
                  <InstallIcon className="h-5 w-5" />
                </Button>
                <ViewportTooltip visible={installTooltip.visible} className="whitespace-nowrap">安装为应用</ViewportTooltip>
              </div>
            )}
            <div className="relative" {...helpTooltip.handlers}>
              <Button onClick={() => { dismissAllTooltips(); setShowHelp(true) }} variant="plain" size="icon" className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100" aria-label="操作指南">
                <HelpCircleIcon className="h-5 w-5" />
              </Button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">操作指南</ViewportTooltip>
            </div>
            <div className="relative lg:hidden" {...settingsTooltip.handlers}>
              <Button onClick={() => setShowSettings(true)} variant="plain" size="icon" className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100" aria-label="设置">
                <SettingsIcon className="h-5 w-5" />
              </Button>
              <ViewportTooltip visible={settingsTooltip.visible} className="whitespace-nowrap">设置</ViewportTooltip>
            </div>
          </div>
        </div>
      </header>

      {showNav && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="工作区导航">
          <button type="button" className="absolute inset-0 bg-black/35" onClick={() => setShowNav(false)} aria-label="关闭导航" />
          <aside className="safe-area-top relative flex h-full w-[min(18rem,82vw)] flex-col bg-[#f7f7f8] p-3 shadow-2xl dark:bg-[#171717]">
            <div className="flex h-10 items-center justify-between px-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Amazon Image</span>
              <Button onClick={() => setShowNav(false)} variant="plain" size="icon" aria-label="关闭导航"><CloseIcon className="h-5 w-5" /></Button>
            </div>
            <div className="mt-5"><NavList activeView={activeView} onNavigate={go} navCollapsed={false} onToggleNav={onToggleNav} /></div>
            <button type="button" onClick={() => { setShowNav(false); setShowSettings(true) }} className="mt-auto flex h-10 items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-gray-600 dark:text-gray-400">
              <SettingsIcon className="h-[18px] w-[18px]" />设置
            </button>
          </aside>
        </div>
      )}

      <div className="safe-area-top invisible pointer-events-none" aria-hidden="true"><div className="safe-header-inner" /></div>
      {showHelp && <HelpModal appMode="gallery" onClose={() => setShowHelp(false)} />}
    </>
  )
}
