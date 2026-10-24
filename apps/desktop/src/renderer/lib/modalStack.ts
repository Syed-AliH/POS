/**
 * Every open <Modal> registers here, newest last. The keyboard shortcut bridge reads
 * it so that while a dialog is open, Escape closes that dialog — and only that one —
 * and page shortcuts (F-keys, Alt+number, the page's own Escape) don't fire behind it.
 * Without this, Esc in checkout's product search opened "Clear cart?" instead of
 * closing the search, and F4 could charge the sale from inside a dialog.
 *
 * A page kept alive in the background (see KeepAliveOutlet) tears down its effects,
 * so its open dialogs drop out of the stack until the page is shown again.
 */
type Entry = { close: () => void };

const stack: Entry[] = [];

export function pushModal(entry: Entry): () => void {
  stack.push(entry);
  return () => {
    const idx = stack.lastIndexOf(entry);
    if (idx !== -1) stack.splice(idx, 1);
  };
}

export function hasOpenModal(): boolean {
  return stack.length > 0;
}

/** Close the most recently opened dialog. Returns false when none is open. */
export function closeTopModal(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}
