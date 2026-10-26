// Recorded shape event sequences for the three scenes. Used by `/live?demo=fixture` (labelled REPLAY),
// by the landing page visuals, and by lib/reduce.test.ts. Addresses, PeerIds and CIDs are well formed
// (each PeerId embeds the same Ed25519 key as its address) but were generated for these fixtures.
// Signatures are fabricated, so the dashboard never links them to the explorer.
import type { SwarmEvent, SwarmEventBody } from '@swarm/events'

export const KEYS = {
  agent: { addr: 'Gj86m3n4Y4oAnqguX3Z8huW7ck2AGLvL1M4e4uqaGgLb', peer: '12D3KooWRYVGWBMmiy4fCjCL9eJUUhax754oJ2zoxwRfStzUAd4X' },
  seller: { addr: 'VJwvizzr2M6bQtQ18FzJG1QtoV3Hu8GJQoYiEQszKY1', peer: '12D3KooWAJg7frai2vcb1JPpdj1L546FP8XgKbCkG1Aa6DZmtGFw' },
  provider: { addr: 'AKZogHQXUhNK89T636voMC1ETkBLksdTPZh7D9P4gzmn', peer: '12D3KooWK8vyRQzEfbdoY2xWfhg97z64x5DynZhwMA48b8XxawVi' },
  tamperer: { addr: 'HrSicmz3HAnmVN6E8zzPHcKiUzAtSyZQo6w9dtBrWqKa', peer: '12D3KooWSfotMuZkU54FuFbembjj4QQYyKDXUfdtkhJB1sLkQn3W' },
  kubo: { addr: 'EgyD9mpwMUDqf87m31kEQuQPSv1yHoQfcn4phUjbUqYA', peer: '12D3KooWPWLNtuQeYNVL51dBfcVaBhVDwF4cKVV9aNRr5TtVNnG6' },
}

