export type AppSkin = 'default' | 'google'
export type SkinCssVariable = `--${string}`

export interface SkinAntTheme {
  token: {
    colorPrimary: string
    colorSuccess: string
    colorError: string
    colorText: string
    colorBgLayout: string
    borderRadius: number
  }
}

export interface SkinDefinition {
  value: AppSkin
  cssVariables: Readonly<Record<SkinCssVariable, string>>
  antTheme: SkinAntTheme
}
