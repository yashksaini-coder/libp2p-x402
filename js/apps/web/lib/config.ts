/** Public GitHub repo, e.g. https://github.com/<org>/libp2p-x402. Empty until the repo is public: links to it are not rendered. */
export const REPO_URL = (process.env.NEXT_PUBLIC_REPO_URL ?? '').replace(/\/$/, '')
export const SPEC_URL = REPO_URL ? `${REPO_URL}/blob/main/spec/libp2p.md` : ''

/** Public origin of the deployed site, for absolute og:image URLs. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

export const SWARM_URL = (process.env.NEXT_PUBLIC_SWARM_URL ?? 'http://127.0.0.1:4402').replace(/\/$/, '')
/** Empty in the public build: scene controls then render nothing. */
export const SWARM_TOKEN = process.env.NEXT_PUBLIC_SWARM_TOKEN ?? ''

/** Public origin of the /try page, for wallet deeplinks. */
export const TRY_URL = (process.env.NEXT_PUBLIC_TRY_URL ?? 'http://localhost:3000/try').replace(/\/$/, '')

/** Hostnames of the booth laptop: presenter controls render there, and a wallet there is the booth's, not a visitor's. */
export const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`
