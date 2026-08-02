import { View, Text, Button } from '@tarojs/components'
import { useState } from 'react'
import Taro from '@tarojs/taro'
import './index.css'

// Day 3 才接 API - 现在只是 UI 壳子
const PLACEHOLDER_OPTIONS = [
  { id: 'A', text: '选项 A' },
  { id: 'B', text: '选项 B' },
  { id: 'C', text: '选项 C' },
  { id: 'D', text: '选项 D' },
]

export default function Questions() {
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [answered, setAnswered] = useState(false)

  const handleSelectOption = (optionId: string) => {
    if (answered) return
    setSelectedOption(optionId)
  }

  const handleSubmit = () => {
    if (!selectedOption) {
      Taro.showToast({
        title: '请选择一个答案',
        icon: 'none',
      })
      return
    }

    setAnswered(true)
    Taro.showToast({
      title: 'Day 3 才接 API',
      icon: 'none',
      duration: 2000,
    })
  }

  const handleNextQuestion = () => {
    setSelectedOption(null)
    setAnswered(false)
  }

  return (
    <View className="questions-container">
      <View className="questions-header">
        <Text className="question-number">题目 1</Text>
        <Text className="question-hint">Day 3 才接 API</Text>
      </View>

      <View className="question-content">
        <View className="question-text-wrapper">
          <Text className="question-text">
            这是一个占位问题文本，Day 3 才接入真实题目 API
          </Text>
        </View>

        <View className="options-container">
          {PLACEHOLDER_OPTIONS.map((option) => (
            <Button
              key={option.id}
              className={`option-btn ${selectedOption === option.id ? 'selected' : ''} ${answered ? 'answered' : ''}`}
              onClick={() => handleSelectOption(option.id)}
              disabled={answered}
            >
              <Text className="option-id">{option.id}</Text>
              <Text className="option-text">{option.text}</Text>
            </Button>
          ))}
        </View>

        {answered ? (
          <Button
            className="next-btn"
            type="primary"
            onClick={handleNextQuestion}
          >
            下一题
          </Button>
        ) : (
          <Button
            className="submit-btn"
            type="primary"
            onClick={handleSubmit}
            disabled={!selectedOption}
          >
            提交答案
          </Button>
        )}
      </View>
    </View>
  )
}
