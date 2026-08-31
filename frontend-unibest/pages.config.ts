import { defineUniPages } from '@uni-helper/vite-plugin-uni-pages'
import { tabBar } from './src/tabbar/config'
import { pageDefinitionsForPlatform } from './src/router/page-definitions'

export default defineUniPages({
  pages: pageDefinitionsForPlatform(process.env.UNI_PLATFORM) as any,
  globalStyle: {
    navigationStyle: 'default',
    navigationBarTitleText: '游伴',
    navigationBarBackgroundColor: '#faf7f2',
    navigationBarTextStyle: 'black',
    backgroundColor: '#faf7f2',
  },
  easycom: {
    autoscan: true,
    custom: {
      '^fg-(.*)': '@/components/fg-$1/fg-$1.vue',
      '^(?!z-paging-refresh|z-paging-load-more)z-paging(.*)':
        'z-paging/components/z-paging$1/z-paging$1.vue',
      '^wd-(.*)': '@wot-ui/ui/components/wd-$1/wd-$1.vue',
},
  },
  // tabbar 的配置统一在 “./src/tabbar/config.ts” 文件中
  tabBar: tabBar as any,
})
