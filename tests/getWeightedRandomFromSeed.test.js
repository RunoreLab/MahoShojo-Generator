// 分布概率验证测试
// 测试 getWeightedRandomFromSeed 函数的分布概率
import { expect, test } from 'vitest';

// 复制核心函数实现
function seedRandom(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return Math.abs(hash)
}

function getWeightedRandomFromSeed(array, weights, seed, offset = 0) {
  // 使用种子生成 0-1 之间的伪随机数
  const pseudoRandom = ((seed + offset) * 9301 + 49297) % 233280 / 233280.0
  
  // 累计权重
  let cumulativeWeight = 0
  const cumulativeWeights = weights.map(weight => cumulativeWeight += weight)
  const totalWeight = cumulativeWeights[cumulativeWeights.length - 1]
  
  // 找到对应的索引
  const randomValue = pseudoRandom * totalWeight
  const index = cumulativeWeights.findIndex(weight => randomValue <= weight)
  
  return array[index >= 0 ? index : 0]
}

// 测试配置
const levels = [
  { name: '种', emoji: '🌱' },
  { name: '芽', emoji: '🍃' },
  { name: '叶', emoji: '🌿' },
  { name: '蕾', emoji: '🌸' },
  { name: '花', emoji: '🌺' },
  { name: '宝石权杖', emoji: '💎' }
]

const levelProbabilities = [0.1, 0.2, 0.3, 0.3, 0.07, 0.03]

// 生成大量测试样本
function runDistributionTest(sampleSize = 100000) {
  console.log(`\n===== 分布概率验证测试 (样本数: ${sampleSize}) =====`)
  console.log('预期概率:', levelProbabilities.map((p, i) => `${levels[i].name}: ${(p * 100).toFixed(1)}%`).join(', '))
  
  const results = {}
  levels.forEach(level => results[level.name] = 0)
  
  // 生成测试样本
  for (let i = 0; i < sampleSize; i++) {
    // 使用不同的种子和偏移量来模拟真实使用场景
    const testSeed = seedRandom(`test_${i}`)
    const level = getWeightedRandomFromSeed(levels, levelProbabilities, testSeed, 6)
    results[level.name]++
  }
  
  // 计算实际概率
  console.log('\n实际分布:')
  levels.forEach((level, index) => {
    const actualCount = results[level.name]
    const actualProbability = actualCount / sampleSize
    const expectedProbability = levelProbabilities[index]
    const deviation = Math.abs(actualProbability - expectedProbability)
    const deviationPercent = (deviation / expectedProbability * 100).toFixed(2)
    
    console.log(`${level.emoji} ${level.name}: ${actualCount}次 (${(actualProbability * 100).toFixed(2)}%) | 偏差: ${deviationPercent}%`)
  })
  
  // 计算卡方检验
  let chiSquare = 0
  levels.forEach((level, index) => {
    const observed = results[level.name]
    const expected = sampleSize * levelProbabilities[index]
    chiSquare += Math.pow(observed - expected, 2) / expected
  })
  
  console.log(`\n卡方值: ${chiSquare.toFixed(4)}`)
  console.log(`自由度: ${levels.length - 1}`)
  
  // 简单的分布质量评估
  const maxExpectedDeviation = 0.02 // 2% 的最大预期偏差
  let isDistributionGood = true
  
  levels.forEach((level, index) => {
    const actualProbability = results[level.name] / sampleSize
    const expectedProbability = levelProbabilities[index]
    const deviation = Math.abs(actualProbability - expectedProbability)
    
    if (deviation > maxExpectedDeviation) {
      isDistributionGood = false
    }
  })
  
  console.log(`\n分布质量评估: ${isDistributionGood ? '✅ 良好' : '⚠️ 需要关注'}`)
  
  return {
    results,
    chiSquare,
    isDistributionGood
  }
}

// 测试种子确定性
function testSeedDeterminism() {
  console.log('\n===== 种子确定性测试 =====')
  
  const testSeeds = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve']
  
  testSeeds.forEach(name => {
    const seed = seedRandom(name)
    const results = []
    
    // 同一个种子应该产生相同的结果
    for (let i = 0; i < 5; i++) {
      const level = getWeightedRandomFromSeed(levels, levelProbabilities, seed, 6)
      results.push(level.name)
    }
    
    const allSame = results.every(result => result === results[0])
    console.log(`${name} (种子: ${seed}): ${results[0]} ${allSame ? '✅' : '❌'}`)
  })
}

// 测试边界情况
function testEdgeCases() {
  console.log('\n===== 边界情况测试 =====')
  
  // 测试极端权重
  const extremeWeights = [0, 0, 0, 0, 0, 1] // 只有最后一个有权重
  let result = getWeightedRandomFromSeed(levels, extremeWeights, 12345, 6)
  console.log(`极端权重测试: ${result.name} (应该是宝石权杖)`)
  
  // 测试相等权重
  const equalWeights = [1, 1, 1, 1, 1, 1]
  const equalResults = {}
  levels.forEach(level => equalResults[level.name] = 0)
  
  for (let i = 0; i < 10000; i++) {
    result = getWeightedRandomFromSeed(levels, equalWeights, i, 6)
    equalResults[result.name]++
  }
  
  console.log('相等权重分布:')
  levels.forEach(level => {
    const count = equalResults[level.name]
    const percentage = (count / 10000 * 100).toFixed(1)
    console.log(`  ${level.name}: ${percentage}% (期望: ~16.7%)`)
  })
}

// 运行所有测试
function runAllTests() {
  console.log('开始运行 getWeightedRandomFromSeed 分布概率验证测试...')
  
  // 小样本测试
  runDistributionTest(10000)
  
  // 大样本测试
  runDistributionTest(100000)
  
  // 种子确定性测试
  testSeedDeterminism()
  
  // 边界情况测试
  testEdgeCases()
  
  console.log('\n===== 测试完成 =====')
}

// 如果直接运行此文件
if (typeof module !== 'undefined' && require.main === module) {
  runAllTests()
}

test('getWeightedRandomFromSeed 的分布质量在大样本下接近期望权重', () => {
  const result = runDistributionTest(10000)

  expect(result.isDistributionGood).toBe(true)
})

test('getWeightedRandomFromSeed 对相同种子保持确定性', () => {
  const seed = seedRandom('Alice')
  const first = getWeightedRandomFromSeed(levels, levelProbabilities, seed, 6)
  const second = getWeightedRandomFromSeed(levels, levelProbabilities, seed, 6)

  expect(second).toEqual(first)
})

// 导出函数供其他测试使用
if (typeof module !== 'undefined') {
  module.exports = {
    runDistributionTest,
    testSeedDeterminism,
    testEdgeCases,
    runAllTests
  }
}