export const ROOTS = [
  'bafybeifriylnjdw5ecpeuo5gx33sopxnbbnn7w7gc3zh3u7ph2s7e6t24u',
  'bafybeigf22tfe73qw3nv7qxubn7hnfst2os4mex74t3ff67rqe5giezxzm',
  'bafybeiet5nqtlf7c5daijqf2z4rb7emlwfgjaru5htb6tdmam6oov6dcve',
]
export const RECEIPT_CID = 'baguqeeraemuunbfdv3h3l5rov6dyqbbv74lxdxvbpbfkx5mbs6pmbwdljega'
export const SIGS = [
  '437jUVHHS1TTADHo3wBjA3avByxfe1r72m9QGEqziV5ZZS5uyfXYHZN69ieTvB15JGqExzVHa6e7c7WqxRiqn6zM',
  '38tayzJDDVFNunHfK5tHHVbf7HeeVZwL1AMfiNaiXQJX1WSMF9oSTUsxYfPbiE6t3WAadgzB8FaDe5PjxaHet7Up',
]
const BLOCKS = [
  'bafkreidqlbop2ibri4hz5ndq5whvdstgo6nulkvaqur3zihzhyooaa7zjq', 'bafkreigjrwotfxczl32au2oskjptluxbp6d353rhl3ydkt7xygzbq66say',
  'bafkreibbgey2m6clqlu6fbopbocrcp7ugghtidameoaod4np5lxbbfwbda', 'bafkreid2oznwuqo5nq3fixia5sjqqce3grerdqrfwvwkdl5bbno4wq36bi',
  'bafkreibhg7qeb4lmc337w76muh2ra74prkwellli627brp3qjjt3c5qhzu', 'bafkreifkys4gilkurp4r6spisi2l7o3cxjtpd34q4emwu4osi4gfxos3dq',
  'bafkreiesllmainw2td2ubirbxnxtkqlfumyt7mlobgjacrowd4fhzxnrze', 'bafkreighy4efn7gwqdckhevhlcqpreo7c7mlqzwcmcahejcqdbcblvdfrq',
  'bafkreicpvqxll6gppzgkl2o7ohizyokudc6nbjuj53pldcmmrqnz3pqgkq', 'bafkreid6xp5bpfuqfqu25gjm2k4l62rhv4ldcrbjjavcog6ahqt7kipggu',
  'bafkreieq5r3wykv3v7z5xgulneezqa2mabugu4m5x4hfjxsskpl5budpoa', 'bafkreigkuro2wb4ipxjsuj6bnjcteyzsbs7vms4vawz2vkvwh53x4olgua',
  'bafkreigyu4khp2a2dfskxep2c4w22d4hn3txlw7y5lgibb7wanxbed2ttq', 'bafkreigkf6mjf3f22o5uwbb5k2wevuujy42f3bux324rfkc6yxglvnikte',
  'bafkreifoznbxwkn56mqbyd4kx3v4y5f4gmwjfinvlkk57iiwqssw3uc3hu', 'bafkreiaz6tcyyp7fyvljkyaohrmfze7z43xnvuso4k4dy4sx6pjonmo6gm',
  'bafkreiasbs7cf3t4yanxdqwv2sh7xgsd7l3zekaylqpzifvis2onncwxsm', 'bafkreibbrk457x5gamp5igxrkds7o5mxfcyissedq4a2eloljur7k3sd4a',
  'bafkreiharqvtgczp4o4e6uagq66utmuzlqo666wryyi3xeulxlr4xmpfoe', 'bafkreihniwlhabximiodpdoaxshtbif2256e6e5uo3gvmxqrl3dwd3b7cy',
  'bafkreicqcnnwiaiayruao54quxauitxzakz4dh56kzsj5fjzrcj3zdkvtu', 'bafkreifgjbdhwvbgcvhlqxnhz4rnvagzcs56vy55fdfghro4mj4ey4crpe',
  'bafkreif5fl5vcrvzrvmvoyqsa6f3v5224rs22ng5t5cw6iy5bbr64hxh2q', 'bafkreiabheyxglzt2gwse7byd4hsbazbec3odmk4p5dgqh7iv2rjzgnc3a',
  'bafkreihhy5wzqilnjpatyobx6owhhwhuhuvf3fvyt6ectx4ucl6c3hgfhi', 'bafkreihtszy6dcoe45vxjtkwaxhf2z5thexxqcljhoy6p4lvbc7qabpwkm',
  'bafkreibn3mw6blgk36oodbmzu7j2fvqkoyubq4eanjidcvu7qk2quxwoai', 'bafkreiddweoilza6ajrikujgwrvemdwdon65z7aqejsodjoophiwuucufq',
  'bafkreicrnsh3jznjj3gwftw3vka4tcuvi5zqq4l7klnirqcz4azlfkgyzy', 'bafkreiggg6cp6wuhvqjjat5a6n27m6djp3b6kz6jtsvr6fdg45kr2sme7y',
  'bafkreigo7nxr4ai4p4rsfwhcevxxfizhpv6ueh35j5pthvvd4buzujfwta',
]

export const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
export const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'
const FETCH = '/ipfs-x402/fetch/1.0.0'
const PIN = '/ipfs-x402/pin/1.0.0'

/** A body plus the delay (ms) since the previous event, so a player can pace it like the recording. */
export type Step = { dt: number, e: SwarmEventBody }

function blocks(requestId: string, root: string, total: number, dt: number, badAt = -1): Step[] {
  const out: Step[] = []
  for (let i = 0; i < total; i++) {
    out.push({ dt: i === 0 ? 180 : dt + ((i * 37) % 41), e: { kind: 'block', requestId, cid: i === 0 ? root : BLOCKS[i % BLOCKS.length], index: i, total, ok: i !== badAt } })
    if (i === badAt) break
  }
  return out
}

export const PEERS: Step[] = [
  { dt: 0, e: { kind: 'peer', id: KEYS.agent.peer, role: 'agent', label: 'Agent', addrs: ['/ip4/127.0.0.1/tcp/40121'], payee: KEYS.agent.addr } },
  { dt: 60, e: { kind: 'peer', id: KEYS.provider.peer, role: 'provider', label: 'Provider', addrs: ['/ip4/127.0.0.1/tcp/40122'], payee: KEYS.provider.addr } },
]

