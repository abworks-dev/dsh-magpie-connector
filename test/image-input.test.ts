import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { mapCatalog } from '../src/host/catalog.js'
import { acceptsImagesFor, updateImageModel, withImageInput } from '../src/host/image-input.js'
import { SettingsController } from '../src/host/routes.js'
import { MagpieRuntime } from '../src/host/runtime.js'
import { MAX_IMAGE_MODELS, SettingsStore, validateImageModels } from '../src/host/settings.js'

const catalog = () => mapCatalog({ data: [{ id: 'opendesign/deepseek-v4.1-flash' }, { id: 'deepseek/deepseek-v4-pro', modalities: { input: ['text'] } }] })

it('adds and removes one model without touching the others', () => {
  const models = catalog()
  let saved = updateImageModel([], { model: 'opendesign/deepseek-v4.1-flash', image: true }, models)
  expect(saved).toEqual(['opendesign/deepseek-v4.1-flash'])
  expect(updateImageModel(saved, { model: 'opendesign/deepseek-v4.1-flash', image: true }, models)).toEqual(saved)
  expect(withImageInput(models[0]!, saved).inputModalities).toEqual(['text', 'image'])
  expect(acceptsImagesFor(models[0]!, saved)).toBe(true)
  saved = updateImageModel(saved, { model: 'opendesign/deepseek-v4.1-flash', image: false }, models)
  expect(saved).toEqual([])
  expect(withImageInput(models[0]!, saved).inputModalities).toEqual(['text'])
})

it('never overrides a gateway declaration', () => {
  const models = catalog()
  expect(acceptsImagesFor(models[1]!, ['deepseek/deepseek-v4-pro'])).toBe(false)
  expect(withImageInput(models[1]!, ['deepseek/deepseek-v4-pro']).inputModalities).toEqual(['text'])
})

it('rejects malformed input and models the catalog does not list', () => {
  const models = catalog()
  for (const input of [null, [], { model: 'opendesign/deepseek-v4.1-flash' }, { model: 'opendesign/deepseek-v4.1-flash', image: 'yes' }, { model: 'opendesign/deepseek-v4.1-flash', image: true, extra: 1 }, { model: 'gone', image: true }, { model: '', image: true }])
    expect(() => updateImageModel(['keep'], input, models)).toThrow()
  expect(updateImageModel(['keep'], { model: 'opendesign/deepseek-v4.1-flash', image: false }, models)).toEqual(['keep'])
})

it('loads a missing list as empty and rejects a malformed one', () => {
  expect(validateImageModels(undefined)).toEqual([])
  expect(validateImageModels(['a', 'b'])).toEqual(['a', 'b'])
  for (const bad of ['a', [''], ['a', 'a'], [1], Array.from({ length: MAX_IMAGE_MODELS + 1 }, (_, i) => `m${i}`)]) expect(() => validateImageModels(bad)).toThrow()
})

const credentials = () => ({ describe: async () => ({ configured: false, writable: true }), resolve: async () => undefined, set: vi.fn(), unset: vi.fn() }) as never

it('settings stores the override and reports it per model', async () => {
  const models = catalog()
  const store = new SettingsStore()
  const runtime = new MagpieRuntime(credentials(), store)
  runtime.current.catalog = models
  const settings = new SettingsController(runtime)
  const view = await (await settings.handle({ imageModel: { model: 'opendesign/deepseek-v4.1-flash', image: true } })).json() as { imageModels: string[]; groups: { models: { id: string; image: boolean }[] }[] }
  expect(store.value.imageModels).toEqual(['opendesign/deepseek-v4.1-flash'])
  expect(view.imageModels).toEqual(['opendesign/deepseek-v4.1-flash'])
  expect(view.groups.flatMap(group => group.models).map(model => [model.id, model.image])).toEqual([['opendesign/deepseek-v4.1-flash', true], ['deepseek/deepseek-v4-pro', false]])
  expect((await settings.handle({ imageModel: { model: 'opendesign/deepseek-v4.1-flash', image: false } })).status).toBe(200)
  expect(store.value.imageModels).toEqual([])
  expect((await settings.handle({ imageModel: { model: 'gone', image: true } })).status).toBe(400)
  await runtime.dispose()
})

it('the saved override survives a restart of the settings file', async () => {
  const models = catalog()
  const path = join(mkdtempSync(join(tmpdir(), 'magpie-image-')), 'settings.json')
  const first = new MagpieRuntime(credentials(), new SettingsStore(path))
  first.current.catalog = models
  expect((await new SettingsController(first).handle({ imageModel: { model: 'opendesign/deepseek-v4.1-flash', image: true } })).status).toBe(200)
  await first.dispose()
  const restarted = new MagpieRuntime(credentials(), new SettingsStore(path))
  expect(restarted.imageModels).toEqual(['opendesign/deepseek-v4.1-flash'])
  expect(withImageInput(models[0]!, restarted.imageModels).inputModalities).toEqual(['text', 'image'])
  await restarted.dispose()
})
