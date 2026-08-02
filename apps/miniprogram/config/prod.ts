import type { IConfig } from '@tarojs/taro'

const prodConfig: IConfig = {
  env: {
    NODE_ENV: '"production"',
  },
  defineConstants: {
    BASE_URL: '"https://kiddo-scoreboard.pages.dev/api"',
  },
}

export default prodConfig
