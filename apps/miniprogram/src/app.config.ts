export default defineAppConfig({
  pages: [
    'pages/login/index',
    'pages/home/index',
    'pages/questions/index',
  ],
  window: {
    navigationBarTitleText: '机甲挑战计分板',
    navigationBarBackgroundColor: '#FFF8E7',
    navigationBarTextStyle: 'black',
    backgroundColor: '#FFF8E7',
  },
  permission: {
    'scope.userLocation': {
      desc: '你的位置信息将用于提供更好的服务',
    },
  },
  lazyCodeLoading: 'requiredComponents',
})
