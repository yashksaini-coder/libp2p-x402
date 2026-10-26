/** Public GitHub repo, e.g. https://github.com/<org>/libp2p-x402. Empty until the repo is public: links to it are not rendered. */
export const REPO_URL = (process.env.NEXT_PUBLIC_REPO_URL ?? '').replace(/\/$/, '')
export const SPEC_URL = REPO_URL ? `${REPO_URL}/blob/main/spec/libp2p.md` : ''

/** Public origin of the deployed site, for absolute og:image URLs. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export const SWARM_URL = (process.env.NEXT_PUBLIC_SWARM_URL ?? 'http://127.0.0.1:4402').replace(/\/$/, '')
export const SWARM_TOKEN = process.env.NEXT_PUBLIC_SWARM_TOKEN ?? ''

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`
