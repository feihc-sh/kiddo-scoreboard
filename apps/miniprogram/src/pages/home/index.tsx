import { View, Text, Button } from '@tarojs/components'
import Taro from '@tarojs/taro'
import './index.css'

export default function Home() {
  const handleStartQuestions = () => {
    Taro.navigateTo({
      url: '/pages/questions/index',
    })
  }

  return (
    <View className="home-container">
      <View className="home-header">
        <Text className="home-title">机甲挑战</Text>
        <Text className="home-welcome">欢迎回来，小挑战者！</Text>
      </View>

      <View className="home-content">
        {/* 今日任务卡片 */}
        <View className="task-card">
          <View className="task-card-header">
            <Text className="task-icon">📋</Text>
            <Text className="task-title">今日任务</Text>
          </View>
          <View className="task-card-body">
            <Text className="task-empty">暂无任务</Text>
            <Text className="task-hint">完成任务获取积分奖励</Text>
          </View>
        </View>

        {/* 开始答题按钮 */}
        <Button
          className="start-btn"
          type="primary"
          onClick={handleStartQuestions}
        >
          开始答题
        </Button>

        {/* 积分展示 */}
        <View className="score-display">
          <Text className="score-label">当前积分</Text>
          <Text className="score-value">--</Text>
        </View>
      </View>
    </View>
  )
}
