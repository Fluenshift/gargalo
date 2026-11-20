// Keyboard handling shared by the panels that listen on the window.

/** Whether an element takes typed text (a text field, a list box, an editable region). */
export const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

/**
 * Whether an Escape that reached the window is for the layer rooted at `root`: nothing above it
 * (a menu, a dialog) took it first, and the player is not typing in a field outside it. The
 * layer that handles Escape calls `preventDefault`, so the layers below leave it alone.
 */
export function escapeFor(e: KeyboardEvent, root: Element | null): boolean {
  if (e.key !== 'Escape' || e.defaultPrevented) return false
  return !isTyping(e.target) || (!!root && e.target instanceof Node && root.contains(e.target))
}

/** Whether a modal dialog is open: shortcuts for the page behind it must wait. */
export const dialogOpen = () => document.querySelector('dialog[open]') !== null
