/**
 * 服务端中文提示 → 英文。
 *
 * 后台接口的报错原文是中文；官网的英文/阿拉伯语页面如果只显示笼统的
 * “请求失败”，用户就永远看不到「验证码不对」「先允许 Cookie」这类原因。
 * 这里只做查表，查不到才退回调用方给的兜底文案。
 */
const MESSAGES: Record<string, string> = {
  '验证码不正确。': 'That code is not correct.',
  '请先获取验证码。': 'Request a code first.',
  '验证码已过期，请重新获取。': 'That code expired, please request a new one.',
  '验证码错误次数过多，请重新获取。': 'Too many wrong attempts, please request a new code.',
  '验证码应为 6 位数字。': 'The code must be 6 digits.',
  '邮箱格式不对。': 'That email address looks wrong.',
  '请使用有效邮箱，并设置至少 12 位密码。': 'Use a valid email and a password of at least 12 characters.',
  '请填写姓名。': 'Please fill in your name.',
  '这个邮箱已经有账户了，直接登录即可。': 'This email already has an account, just sign in.',
  '这个邮箱已经有账户了，直接登录即可看到订单。': 'This email already has an account, sign in to see these orders.',
  '还没有配置 SMTP 服务器和发件地址。': 'Email sending is not configured yet, please contact support.',
  '收件地址格式不对。': 'The recipient address looks wrong.',
  '申请太频繁，请过一会儿再试。': 'Too many requests, please try again later.',
  '验证码发送失败。': 'Could not send the code.',
  '请先允许 Cookie 再提交订单：页面右下角的 Cookie 弹窗里点「允许」即可。':
    'Please allow cookies before submitting the order: use the cookie dialog in the corner of the page.',
  '购物车为空。': 'Your cart is empty.',
  '商品已下架或库存不足，请刷新购物车。': 'An item is unavailable, please refresh your cart.',
  '商品价格或运费已变化，请刷新购物车后确认金额。': 'Prices changed, please refresh your cart and confirm the total.',
  '该商品或收货地区需要人工确认运费，不能直接在线付款。': 'The freight for these items needs a manual quote, pay online later.',
  '需要人工报价的订单请留下可回复的邮箱。': 'Leave a reachable email so we can reply with the freight quote.',
  '下单过于频繁，请稍后再试。': 'Too many orders in a short time, please try again later.',
  '当前暂停下单，请联系客服。': 'Ordering is paused, please contact support.',
  '所选支付通道尚未完成凭据和 Webhook 配置。': 'The selected payment channel is not fully configured.',
  '请使用当前账户邮箱完成下单。': 'Use the email of the signed-in account to order.',
  '请先登录。': 'Please sign in first.',
  '请登录账号。': 'Please sign in.'
};

export function englishServerMessage(message: unknown): string {
  const text = String(message || '').trim();
  return MESSAGES[text] || '';
}
