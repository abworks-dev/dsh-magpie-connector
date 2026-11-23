import { acceptsImages, type CatalogModel } from './catalog.js'

type Modalities = NonNullable<CatalogModel['info']['inputModalities']>

/**
 * Effective input modalities of one catalog model under the saved preferences.
 * Read-time only: the catalog keeps the gateway's own declaration untouched, so a
 * preference toggle never rewrites (or is mistaken for) real gateway data.
 */
export const imageModalities = (model: CatalogModel, imageModels: readonly string[]): Modalities =>
  acceptsImages(model.declaredModalities ?? [], model.info.id, imageModels) ? ['text', 'image'] : ['text']
/** Catalog info with the saved image override applied; the gateway's own declaration always wins. */
export function withImageInput(model: CatalogModel, imageModels: readonly string[]): CatalogModel['info'] {
  return { ...model.info, inputModalities: imageModalities(model, imageModels) }
}
/** Whether the model accepts images under the saved preferences. */
export const acceptsImagesFor = (model: CatalogModel, imageModels: readonly string[]): boolean =>
  acceptsImages(model.declaredModalities ?? [], model.info.id, imageModels)

/**
 * Add or remove one model id in the saved override list. The model must exist in
 * the current catalog: a preference for a model the gateway no longer lists is
 * never invented, and removal keeps every other entry as it was.
 */
export function updateImageModel(saved: readonly string[], input: unknown, catalog: CatalogModel[]): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['model', 'image'].includes(k))) throw new Error('Invalid imageModel')
  const { model, image } = input as { model?: unknown; image?: unknown }
  if (typeof model !== 'string' || !model || typeof image !== 'boolean') throw new Error('Invalid image input')
  if (!catalog.find(m => m.info.id === model)) throw new Error('Invalid image input model')
  return image ? [...new Set([...saved, model])] : saved.filter(id => id !== model)
}
