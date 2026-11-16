// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { MagpieSettings } from '../src/client/SettingsPage.js'
import { providerSections, routingGroupModels } from '../src/client/view-model.js'
import { fakeApi, flush, ok, settingsView } from './client-support/fake-api.js'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { vi.restoreAllMocks() })

const FLASH = 'commandcode/deepseek/deepseek-v4.1-flash'
const FAST = 'group/fast-subagent'
const REVIEW = 'group/cross-review'
const CHEAP = 'group/cheap-first'

/**
 * Gateway catalog shaped like the reported one: the routing groups are filed
 * under the `commandcode` provider key, one more sits under `kimi`, and one
 * provider exists only because of a routing group.
 */
const GROUPS = [
  { provider: 'commandcode', models: [
    { id: FAST, name: 'fast-subagent', efforts: ['low', 'high'] },
    { id: REVIEW, name: 'cross-review', efforts: ['high'] },
    { id: FLASH, name: 'DeepSeek V4.1 Flash', efforts: ['low', 'high'] },
  ] },
  { provider: 'kimi', models: [
    { id: CHEAP },
    { id: 'kimi/k3', name: 'Kimi K3', efforts: ['low', 'high'] },
  ] },
  { provider: 'grouponly', models: [{ id: 'group/solo' }] },
]

async function mount(view: Record<string, unknown>) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  const fake = fakeApi({
    'GET settings': () => ok(settingsView(view)),
    'GET cards': () => ok({ status: 'ok', cards: [] }),
    'POST settings': () => ok(settingsView(view)),
  })
  await act(async () => root.render(h(MagpieSettings, { api: fake.api } as never)))
  await flush()
  return { host, root, fake }
}

const section = (host: HTMLElement) => host.querySelector('[data-routing-groups]')
const posted = (fake: { calls: Array<{ method: string; path: string; body?: unknown }> }) => fake.calls.find(call => call.method === 'POST' && call.path === 'settings')?.body

it('把 group/ 开头的模型收进独立的「路由组」小节，并从归属小节里移出', async () => {
  const { host, root } = await mount({ groups: GROUPS, visibleModels: { commandcode: [FLASH], kimi: ['kimi/k3'] } })
  try {
    const panel = section(host)!
    expect(panel).not.toBeNull()
    expect(panel.querySelector('h3')!.textContent).toBe('路由组')
    expect(panel.textContent).toContain(FAST)
    expect(panel.textContent).toContain(REVIEW)
    expect(panel.textContent).toContain(CHEAP)
    expect(panel.textContent).toContain('group/solo')
    // The vendor sections no longer list them …
    expect(host.querySelector('[data-provider="commandcode"] [data-model="group/fast-subagent"]')).toBeNull()
    expect(host.querySelector('[data-provider="kimi"] [data-model="group/cheap-first"]')).toBeNull()
    // … and a provider that only served a routing group gets no empty panel.
    expect(host.querySelector('[data-provider="grouponly"]')).toBeNull()
    expect(host.querySelector('[data-provider="commandcode"] [data-model="' + FLASH + '"]')).not.toBeNull()
  } finally { act(() => root.unmount()); host.remove() }
})

it('混合归属的路由组同栏显示，并各自标出原归属', async () => {
  const { host, root } = await mount({ groups: GROUPS })
  try {
    const panel = section(host)!
    const owners = Array.from(panel.querySelectorAll('[data-routing-provider]')).map(node => node.getAttribute('data-routing-provider'))
    expect(owners).toEqual(['commandcode', 'commandcode', 'kimi', 'grouponly'])
    expect(panel.querySelector('[data-routing-provider="commandcode"] [data-model="' + REVIEW + '"]')).not.toBeNull()
  } finally { act(() => root.unmount()); host.remove() }
})

it('勾选一个路由组写入原归属的白名单，并保留同归属的其他已存选择', async () => {
  const { host, root, fake } = await mount({ groups: GROUPS, visibleModels: { commandcode: [FLASH], kimi: ['kimi/k3'] } })
  try {
    const box = section(host)!.querySelector('[data-model="' + REVIEW + '"] input') as HTMLInputElement
    expect(box.checked).toBe(false)
    await act(async () => { box.click() })
    await flush()
    expect(posted(fake)).toEqual({ visibleModels: { commandcode: [FLASH, REVIEW], kimi: ['kimi/k3'] } })
  } finally { act(() => root.unmount()); host.remove() }
})

it('取消勾选只移除该路由组，目录里已不存在的已存 ID 不会被丢掉', async () => {
  const gone = 'commandcode/gone-from-catalog'
  const { host, root, fake } = await mount({
    groups: GROUPS,
    visibleModels: { commandcode: [gone, FAST], kimi: ['kimi/k3'] },
  })
  try {
    const box = section(host)!.querySelector('[data-model="' + FAST + '"] input') as HTMLInputElement
    expect(box.checked).toBe(true)
    await act(async () => { box.click() })
    await flush()
    expect(posted(fake)).toEqual({ visibleModels: { commandcode: [gone], kimi: ['kimi/k3'] } })
  } finally { act(() => root.unmount()); host.remove() }
})

