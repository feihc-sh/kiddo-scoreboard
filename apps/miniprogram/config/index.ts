import type { IConfig } from '@tarojs/taro'

const config: IConfig = {
  projectName: 'mecha-challenge-scoreboard',
  date: new Date().toISOString(),
  designWidth: 750,
  deviceRatio: {
    375: 2 / 1,
    375: 2 / 1,
    375: 2 / 1,
    375: 2 / 1,
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: [
    ['@tarojs/plugin-platform-weapp'],
  ],
  defineConstants: {},
  copy: {
    patterns: [],
    options: {},
  },
  framework: 'react',
  compiler: 'webpack5',
  cache: {
    enable: false,
  },
}

export default config