export const SCENE1: Step[] = [
  { dt: 0, e: { kind: 'scene', n: 1, state: 'start', title: 'An agent buys a dataset from a peer' } },
  { dt: 240, e: { kind: 'peer', id: KEYS.seller.peer, role: 'seller', label: 'Data seller', addrs: ['/ip4/127.0.0.1/tcp/40124'], payee: KEYS.seller.addr } },
  { dt: 380, e: { kind: 'connection', from: KEYS.agent.peer, to: KEYS.seller.peer, transport: 'tcp', state: 'open' } },
  { dt: 520, e: { kind: 'quote', from: KEYS.seller.peer, to: KEYS.agent.peer, protocol: FETCH, amount: '1000', asset: USDC_MINT, invoice: false } },
  { dt: 310, e: { kind: 'quote', from: KEYS.seller.peer, to: KEYS.agent.peer, protocol: FETCH, amount: '2417', asset: USDC_MINT, memo: `ipfs:${ROOTS[0]}`, invoice: true } },
  { dt: 420, e: { kind: 'payee-check', from: KEYS.agent.peer, to: KEYS.seller.peer, payTo: KEYS.seller.addr, remoteKey: KEYS.seller.addr, ok: true } },
  { dt: 640, e: { kind: 'payment', id: 'pay_s1_7f3c', from: KEYS.agent.peer, to: KEYS.seller.peer, protocol: FETCH, amount: '2417', asset: USDC_MINT, network: DEVNET, memo: `ipfs:${ROOTS[0]}` } },
  { dt: 210, e: { kind: 'tx', paymentId: 'pay_s1_7f3c', signature: SIGS[0], status: 'submitted', ms: 0 } },
  { dt: 412, e: { kind: 'tx', paymentId: 'pay_s1_7f3c', signature: SIGS[0], status: 'processed', ms: 412 } },
  { dt: 449, e: { kind: 'tx', paymentId: 'pay_s1_7f3c', signature: SIGS[0], status: 'confirmed', ms: 861 } },
  ...blocks('req_s1_fetch', ROOTS[0], 24, 140),
  { dt: 7100, e: { kind: 'tx', paymentId: 'pay_s1_7f3c', signature: SIGS[0], status: 'finalized', ms: 12947 } },
  { dt: 300, e: { kind: 'scene', n: 1, state: 'done', title: 'An agent buys a dataset from a peer' } },
]

export const SCENE2: Step[] = [
  { dt: 0, e: { kind: 'scene', n: 2, state: 'start', title: 'Tamper' } },
  { dt: 240, e: { kind: 'peer', id: KEYS.tamperer.peer, role: 'agent', label: 'Tampering agent', addrs: ['/ip4/127.0.0.1/tcp/40124'], payee: KEYS.tamperer.addr } },
  { dt: 320, e: { kind: 'connection', from: KEYS.tamperer.peer, to: KEYS.provider.peer, transport: 'tcp', state: 'open' } },
  { dt: 410, e: { kind: 'quote', from: KEYS.provider.peer, to: KEYS.tamperer.peer, protocol: PIN, amount: '1500', asset: USDC_MINT, invoice: false } },
  { dt: 380, e: { kind: 'quote', from: KEYS.provider.peer, to: KEYS.tamperer.peer, protocol: PIN, amount: '3862', asset: USDC_MINT, memo: `ipfs:${ROOTS[1]}`, invoice: true } },
  { dt: 360, e: { kind: 'payee-check', from: KEYS.tamperer.peer, to: KEYS.provider.peer, payTo: KEYS.provider.addr, remoteKey: KEYS.provider.addr, ok: true } },
  ...blocks('req_s2_pin', ROOTS[1], 31, 150, 13),
  { dt: 260, e: { kind: 'error', code: 'resource_invalid', message: 'Block 13 does not hash to its CID', scene: 2, settled: false } },
  { dt: 400, e: { kind: 'scene', n: 2, state: 'done', title: 'Tamper' } },
]

