/**
 * Copy text to the clipboard, working in non-secure contexts too.
 *
 * `navigator.clipboard` only exists in secure contexts (HTTPS or localhost).
 * PeerDesk is often served over plain HTTP on a LAN IP, where that API is
 * undefined, so fall back to the legacy execCommand('copy') on a hidden
 * textarea. Returns whether the copy succeeded.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
