/** Open `url` inside a wallet's in-app browser. `ref` is the origin of the page. */
export function walletBrowseLinks(url: string): Array<{ name: 'Phantom' | 'Solflare' | 'Backpack', href: string }> {
  const u = encodeURIComponent(url)
  const ref = encodeURIComponent(new URL(url).origin)
  return [
    { name: 'Phantom', href: `https://phantom.com/ul/browse/${u}?ref=${ref}` },
    { name: 'Solflare', href: `https://solflare.com/ul/v1/browse/${u}?ref=${ref}` },
    { name: 'Backpack', href: `https://backpack.app/ul/v1/browse/${u}?ref=${ref}` },
  ]
}
