/**
 * 手动为用户添加积分的脚本
 * 使用方法：node add-credits.js <用户邮箱> <积分数量> [备注]
 * 示例：node add-credits.js user@example.com 100 "手动充值"
 */

// 注意：此脚本主要用于生成SQL语句，不直接操作数据库

// 获取命令行参数
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('使用方法：node add-credits.js <用户邮箱> <积分数量> [备注]');
  console.log('示例：node add-credits.js user@example.com 100 "手动充值"');
  process.exit(1);
}

const userEmail = args[0];
const creditsAmount = parseInt(args[1]);
const note = args[2] || '手动添加积分';

// 验证积分数量
if (isNaN(creditsAmount) || creditsAmount <= 0) {
  console.error('错误：积分数量必须是正整数');
  process.exit(1);
}

/**
 * 为用户添加积分的主函数
 */
async function addCreditsToUser() {
  try {
    // 注意：这里需要根据实际环境配置数据库连接
    // 在实际使用时，你需要确保有正确的数据库连接
    console.log('⚠️  注意：此脚本需要在 Cloudflare Workers 环境中运行');
    console.log('或者需要配置本地数据库连接');
    console.log('');
    console.log('建议的操作步骤：');
    console.log('1. 登录 Cloudflare Dashboard');
    console.log('2. 进入 D1 数据库管理页面');
    console.log('3. 执行以下 SQL 语句：');
    console.log('');
    
    // 生成 SQL 语句
    const insertCreditSQL = `
-- 为用户 ${userEmail} 添加 ${creditsAmount} 积分
-- 首先查找用户ID
SELECT id, email FROM users WHERE email = '${userEmail}';

-- 如果用户存在，执行以下插入语句（请将 USER_ID 替换为上面查询到的实际用户ID）
INSERT INTO credit_records (
  user_id,
  credits,
  remaining_credits,
  trans_type,
  source_type,
  source_id,
  note,
  created_at,
  updated_at
) VALUES (
  USER_ID,  -- 请替换为实际的用户ID
  ${creditsAmount},
  ${creditsAmount},
  'adjustment',
  'manual',
  'admin_add_${Date.now()}',
  '${note}',
  strftime('%s', 'now'),
  strftime('%s', 'now')
);

-- 验证添加结果
SELECT 
  cr.id,
  u.email,
  cr.credits,
  cr.remaining_credits,
  cr.trans_type,
  cr.note,
  datetime(cr.created_at, 'unixepoch') as created_time
FROM credit_records cr
JOIN users u ON cr.user_id = u.id
WHERE u.email = '${userEmail}'
ORDER BY cr.created_at DESC
LIMIT 5;
`;
    
    console.log(insertCreditSQL);
    console.log('');
    console.log('✅ SQL 语句已生成完成！');
    console.log('请复制上面的 SQL 语句到 Cloudflare D1 控制台执行');
    
  } catch (error) {
    console.error('生成 SQL 时出错：', error.message);
  }
}

// 执行主函数
addCreditsToUser();