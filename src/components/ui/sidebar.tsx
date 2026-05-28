"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { PanelLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const SIDEBAR_COOKIE_NAME = "sidebar:state"
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const SIDEBAR_WIDTH = "16rem"
const SIDEBAR_WIDTH_MOBILE = "18rem"
const SIDEBAR_WIDTH_ICON = "3rem"
const SIDEBAR_KEYBOARD_SHORTCUT = "b"

type SidebarContext = {
  state: "expanded" | "collapsed"
  open: boolean
  setOpen: (open: boolean) => void
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  isMobile: boolean
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContext | null>(null)

function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) throw new Error("useSidebar must be used within a SidebarProvider.")
  return context
}

const SidebarProvider = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & { defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void }
>(({ defaultOpen = true, open: openProp, onOpenChange: setOpenProp, className, style, children, ...props }, ref) => {
  const isMobile = useIsMobile()
  const [openMobile, setOpenMobile] = React.useState(false)
  const [_open, _setOpen] = React.useState(defaultOpen)
  const open = openProp ?? _open
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value
      if (setOpenProp) setOpenProp(openState)
      else _setOpen(openState)
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`
    },
    [setOpenProp, open]
  )
  const toggleSidebar = React.useCallback(() => (isMobile ? setOpenMobile((open) => !open) : setOpen((open) => !open)), [isMobile, setOpen, setOpenMobile])
  const state = open ? "expanded" : "collapsed"

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) { event.preventDefault(); toggleSidebar() }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleSidebar])

  return (
    <SidebarContext.Provider value={{ state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar }}>
      <TooltipProvider delayDuration={0}>
        <div
          style={{ "--sidebar-width": SIDEBAR_WIDTH, "--sidebar-width-icon": SIDEBAR_WIDTH_ICON, ...style } as React.CSSProperties}
          className={cn("group/sidebar-wrapper flex min-h-svh w-full has-[[data-variant=inset]]:bg-sidebar", className)}
          ref={ref}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  )
})
SidebarProvider.displayName = "SidebarProvider"

const Sidebar = React.forwardRef<HTMLDivElement, React.ComponentProps<"div"> & { collapsible?: "offcanvas" | "icon" | "none" }>(
  ({ collapsible = "offcanvas", className, children, ...props }, ref) => {
    const { isMobile, state, openMobile, setOpenMobile } = useSidebar()
    if (collapsible === "none") return <div className={cn("flex h-full w-[--sidebar-width] flex-col bg-sidebar text-sidebar-foreground", className)} ref={ref} {...props}>{children}</div>
    if (isMobile) {
      return (
        <Sheet open={openMobile} onOpenChange={setOpenMobile} {...props}>
          <SheetContent side="left" className="w-[--sidebar-width] bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden" style={{ "--sidebar-width": SIDEBAR_WIDTH_MOBILE } as React.CSSProperties}>
            <div className="flex h-full w-full flex-col">{children}</div>
          </SheetContent>
        </Sheet>
      )
    }
    return (
      <div ref={ref} className="group peer hidden text-sidebar-foreground md:block" data-state={state} data-collapsible={state === "collapsed" ? collapsible : ""}>
        <div className={cn("duration-200 relative h-svh w-[--sidebar-width] bg-transparent transition-[width] ease-linear", "group-data-[collapsible=offcanvas]:w-0", "group-data-[side=right]:rotate-180", collapsible === "icon" && "group-data-[state=collapsed]:w-[--sidebar-width-icon]")} />
        <div className={cn("duration-200 fixed inset-y-0 z-10 hidden h-svh w-[--sidebar-width] transition-[left,right,width] ease-linear md:flex", "left-0", collapsible === "icon" && "group-data-[state=collapsed]:w-[--sidebar-width-icon]")}>
          <div className="flex h-full w-full flex-col bg-sidebar">{children}</div>
        </div>
      </div>
    )
  }
)
Sidebar.displayName = "Sidebar"

const SidebarTrigger = React.forwardRef<React.ElementRef<typeof Button>, React.ComponentProps<typeof Button>>(
  ({ className, onClick, ...props }, ref) => {
    const { toggleSidebar } = useSidebar()
    return (
      <Button ref={ref} size="icon" variant="ghost" className={cn("h-7 w-7", className)} onClick={(event) => { onClick?.(event); toggleSidebar() }} {...props}>
        <PanelLeft />
        <span className="sr-only">Toggle Sidebar</span>
      </Button>
    )
  }
)
SidebarTrigger.displayName = "SidebarTrigger"

const SidebarRail = React.forwardRef<HTMLButtonElement, React.ComponentProps<"button">>(
  ({ className, ...props }, ref) => {
    const { toggleSidebar } = useSidebar()
    return <button ref={ref} onClick={toggleSidebar} title="Toggle Sidebar" className={cn("absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border group-data-[side=right]:left-0 sm:flex", "[[data-side=left]_&]:cursor-w-resize", "[[data-side=right]_&]:cursor-e-resize", "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize", "[[data-side=right][data-state=collapsed]_&]:cursor-w-resize", "group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full group-data-[collapsible=offcanvas]:hover:bg-sidebar", "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2", "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2", className)} {...props} />
  }
)
SidebarRail.displayName = "SidebarRail"

const SidebarInset = React.forwardRef<HTMLDivElement, React.ComponentProps<"main">>(
  ({ className, ...props }, ref) => <main ref={ref} className={cn("relative flex min-h-svh flex-1 flex-col bg-background", "peer-data-[variant=inset]:min-h-[calc(100svh-theme(spacing.4))] md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow", className)} {...props} />
)
SidebarInset.displayName = "SidebarInset"

const SidebarHeader = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(({ className, ...props }, ref) => <div ref={ref} className={cn("flex flex-col gap-2 p-2", className)} {...props} />)
SidebarHeader.displayName = "SidebarHeader"

const SidebarFooter = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(({ className, ...props }, ref) => <div ref={ref} className={cn("flex flex-col gap-2 p-2", className)} {...props} />)
SidebarFooter.displayName = "SidebarFooter"

const SidebarContent = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(({ className, ...props }, ref) => <div ref={ref} className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden", className)} {...props} />)
SidebarContent.displayName = "SidebarContent"

const SidebarGroup = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(({ className, ...props }, ref) => <div ref={ref} className={cn("relative flex w-full min-w-0 flex-col p-2", className)} {...props} />)
SidebarGroup.displayName = "SidebarGroup"

const SidebarGroupLabel = React.forwardRef<HTMLDivElement, React.ComponentProps<"div"> & { asChild?: boolean }>(
  ({ className, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "div"
    return <Comp ref={ref} className={cn("duration-200 flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-none ring-sidebar-ring transition-[margin,opa] ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0", "group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0", className)} {...props} />
  }
)
SidebarGroupLabel.displayName = "SidebarGroupLabel"

const SidebarGroupContent = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(({ className, ...props }, ref) => <div ref={ref} className={cn("w-full text-sm", className)} {...props} />)
SidebarGroupContent.displayName = "SidebarGroupContent"

const SidebarMenu = React.forwardRef<HTMLUListElement, React.ComponentProps<"ul">>(({ className, ...props }, ref) => <ul ref={ref} className={cn("flex w-full min-w-0 flex-col gap-1", className)} {...props} />)
SidebarMenu.displayName = "SidebarMenu"

const SidebarMenuItem = React.forwardRef<HTMLLIElement, React.ComponentProps<"li">>(({ className, ...props }, ref) => <li ref={ref} className={cn("group/menu-item relative", className)} {...props} />)
SidebarMenuItem.displayName = "SidebarMenuItem"

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-[[data-sidebar=menu-action]]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: { default: "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground", outline: "bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]" },
      size: { default: "h-8 text-sm", sm: "h-7 text-xs", lg: "h-12 text-sm group-data-[collapsible=icon]:!p-0" },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

const SidebarMenuButton = React.forwardRef<HTMLButtonElement, React.ComponentProps<"button"> & { asChild?: boolean; isActive?: boolean; tooltip?: string | React.ComponentProps<typeof TooltipContent> } & VariantProps<typeof sidebarMenuButtonVariants>>(
  ({ asChild = false, isActive = false, variant = "default", size = "default", tooltip, className, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const { isMobile, state } = useSidebar()
    const button = <Comp ref={ref} data-active={isActive} className={cn(sidebarMenuButtonVariants({ variant, size }), className)} {...props} />
    if (!tooltip) return button
    if (typeof tooltip === "string") tooltip = { children: tooltip }
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right" align="center" hidden={state !== "collapsed" || isMobile} {...tooltip} />
      </Tooltip>
    )
  }
)
SidebarMenuButton.displayName = "SidebarMenuButton"

const SidebarInput = React.forwardRef<React.ElementRef<typeof Input>, React.ComponentProps<typeof Input>>(
  ({ className, ...props }, ref) => <Input ref={ref} className={cn("h-8 w-full bg-background shadow-none focus-visible:ring-2 focus-visible:ring-sidebar-ring", className)} {...props} />
)
SidebarInput.displayName = "SidebarInput"

const SidebarSeparator = React.forwardRef<React.ElementRef<typeof Separator>, React.ComponentProps<typeof Separator>>(
  ({ className, ...props }, ref) => <Separator ref={ref} className={cn("mx-2 w-auto bg-sidebar-border", className)} {...props} />
)
SidebarSeparator.displayName = "SidebarSeparator"

export {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarInput, SidebarInset, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarSeparator,
  SidebarTrigger, useSidebar,
}
