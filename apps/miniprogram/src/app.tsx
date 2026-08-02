import { useEffect } from 'react'
import { useLaunch, useRouter } from '@tarojs/taro'
import './app.css'

export default function App() {
  useLaunch(() => {
    console.log('App launched.')
  })

  useRouter((router) => {
    console.log('Router:', router)
  })

  return null
}
