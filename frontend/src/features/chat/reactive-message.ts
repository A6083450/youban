import { reactive } from 'vue'

export function createReactiveMessage<T extends object>(message: T): T {
  return reactive(message) as T
}
