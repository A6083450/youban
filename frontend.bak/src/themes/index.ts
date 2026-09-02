import { clearSkin } from './clear'
import { warmSkin } from './warm'
import type { AppSkin, SkinDefinition } from './types'

export type { AppSkin, SkinDefinition } from './types'
export { clearSkin, warmSkin }

const skinDefinitions: Readonly<Record<AppSkin, SkinDefinition>> = {
  default: warmSkin,
  google: clearSkin,
}

export const getSkinDefinition = (skin: AppSkin): SkinDefinition => skinDefinitions[skin]
