import { View, Text, Button } from '@tarojs/components'
import { useState } from 'react'
import Taro from '@tarojs/taro'
import './index.css'

export default function Login() {
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    setLoading(true)
    try {
      // Day 2 才接 CF Worker - 现在只是 UI 壳子
      Taro.showToast({
        title: 'Day 2 才接 CF Worker',
        icon: 'none',
        duration: 2000,
      })

      // Placeholder: wx.login 调用 (Day 2 范围)
      // const loginResult = await Taro.login()
      // console.log('wx.login result:', loginResult)
    } catch (error) {
      console.error('Login error:', error)
      Taro.showToast({
        title: '登录失败',
        icon: 'none',
        duration: 2000,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <View className="login-container">
      <View className="login-header">
        <Text className="login-title">机甲挑战计分板</Text>
        <Text className="login-subtitle">微信登录</Text>
      </View>

      <View className="login-content">
        <View className="logo-placeholder">
          <Text className="logo-text">机甲</Text>
        </View>

        <Button
          className="wechat-login-btn"
          type="primary"
          loading={loading}
          onClick={handleLogin}
          open-type="chooseAvatar"
        >
          微信登录
        </Button>

        <Text className="login-hint">点击上方按钮进行微信授权登录</Text>
      </View>
    </View>
  )
}