export const SCENE3: Step[] = [
  { dt: 0, e: { kind: 'scene', n: 3, state: 'start', title: 'Pay to keep it' } },
  { dt: 260, e: { kind: 'connection', from: KEYS.agent.peer, to: KEYS.provider.peer, transport: 'tcp', state: 'open' } },
  { dt: 390, e: { kind: 'quote', from: KEYS.provider.peer, to: KEYS.agent.peer, protocol: PIN, amount: '1500', asset: USDC_MINT, invoice: false } },
  { dt: 370, e: { kind: 'quote', from: KEYS.provider.peer, to: KEYS.agent.peer, protocol: PIN, amount: '2791', asset: USDC_MINT, memo: `ipfs:${ROOTS[2]}`, invoice: true } },
  { dt: 350, e: { kind: 'payee-check', from: KEYS.agent.peer, to: KEYS.provider.peer, payTo: KEYS.provider.addr, remoteKey: KEYS.provider.addr, ok: true } },
  ...blocks('req_s3_pin', ROOTS[2], 18, 150),
  // Pin settles only after every block verified, so the payment starts here.
  { dt: 240, e: { kind: 'payment', id: 'pay_s3_b21e', from: KEYS.agent.peer, to: KEYS.provider.peer, protocol: PIN, amount: '2791', asset: USDC_MINT, network: DEVNET, memo: `ipfs:${ROOTS[2]}` } },
  { dt: 190, e: { kind: 'tx', paymentId: 'pay_s3_b21e', signature: SIGS[1], status: 'submitted', ms: 0 } },
  { dt: 438, e: { kind: 'tx', paymentId: 'pay_s3_b21e', signature: SIGS[1], status: 'processed', ms: 438 } },
  { dt: 469, e: { kind: 'tx', paymentId: 'pay_s3_b21e', signature: SIGS[1], status: 'confirmed', ms: 907 } },
  { dt: 320, e: { kind: 'pinned', root: ROOTS[2], provider: KEYS.provider.peer, receiptCid: RECEIPT_CID, expiresAt: '2026-11-25T09:14:03Z', receipt: { cid: ROOTS[2], payer: KEYS.agent.addr, payee: KEYS.provider.addr, network: DEVNET, tx: SIGS[1], bytes: 1183744, expiresAt: '2026-11-25T09:14:03Z' } } },
  { dt: 900, e: { kind: 'peer', id: KEYS.kubo.peer, role: 'kubo', label: 'Kubo 0.43', addrs: ['/ip4/127.0.0.1/tcp/4001'] } },
  { dt: 260, e: { kind: 'connection', from: KEYS.kubo.peer, to: KEYS.provider.peer, transport: 'tcp', state: 'open' } },
  { dt: 1630, e: { kind: 'provided', root: ROOTS[2], via: 'kubo-bitswap', by: KEYS.kubo.peer, blocks: 18, ms: 1614 } },
  { dt: 8200, e: { kind: 'tx', paymentId: 'pay_s3_b21e', signature: SIGS[1], status: 'finalized', ms: 13116 } },
  { dt: 300, e: { kind: 'scene', n: 3, state: 'done', title: 'Pay to keep it' } },
]

export const HELLO: SwarmEventBody = { kind: 'hello', mode: 'replay', network: DEVNET, explorer: 'https://explorer.solana.com' }

/** The full replay: hello, the standing peers, then scenes 1 to 3 with a pause between them. */
export const REPLAY: Step[] = [
  { dt: 0, e: HELLO },
  ...PEERS,
  { dt: 2700, e: SCENE1[0].e },
  ...SCENE1.slice(1),
  { dt: 3500, e: SCENE2[0].e },
  ...SCENE2.slice(1),
  { dt: 4000, e: SCENE3[0].e },
  ...SCENE3.slice(1),
]

/** Stamp steps with seq and at, as the swarm would. */
export function stamp(steps: Step[], t0 = 1793000000000): SwarmEvent[] {
  let at = t0
  return steps.map((s, i) => {
    at += s.dt
    return { ...s.e, seq: i + 1, at } as SwarmEvent
  })
}