it('已存白名单存在但没选中路由组时，路由组初始显示为未勾选', async () => {
  const { host, root } = await mount({ groups: GROUPS, visibleModels: { commandcode: [FLASH], kimi: ['kimi/k3'] } })
  try {
    const panel = section(host)!
    expect((panel.querySelector('[data-model="' + FAST + '"] input') as HTMLInputElement).checked).toBe(false)
    expect((panel.querySelector('[data-model="' + REVIEW + '"] input') as HTMLInputElement).checked).toBe(false)
    expect((panel.querySelector('[data-model="' + CHEAP + '"] input') as HTMLInputElement).checked).toBe(false)
    // …while the provider's ordinary model keeps its own tick.
    expect((host.querySelector('[data-provider="commandcode"] [data-model="' + FLASH + '"] input') as HTMLInputElement).checked).toBe(true)
  } finally { act(() => root.unmount()); host.remove() }
})

it('路由组的默认 effort 单独保存，未设置的保持为空且不动可见性', async () => {
  const { host, root, fake } = await mount({
    groups: GROUPS,
    visibleModels: { commandcode: [FLASH, FAST] },
    defaultEfforts: { [FAST]: 'high' },
  })
  try {
    const panel = section(host)!
    const fast = panel.querySelector('[data-model="' + FAST + '"] select') as HTMLSelectElement
    const review = panel.querySelector('[data-model="' + REVIEW + '"] select') as HTMLSelectElement
    expect(fast.value).toBe('high')
    expect(review.value).toBe('')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(fast, 'low')
      fast.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()
    expect(posted(fake)).toEqual({ defaultEffort: { model: FAST, effort: 'low' } })
  } finally { act(() => root.unmount()); host.remove() }
})

it('有小节内路由组的归属会提示：这里的「跟随」也会恢复路由组的可见性', async () => {
  const { host, root } = await mount({ groups: GROUPS, visibleModels: { commandcode: [FLASH], kimi: ['kimi/k3'] } })
  try {
    for (const provider of ['commandcode', 'kimi']) {
      const panel = host.querySelector('[data-provider="' + provider + '"]')!
      expect(panel.textContent).toContain('这里的「跟随网关模型列表」也会一并恢复该归属下路由组的可见性。')
    }
    // A provider with no routing groups never shows the notice.
    const { host: plain, root: plainRoot } = await mount({})
    try { expect(plain.querySelector('[data-provider="claude"]')!.textContent).not.toContain('路由组') }
    finally { act(() => plainRoot.unmount()); plain.remove() }
    // Following the catalog means there is no per-provider follow action to explain.
    const { host: following, root: followingRoot } = await mount({ groups: GROUPS })
    try { expect(following.querySelector('[data-provider="commandcode"]')!.textContent).not.toContain('跟随网关模型列表」也会') }
    finally { act(() => followingRoot.unmount()); following.remove() }
  } finally { act(() => root.unmount()); host.remove() }
})

it('provider 跟随目录时取消勾选路由组，只播下该归属完整列表并移除这一个 ID', async () => {
  const { host, root, fake } = await mount({ groups: GROUPS })
  try {
    const panel = section(host)!
    const box = panel.querySelector('[data-model="' + FAST + '"] input') as HTMLInputElement
    expect(box.checked).toBe(true)
    await act(async () => { box.click() })
    await flush()
    // No saved whitelist existed, so the full provider list is seeded first — ordinary
    // model and the other routing group survive — then this one is removed.
    expect(posted(fake)).toEqual({ visibleModels: { commandcode: [REVIEW, FLASH] } })
  } finally { act(() => root.unmount()); host.remove() }
})

it('厂商小节里切换普通模型，不会丢掉被移出该小节的同归属路由组', async () => {
  const { host, root, fake } = await mount({ groups: GROUPS, visibleModels: { commandcode: [FAST] } })
  try {
    expect((section(host)!.querySelector('[data-model="' + FAST + '"] input') as HTMLInputElement).checked).toBe(true)
    const ordinary = host.querySelector('[data-provider="commandcode"] [data-model="' + FLASH + '"] input') as HTMLInputElement
    expect(ordinary.checked).toBe(false)
    await act(async () => { ordinary.click() })
    await flush()
    expect(posted(fake)).toEqual({ visibleModels: { commandcode: [FAST, FLASH] } })
  } finally { act(() => root.unmount()); host.remove() }
})

it('没有路由组时不渲染该小节', async () => {
  const { host, root } = await mount({})
  try {
    expect(section(host)).toBeNull()
  } finally { act(() => root.unmount()); host.remove() }
})

it('路由组助手：跨归属收集、去重并保持目录顺序，空的归属小节被略过', () => {
  const rows = routingGroupModels(GROUPS as never)
  expect(rows.map(row => row.id)).toEqual([FAST, REVIEW, CHEAP, 'group/solo'])
  expect(rows.map(row => row.provider)).toEqual(['commandcode', 'commandcode', 'kimi', 'grouponly'])
  expect(routingGroupModels(undefined)).toEqual([])

  expect(providerSections(GROUPS as never, [])).toEqual(['commandcode', 'kimi'])
  // A card keeps its provider section even when its models are routing groups only.
  expect(providerSections(GROUPS as never, [{ provider: 'grouponly' }] as never)).toContain('grouponly')
})
