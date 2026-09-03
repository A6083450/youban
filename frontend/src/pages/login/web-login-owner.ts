let latestOwner = 0

export const claimWebLoginOwner = () => ++latestOwner

export const isWebLoginOwner = (owner: number) => owner === latestOwner

export function releaseWebLoginOwner(owner: number): void {
  if (isWebLoginOwner(owner))
    latestOwner += 1
}
