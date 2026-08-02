import type { IConfig } from '@tarojs/taro'

const devConfig: IConfig = {
  env: {
    NODE_ENV: '"development"',
  },
  defineConstants: {
    BASE_URL: '"https://kiddo-scoreboard.pages.dev/api"',
  },
}

export default devConfig
